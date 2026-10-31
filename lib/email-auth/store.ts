import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PendingReferralAttribution } from '@/lib/local-cn-referral-attribution';

export type EmailChallenge = {
  id: string; email: string; browser: string; digest: string; expiresAt: number;
  attempts: number; delivery: 'pending' | 'sent' | 'failed' | 'consumed';
  name: string; passwordHash: string; referral: PendingReferralAttribution | null;
  purpose: 'register' | 'reset'; memberId: number | null;
};
type Budget = { key: string; count: number; until: number; last: number };
type State = { schemaVersion: 1; keyId: string; challenges: EmailChallenge[]; budgets: Budget[] };

// Single-host, shared-filesystem transactions. Never steal a possibly live lock.
export function emailTransaction<T>(keyId: string, update: (state: State) => T): T {
  const directory = process.env.LOCAL_CN_DATA_DIR;
  if (!directory || process.env.DATABASE_URL) throw new Error('EMAIL_STORE_UNAVAILABLE');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, 'cn-email-auth.json');
  const lock = path.join(directory, '.cn-email-auth.lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('EMAIL_STORE_BUSY'); }
  let temporary: string | undefined;
  try {
    const state: State = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8'))
      : { schemaVersion: 1, keyId, challenges: [], budgets: [] };
    if (state.schemaVersion !== 1 || state.keyId !== keyId || !Array.isArray(state.challenges) || !Array.isArray(state.budgets)
      || state.challenges.some(row => !row || !/^[a-f0-9]{48}$/.test(row.id) || !/^[a-f0-9]{64}$/.test(row.digest)
        || !/^[a-f0-9]{64}$/.test(row.browser) || typeof row.email !== 'string' || typeof row.passwordHash !== 'string'
        || !Number.isFinite(row.expiresAt) || !Number.isInteger(row.attempts) || row.attempts < 0 || row.attempts > 5
        || !['pending', 'sent', 'failed', 'consumed'].includes(row.delivery)
        || !['register', 'reset'].includes(row.purpose) || (row.purpose === 'register' && !row.referral?.referrerMemberId))
      || state.budgets.some(row => !row || typeof row.key !== 'string' || !Number.isSafeInteger(row.count)
        || row.count < 0 || !Number.isFinite(row.until) || !Number.isFinite(row.last))) throw new Error('EMAIL_STORE_INVALID');
    const now = Date.now();
    state.challenges = state.challenges.filter(row => row.expiresAt > now);
    state.budgets = state.budgets.filter(row => row.until > now);
    const result = update(state);
    if (state.challenges.length > 1000 || state.budgets.length > 5000) throw new Error('EMAIL_STORE_FULL');
    temporary = `${filename}.${randomBytes(12).toString('hex')}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, filename);
    temporary = undefined;
    const dir = openSync(directory, 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
    return result;
  } finally {
    try { if (temporary) unlinkSync(temporary); } finally { rmdirSync(lock); }
  }
}

export function spendEmailBudget(state: State, key: string, limit: number, cooldown = 0) {
  const now = Date.now();
  let row = state.budgets.find(item => item.key === key);
  if (!row) { row = { key, count: 0, until: now + 3600000, last: 0 }; state.budgets.push(row); }
  if (row.count >= limit || now - row.last < cooldown) return false;
  row.count += 1;
  row.last = now;
  return true;
}

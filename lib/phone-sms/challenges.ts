import { createHash, randomInt } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

type PhoneChallengeRecord = {
  id: string;
  phone: string;
  codeHash: string;
  pilotCode: string;
  expiresAt: string;
  createdAt: string;
  consumedAt?: string | null;
  attempts: number;
};

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function storePath() {
  return path.join(dataDir(), 'cn-phone-challenges.json');
}

function readChallenges(): PhoneChallengeRecord[] {
  try {
    const file = storePath();
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeChallenges(records: PhoneChallengeRecord[]) {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(storePath(), JSON.stringify(records.slice(-500), null, 2));
}

function hashCode(phone: string, code: string) {
  const secret = process.env.JWT_SECRET || process.env.AUTH_SECRET || 'richsmart-phone-code';
  return createHash('sha256').update(`${secret}:${phone}:${code}`).digest('hex');
}

export function normalizeCnOrTwPhone(raw: unknown): string | null {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  const stripped86 = digits.replace(/^(?:\+?86)/, '');
  if (/^1[3-9]\d{9}$/.test(stripped86)) return stripped86;
  const stripped886 = digits.replace(/^(?:\+?886)/, '');
  if (/^09\d{8}$/.test(digits)) return digits;
  if (/^9\d{8}$/.test(stripped886)) return `0${stripped886}`;
  return null;
}

export function issuePhoneCodeChallenge(phone: string) {
  const code = String(randomInt(100000, 999999));
  const now = Date.now();
  const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();
  const records = readChallenges().filter((item) => new Date(item.expiresAt).getTime() > now - 3600_000);
  records.push({
    id: `PHC-${now}-${randomInt(1000, 9999)}`,
    phone,
    codeHash: hashCode(phone, code),
    pilotCode: code,
    expiresAt,
    createdAt: new Date(now).toISOString(),
    consumedAt: null,
    attempts: 0,
  });
  writeChallenges(records);
  return { code, expiresAt };
}

export function verifyPhoneCodeChallenge(phone: string, rawCode: unknown): { ok: boolean; error?: string } {
  const normalizedPhone = normalizeCnOrTwPhone(phone);
  const code = String(rawCode || '').trim();
  if (!normalizedPhone || !/^\d{6}$/.test(code)) {
    return { ok: false, error: '请输入正确的手机号码与 6 位数字验证码' };
  }
  const now = Date.now();
  const records = readChallenges();
  const candidates = records
    .filter((item) => item.phone === normalizedPhone && !item.consumedAt && new Date(item.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const latest = candidates[0];
  if (!latest) {
    return { ok: false, error: '验证码已过期或尚未发送，请重新获取验证码' };
  }
  latest.attempts = (latest.attempts || 0) + 1;
  if (latest.attempts > 8) {
    writeChallenges(records);
    return { ok: false, error: '验证次数过多，请重新获取验证码' };
  }
  const expectedHash = hashCode(normalizedPhone, code);
  if (latest.codeHash !== expectedHash) {
    writeChallenges(records);
    return { ok: false, error: '验证码不正确，请核对后重试' };
  }
  latest.consumedAt = new Date(now).toISOString();
  writeChallenges(records);
  return { ok: true };
}

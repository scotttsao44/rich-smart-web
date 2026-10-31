export type StoredOtpChallenge = {
  id: string;
  phone: string;
  phoneKey: string;
  browserKey: string;
  digest: string;
  expiresAt: number;
  attempts: number;
  delivery: 'pending' | 'sent';
};

export type StoredOtpWindow = { key: string; count: number; expiresAt: number; lastAt: number };
export type SharedOtpState = { schemaVersion: 1; digestKeyId: string | null; challenges: StoredOtpChallenge[]; windows: StoredOtpWindow[] };

// Implementations must serialize across workers, durably commit before resolving,
// and roll back on callback failure. Callback is synchronous; no provider I/O.
export interface AtomicOtpStore {
  transaction<T>(update: (state: SharedOtpState) => T): Promise<T>;
}

export function emptySharedOtpState(): SharedOtpState {
  return { schemaVersion: 1, digestKeyId: null, challenges: [], windows: [] };
}

export function validateSharedOtpState(value: unknown): asserts value is SharedOtpState {
  const state = value as SharedOtpState;
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.challenges) || !Array.isArray(state.windows)
    || !(state.digestKeyId === null || (typeof state.digestKeyId === 'string' && /^[a-f0-9]{64}$/.test(state.digestKeyId)))
    || state.challenges.length > 5000 || state.windows.length > 10000) throw new Error('invalid OTP storage');
  const challengeIds = new Set<string>();
  const budgetKeys = new Set<string>();
  for (const row of state.challenges) {
    if (!row || !/^[A-Za-z0-9_-]{32}$/.test(row.id) || challengeIds.has(row.id)
      || !/^\+[1-9]\d{6,14}$/.test(row.phone)
      || !/^[a-f0-9]{64}$/.test(row.phoneKey) || !/^[a-f0-9]{64}$/.test(row.browserKey)
      || !/^[a-f0-9]{64}$/.test(row.digest) || !Number.isFinite(row.expiresAt)
      || !Number.isInteger(row.attempts) || row.attempts < 0 || row.attempts > 5
      || !['pending', 'sent'].includes(row.delivery)) throw new Error('invalid OTP storage');
    challengeIds.add(row.id);
  }
  for (const row of state.windows) {
    if (!row || !/^[a-f0-9]{64}$/.test(row.key) || budgetKeys.has(row.key)
      || !Number.isSafeInteger(row.count) || row.count < 0
      || !Number.isFinite(row.expiresAt) || !Number.isFinite(row.lastAt)) throw new Error('invalid OTP storage');
    budgetKeys.add(row.key);
  }
}

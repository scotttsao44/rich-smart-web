import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { normalizeContactPhone } from '../international-phone';

export interface SmsProvider {
  sendCode(input: { phone: string; code: string; expiresInSeconds: number }): Promise<void>;
}

export class OtpError extends Error {
  constructor(public readonly kind: 'invalid' | 'limited' | 'unavailable') {
    super(kind);
  }
}

type Challenge = {
  phone: string; context: string; digest: Buffer; expiresAt: number;
  attempts: number; delivered: boolean;
};
type Window = { count: number; expiresAt: number; lastAt: number };

// Single-process, isolated candidate only. Production needs atomic shared storage.
export class IsolatedSmsOtp {
  private readonly key = randomBytes(32);
  private readonly challenges = new Map<string, Challenge>();
  private readonly limits = new Map<string, Window>();
  constructor(private readonly provider: SmsProvider, private readonly now = Date.now) {}

  private digest(id: string, code: string) {
    return createHmac('sha256', this.key).update(`${id}:${code}`).digest();
  }

  private phone(value: unknown) {
    if (typeof value !== 'string' || value.length > 64) throw new OtpError('invalid');
    try {
      const phone = normalizeContactPhone(value);
      return /^1\d{10}$/.test(phone) ? `+86${phone}` : phone;
    } catch { throw new OtpError('invalid'); }
  }

  private context(value: string) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(value)) throw new OtpError('invalid');
    return value;
  }

  private prune(now: number) {
    for (const [id, row] of Array.from(this.challenges.entries())) if (row.expiresAt <= now) this.challenges.delete(id);
    for (const [id, row] of Array.from(this.limits.entries())) if (row.expiresAt <= now) this.limits.delete(id);
  }

  async send(phoneInput: unknown, browserContext: string) {
    const phone = this.phone(phoneInput);
    const context = this.context(browserContext);
    const now = this.now();
    this.prune(now);
    const keys = [`phone:${phone}`, `context:${context}`];
    for (const key of keys) {
      const window = this.limits.get(key);
      if (window && (now - window.lastAt < 60_000 || window.count >= 5)) throw new OtpError('limited');
    }
    if (this.limits.size >= 10_000 || this.challenges.size >= 5_000) throw new OtpError('limited');
    // Reserve before awaiting provider; failure also spends the abuse budget.
    for (const key of keys) {
      const old = this.limits.get(key);
      this.limits.set(key, { count: (old?.count || 0) + 1, expiresAt: old?.expiresAt || now + 3_600_000, lastAt: now });
    }
    for (const [id, row] of Array.from(this.challenges.entries())) if (row.phone === phone) this.challenges.delete(id);
    const challengeId = randomBytes(24).toString('base64url');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const row: Challenge = { phone, context, digest: this.digest(challengeId, code), expiresAt: now + 180_000, attempts: 0, delivered: false };
    this.challenges.set(challengeId, row);
    try {
      await this.provider.sendCode({ phone, code, expiresInSeconds: 180 });
      if (this.challenges.get(challengeId) !== row || row.expiresAt <= this.now()) throw new OtpError('unavailable');
      row.delivered = true;
      return { challengeId, expiresInSeconds: 180, resendAfterSeconds: 60 };
    } catch {
      this.challenges.delete(challengeId);
      throw new OtpError('unavailable');
    }
  }

  consume(challengeId: unknown, code: unknown, browserContext: string) {
    const now = this.now();
    this.prune(now);
    if (typeof challengeId !== 'string' || challengeId.length !== 32) throw new OtpError('invalid');
    const row = this.challenges.get(challengeId);
    if (!row || !row.delivered || row.context !== this.context(browserContext)) throw new OtpError('invalid');
    row.attempts += 1;
    const validShape = typeof code === 'string' && /^\d{6}$/.test(code);
    const candidate = this.digest(challengeId, validShape ? code : 'invalid');
    const valid = timingSafeEqual(row.digest, candidate) && validShape;
    if (row.attempts >= 5 || valid) this.challenges.delete(challengeId);
    if (!valid) throw new OtpError('invalid');
    return { phone: row.phone, verifiedAt: new Date(now).toISOString() };
  }
}

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { normalizeContactPhone } from '../international-phone';
import { OtpError } from './otp';
import type { AtomicOtpStore, SharedOtpState } from './shared-store';

export interface AcknowledgedSmsProvider {
  // Success means provider accepted delivery, not proof that the handset received it.
  sendCode(input: { phone: string; code: string; expiresInSeconds: number; signal: AbortSignal }): Promise<{ accepted: boolean }>;
}

export interface TrustedSmsContextSource<RequestContext> {
  // Only a reviewed server ingress adapter may implement this. Never derive the
  // subject from arbitrary client IP headers, body flags, invite links or IDs.
  resolve(request: RequestContext): Promise<{ browserSubject: string; ipSubject: string } | null>;
}

type Dependencies<RequestContext> = {
  store: AtomicOtpStore;
  provider: AcknowledgedSmsProvider;
  context: TrustedSmsContextSource<RequestContext>;
  // Shared server-managed digest key across workers; not an account/session key.
  digestKey: Uint8Array;
  now?: () => number;
  deliveryTimeoutMs?: number;
};

export class SharedSmsOtp<RequestContext> {
  private readonly key: Buffer;
  private readonly now: () => number;
  private readonly timeout: number;
  constructor(private readonly dependencies: Dependencies<RequestContext>) {
    if (dependencies.digestKey.byteLength < 32) throw new OtpError('unavailable');
    this.key = Buffer.from(dependencies.digestKey);
    this.now = dependencies.now || Date.now;
    this.timeout = dependencies.deliveryTimeoutMs ?? 10000;
    if (!Number.isFinite(this.timeout) || this.timeout < 1 || this.timeout > 10000) throw new OtpError('unavailable');
  }

  private hash(label: string, value: string) {
    return createHmac('sha256', this.key).update(`${label}:${value}`).digest('hex');
  }

  private async context(request: RequestContext) {
    try {
      const result = await this.dependencies.context.resolve(request);
      if (!result || !/^[A-Za-z0-9_-]{32,128}$/.test(result.browserSubject)
        || !/^[A-Za-z0-9_-]{32,128}$/.test(result.ipSubject)) throw new Error('untrusted context');
      return { browserKey: this.hash('browser', result.browserSubject), ipKey: this.hash('ip', result.ipSubject) };
    } catch { throw new OtpError('unavailable'); }
  }

  private async transaction<T>(update: (state: SharedOtpState) => T) {
    try { return await this.dependencies.store.transaction((state) => {
      const keyId = this.hash('store-key-id', 'v1');
      if (state.digestKeyId && state.digestKeyId !== keyId) throw new OtpError('unavailable');
      state.digestKeyId = keyId;
      return update(state);
    }); }
    catch (error) { if (error instanceof OtpError) throw error; throw new OtpError('unavailable'); }
  }

  private prune(state: SharedOtpState, now: number) {
    state.challenges = state.challenges.filter((row) => row.expiresAt > now);
    state.windows = state.windows.filter((row) => row.expiresAt > now);
  }

  private budget(state: SharedOtpState, now: number, rules: { key: string; max: number; cooldown?: number }[]) {
    for (const rule of rules) {
      const row = state.windows.find((entry) => entry.key === rule.key);
      if (row && (row.count >= rule.max || (rule.cooldown && now - row.lastAt < rule.cooldown))) throw new OtpError('limited');
    }
    const added = rules.filter((rule) => !state.windows.some((row) => row.key === rule.key)).length;
    if (state.windows.length + added > 10000) throw new OtpError('limited');
    for (const rule of rules) {
      const row = state.windows.find((entry) => entry.key === rule.key);
      if (row) { row.count++; row.lastAt = now; }
      else state.windows.push({ key: rule.key, count: 1, lastAt: now, expiresAt: now + 3600000 });
    }
  }

  async send(phoneInput: unknown, request: RequestContext) {
    let phone: string;
    if (typeof phoneInput !== 'string' || phoneInput.length > 64) throw new OtpError('invalid');
    try {
      phone = normalizeContactPhone(phoneInput);
      if (/^1\d{10}$/.test(phone)) phone = `+86${phone}`;
    } catch { throw new OtpError('invalid'); }
    const context = await this.context(request);
    const phoneKey = this.hash('phone', phone);
    const id = randomBytes(24).toString('base64url');
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const expiresAt = await this.transaction((state) => {
      const now = this.now(); this.prune(state, now);
      if (state.challenges.length >= 5000) throw new OtpError('limited');
      this.budget(state, now, [
        { key: this.hash('send-phone', phoneKey), max: 5, cooldown: 60000 },
        { key: this.hash('send-browser', context.browserKey), max: 5, cooldown: 60000 },
        { key: this.hash('send-ip', context.ipKey), max: 20 },
        { key: this.hash('send-global', 'all'), max: 500 },
      ]);
      state.challenges = state.challenges.filter((row) => row.phoneKey !== phoneKey);
      state.challenges.push({ id, phone, phoneKey, browserKey: context.browserKey,
        digest: this.hash('code', `${id}:${code}`), expiresAt: now + 180000, attempts: 0, delivery: 'pending' });
      return now + 180000;
    });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const receipt = await Promise.race([
        Promise.resolve().then(() => this.dependencies.provider.sendCode({ phone, code, expiresInSeconds: 180, signal: controller.signal })),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new OtpError('unavailable')); }, this.timeout); }),
      ]);
      if (!receipt || receipt.accepted !== true) throw new OtpError('unavailable');
      const committed = await this.transaction((state) => {
        const now = this.now(); this.prune(state, now);
        const row = state.challenges.find((entry) => entry.id === id);
        if (!row || row.expiresAt <= now) return false;
        row.delivery = 'sent'; return true;
      });
      if (!committed) throw new OtpError('unavailable');
      return { challengeId: id, expiresInSeconds: Math.max(0, Math.floor((expiresAt - this.now()) / 1000)), resendAfterSeconds: 60 };
    } catch {
      controller.abort();
      // Never delete a later resend's reservation; unknown commit outcome still
      // fails closed. Pending rows cannot be verified and expire after 180s.
      await this.transaction((state) => { state.challenges = state.challenges.filter((row) => row.id !== id); }).catch(() => undefined);
      throw new OtpError('unavailable');
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }

  async consume(challengeId: unknown, code: unknown, request: RequestContext) {
    const context = await this.context(request);
    const result = await this.transaction((state) => {
      const now = this.now(); this.prune(state, now);
      this.budget(state, now, [
        { key: this.hash('verify-ip', context.ipKey), max: 100 },
        { key: this.hash('verify-global', 'all'), max: 5000 },
      ]);
      const row = typeof challengeId === 'string' && /^[A-Za-z0-9_-]{32}$/.test(challengeId)
        ? state.challenges.find((entry) => entry.id === challengeId) : undefined;
      if (!row || row.delivery !== 'sent' || row.browserKey !== context.browserKey) return null;
      row.attempts++;
      const shape = typeof code === 'string' && /^\d{6}$/.test(code);
      const digest = this.hash('code', `${row.id}:${shape ? code : 'invalid'}`);
      const valid = timingSafeEqual(Buffer.from(row.digest, 'hex'), Buffer.from(digest, 'hex')) && shape;
      if (valid || row.attempts >= 5) state.challenges = state.challenges.filter((entry) => entry.id !== row.id);
      return valid ? { phone: row.phone, verifiedAt: new Date(now).toISOString() } : null;
    });
    if (!result) throw new OtpError('invalid');
    return result;
  }
}

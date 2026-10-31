import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hashPassword, verifyPassword, type SessionUser } from '@/lib/auth';
import { createLocalCnUser, listLocalCnUsers, referralOwnerForAttribution, resetLocalCnVerifiedEmailPassword, type LocalCnUser } from '@/lib/local-cn-users';
import { appendLocalCnReferralBindingAudit, getLocalCnReferralAttributionState, type PendingReferralAttribution } from '@/lib/local-cn-referral-attribution';
import { emailTransaction, spendEmailBudget } from './store';
import { emailDeliveryConfigured, sendRegistrationEmail, smtpConfigured } from './mail';

export class EmailAuthError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); Object.setPrototypeOf(this, new.target.prototype); }
}
function fail(status: number, code: string, message: string): never { throw new EmailAuthError(status, code, message); }
export function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) ? email : '';
}
function key() {
  const value = process.env.EMAIL_AUTH_SECRET || '';
  if (value.length < 32) return fail(503, 'EMAIL_NOT_CONFIGURED', '邮箱注册尚未配置完成');
  return value;
}
function digest(value: string) { return createHmac('sha256', key()).update(value).digest('hex'); }
function keyId() { return createHash('sha256').update(key()).digest('hex'); }
export function allowedEmailAuthOrigins() {
  const raw = process.env.EMAIL_AUTH_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || '';
  return raw
    .split(',')
    .map(item => item.trim().replace(/\/+$/, ''))
    .filter(item => /^https?:\/\/[^/]+$/i.test(item));
}
export function isAllowedEmailAuthOrigin(requestOrigin: string | null, fallbackDevOrigin = '') {
  const allowed = allowedEmailAuthOrigins();
  const candidate = (requestOrigin || fallbackDevOrigin || '').trim().replace(/\/+$/, '');
  if (!candidate) return false;
  if (allowed.includes(candidate)) return true;
  if (fallbackDevOrigin && candidate === fallbackDevOrigin.replace(/\/+$/, '')) return true;
  if (process.env.CN_TRANSITIONAL_TEST_MODE !== 'false' && /^https?:\/\/[^/]+$/i.test(candidate)) return true;
  return false;
}
export function emailAuthConfigured() {
  return process.env.EMAIL_AUTH_ENABLED === 'true' && !process.env.DATABASE_URL && Boolean(process.env.LOCAL_CN_DATA_DIR)
    && (process.env.EMAIL_AUTH_SECRET || '').length >= 32 && emailDeliveryConfigured()
    && allowedEmailAuthOrigins().length > 0;
}
function requireStore() {
  if (process.env.EMAIL_AUTH_ENABLED !== 'true' || process.env.DATABASE_URL || !process.env.LOCAL_CN_DATA_DIR) fail(503, 'EMAIL_NOT_CONFIGURED', '邮箱注册尚未配置完成');
  key();
  // Existing member storage must not fail open and overwrite a corrupt file.
  const filename = path.join(process.env.LOCAL_CN_DATA_DIR!, 'cn-users.json');
  if (existsSync(filename)) {
    const rows = JSON.parse(readFileSync(filename, 'utf8'));
    if (!Array.isArray(rows) || rows.some(row => !row || !Number.isSafeInteger(row.id) || typeof row.email !== 'string')) throw new Error('Invalid member storage');
  }
}
function memberSession(user: LocalCnUser): SessionUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role, agentLevel: user.agentLevel, region: 'CN',
    referralCode: user.referralCode, platformAdmin: user.platformAdmin === true, referralSharingEnabled: user.referralSharingEnabled !== false,
    emailCredentialVersion: user.emailCredentialVersion || 1 };
}
function eligibleReferral(referral: PendingReferralAttribution) {
  const state = getLocalCnReferralAttributionState();
  const owner = referralOwnerForAttribution(referral.referrerMemberId);
  return owner && owner.referralSharingEnabled !== false
    && state.links.some(row => row.id === referral.linkId && row.memberId === owner.id && row.status === 'active')
    && state.visits.some(row => row.id === referral.visitId && row.linkId === referral.linkId && row.attributionId === referral.attributionId) ? owner : null;
}

export async function requestEmailRegistration(input: { email: unknown; name: unknown; password: unknown; confirmReferral: unknown; purpose?: 'register' | 'reset' }, browser: string, referral: PendingReferralAttribution | null,
  deliver: (email: string, code: string) => Promise<void> = sendRegistrationEmail) {
  requireStore();
  if (deliver === sendRegistrationEmail && !emailAuthConfigured()) fail(503, 'EMAIL_NOT_CONFIGURED', '邮箱注册尚未配置完成');
  const email = normalizeEmail(input.email);
  const purpose = input.purpose === 'reset' ? 'reset' : 'register';
  const name = purpose === 'reset' ? '会员' : typeof input.name === 'string' ? input.name.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email || !name || name.length > 80 || password.length < 12 || Buffer.byteLength(password) > 128) fail(400, 'INVALID_INPUT', '请填写有效邮箱、姓名及 12 至 128 字节的密码');
  if (!/^[a-f0-9]{48}$/.test(browser)) fail(400, 'INVALID_BROWSER', '请重新打开注册页面');
  if (purpose === 'register' && (!referral || input.confirmReferral !== true || !eligibleReferral(referral))) fail(400, 'REFERRAL_REQUIRED', '请从有效邀请链接进入并确认邀请人');
  const resetMember = purpose === 'reset' ? listLocalCnUsers().find(row => row.email === email && row.emailVerifiedAt && row.emailRegistrationId) : null;
  const id = randomBytes(24).toString('hex');
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const reserved = emailTransaction(keyId(), state => {
    if (!spendEmailBudget(state, 'send:global', 100) || !spendEmailBudget(state, `send:browser:${digest(browser)}`, 5, 60000)
      || !spendEmailBudget(state, `send:email:${digest(email)}`, 3, 60000)) return false;
    state.challenges = state.challenges.filter(row => row.email !== email || row.browser !== digest(browser));
    state.challenges.push({ id, email, browser: digest(browser), digest: digest(`${id}:${code}`), expiresAt: Date.now() + 600000,
      attempts: 0, delivery: 'pending', name, passwordHash: hashPassword(password), referral: purpose === 'register' ? referral : null,
      purpose, memberId: resetMember?.id || null });
    return true;
  });
  if (!reserved) fail(429, 'RATE_LIMITED', '操作频繁，请稍后再试');
  // Do not claim delivery or allow verification until the provider acknowledges.
  try { await deliver(email, code); }
  catch {
    emailTransaction(keyId(), state => { const row = state.challenges.find(item => item.id === id); if (row) row.delivery = 'failed'; });
    return fail(503, 'EMAIL_DELIVERY_FAILED', '验证码发送失败，请稍后重试');
  }
  emailTransaction(keyId(), state => {
    const row = state.challenges.find(item => item.id === id);
    if (!row || row.expiresAt <= Date.now()) fail(400, 'CODE_EXPIRED', '验证码已失效，请重新申请');
    row.delivery = 'sent';
  });
  return { challengeId: id, expiresIn: 600, retryAfter: 60, pilotCode: (!smtpConfigured() && process.env.CN_TRANSITIONAL_TEST_MODE !== 'false') ? code : undefined, deliveryMode: smtpConfigured() ? 'smtp' : 'pilot_inline' };
}

export function verifyEmailRegistration(id: string, code: string, browser: string) {
  requireStore();
  if (!/^[a-f0-9]{48}$/.test(id) || !/^\d{6}$/.test(code) || !/^[a-f0-9]{48}$/.test(browser)) fail(400, 'INVALID_CODE', '验证码无效或已过期');
  const result = emailTransaction(keyId(), state => {
    if (!spendEmailBudget(state, `verify:${digest(browser)}`, 30) || !spendEmailBudget(state, 'verify:global', 1000)) return { error: 'RATE_LIMITED' } as const;
    const row = state.challenges.find(item => item.id === id && item.browser === digest(browser));
    if (!row || row.delivery !== 'sent' || row.attempts >= 5) return { error: 'INVALID_CODE' } as const;
    row.attempts += 1;
    if (!timingSafeEqual(Buffer.from(row.digest, 'hex'), Buffer.from(digest(`${id}:${code}`), 'hex'))) return { error: 'INVALID_CODE' } as const;
    if (row.purpose === 'reset') {
      const user = row.memberId ? resetLocalCnVerifiedEmailPassword(row.memberId, row.email, row.passwordHash) : null;
      if (!user) return { error: 'INVALID_CODE' } as const;
      row.delivery = 'consumed'; row.passwordHash = '';
      return { user: memberSession(user) };
    }
    if (!row.referral) return { error: 'REFERRAL_REQUIRED' } as const;
    const referral = row.referral;
    const referrer = eligibleReferral(referral);
    if (!referrer) return { error: 'REFERRAL_REQUIRED' } as const;
    const existing = listLocalCnUsers().find(user => user.email.toLowerCase() === row.email);
    // A crash after member commit may retry the same challenge, but never merge another account.
    if (existing && existing.emailRegistrationId !== id) return { error: 'EMAIL_IN_USE' } as const;
    const user = existing || createLocalCnUser({
      name: row.name, email: row.email, passwordHash: row.passwordHash, phone: '', phoneVerifiedAt: null,
      emailVerifiedAt: new Date().toISOString(), emailRegistrationId: id, emailCredentialVersion: 1,
      role: 'member', agentLevel: 1, platformAdmin: false, referralSharingEnabled: true,
      referralCode: `RS-EM-${randomBytes(12).toString('hex').toUpperCase()}`, referrerCode: referrer.referralCode,
      referredByMemberId: referrer.id, referralBoundAt: new Date().toISOString(), referralSource: 'email_register',
      referralAttributionId: referral.attributionId, referralVisitId: referral.visitId, store: null, wechatId: null,
    });
    if (!user) return { error: 'EMAIL_IN_USE' } as const;
    if (!getLocalCnReferralAttributionState().bindings.some(binding => binding.memberId === user.id && binding.attributionId === referral.attributionId)) {
      appendLocalCnReferralBindingAudit({ memberId: user.id, referredByMemberId: referrer.id, linkId: referral.linkId,
        visitId: referral.visitId, attributionId: referral.attributionId, source: 'email_register', result: 'bound', reason: 'verified_email_first_bind' });
    }
    row.delivery = 'consumed';
    row.passwordHash = '';
    return { user: memberSession(user) };
  });
  if ('error' in result) {
    if (result.error === 'EMAIL_IN_USE') fail(409, result.error, '此邮箱已有会员，请登录原账号；不会自动合并或更换邀请人');
    fail(result.error === 'RATE_LIMITED' ? 429 : 400, result.error!, '验证码无效、已过期或邀请已失效，请重新申请');
  }
  return result.user;
}

export function loginEmailMember(emailInput: unknown, passwordInput: unknown) {
  requireStore();
  const email = normalizeEmail(emailInput);
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  if (!email || !password || Buffer.byteLength(password) > 128) fail(400, 'INVALID_INPUT', '请输入邮箱和密码');
  const allowed = emailTransaction(keyId(), state => spendEmailBudget(state, 'login:global', 500) && spendEmailBudget(state, `login:${digest(email)}`, 20));
  if (!allowed) fail(429, 'RATE_LIMITED', '登录次数过多，请稍后再试');
  const user = listLocalCnUsers().find(row => row.email.toLowerCase() === email);
  const dummy = `scrypt$invalid-account-salt$${'x'.repeat(86)}`;
  const valid = verifyPassword(password, user?.passwordHash || dummy);
  if (!user?.emailVerifiedAt || !valid) fail(401, 'INVALID_CREDENTIALS', '邮箱或密码错误，或邮箱尚未验证');
  return memberSession(user!);
}

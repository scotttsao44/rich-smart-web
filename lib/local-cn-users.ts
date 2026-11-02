import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { normalizeStoredVerifiedPhone } from '@/lib/international-phone';
import {
  findLocalCnMemberIdByWechatIdentity,
  resolveLocalCnWechatIdentity,
  type WechatIdentitySource,
} from '@/lib/local-cn-member-identities';

export const CAOMI_OFFICIAL_REFERRAL_CODE = 'RS-CN-OFFICIAL';
export const CAOMI_TEST_ACCOUNT_USER_ID = 990000000001;
export const CAOMI_TEST_ACCOUNT_REFERRAL_CODE = 'RS-CN-FLOW-TEST';
export const CAOMI_ADMIN_TEST_ACCOUNT_USER_ID = 990000000002;
export const CAOMI_ADMIN_TEST_ACCOUNT_REFERRAL_CODE = 'RS-CN-ADMIN-TEST';
export const CAOMI_SCOOT_ADMIN_USER_ID = 990000000003;
export const CAOMI_SCOOT_REFERRAL_CODE = 'RS-CN-SCOOT';
const CAOMI_BRAND_DEMO_USER_BASE_ID = 880000000000;
export const PROMOTION_QUALIFICATION_POLICY_VERSION = 'auto-v1-20261013';
export type PromotionQualificationStatus = 'not_applied' | 'granted' | 'disabled';

function configuredPlatformAdminOpenIds() {
  return new Set(
    String(process.env.CN_PLATFORM_ADMIN_WECHAT_OPENIDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function normalizeCnReferrerCode(code?: string | null) {
  const normalized = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 100);
  return normalized || CAOMI_OFFICIAL_REFERRAL_CODE;
}

// 未填推荐码的新会员：归属待确认（由 AI 客服询问来源并交后台人工核对），不默认归官方直属；官方直属只能由管理员手动设置
export const CAOMI_PENDING_ATTRIBUTION_SOURCE = 'pending_attribution';

export function isLocalCnAttributionPending(user?: { referralSource?: string | null; referredByMemberId?: number | null } | null) {
  return Boolean(user && user.referralSource === CAOMI_PENDING_ATTRIBUTION_SOURCE && !(Number(user.referredByMemberId) > 0));
}

/** 只回传会员真实填写/带入的推荐码；空值或官方直属代码视为「未填」 */
export function explicitCnReferrerCode(code?: string | null) {
  const normalized = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 100);
  return normalized && normalized !== CAOMI_OFFICIAL_REFERRAL_CODE ? normalized : '';
}

export type LocalCnUser = {
  id: number; name: string; phone: string; email: string; passwordHash: string;
  role: 'member'; agentLevel: number; referralCode: string; referrerCode: string | null;
  referredByMemberId?: number | null; referralBoundAt?: string | null; referralSource?: string | null;
  referralAttributionId?: string | null; referralVisitId?: string | null;
  platformAdmin?: boolean;
  referralSharingEnabled?: boolean;
  promotionQualificationStatus?: PromotionQualificationStatus | null;
  promotionAppliedAt?: string | null;
  promotionApprovedAt?: string | null;
  promotionPolicyVersion?: string | null;
  promotionDisabledAt?: string | null;
  promotionDisabledReason?: string | null;
  store: string | null; wechatId: string | null; wechatMiniOpenId?: string | null;
  wechatOfficialOpenId?: string | null;
  wechatOpenPlatformOpenId?: string | null;
  wechatUnionId?: string | null; phoneVerifiedAt?: string | null; avatarUrl?: string | null;
  profileAuthorizedAt?: string | null; onboardingCompletedAt?: string | null;
  questionnaire?: { gender: string; birthYear: string; healthGoal: string; store: string } | null;
  createdAt: string;
  emailVerifiedAt?: string | null;
  emailRegistrationId?: string | null;
  emailCredentialVersion?: number;
};

function filePath() {
  const dataDir = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dataDir, 'cn-users.json');
}

function promotionAuditPath() {
  const dataDir = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dataDir, 'cn-promotion-qualification-audit.json');
}

function readAll(): LocalCnUser[] {
  if (!existsSync(filePath())) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath(), 'utf8'));
    return Array.isArray(parsed)
      ? parsed.map((user) => ({ ...user, referrerCode: isLocalCnAttributionPending(user) ? null : normalizeCnReferrerCode(user.referrerCode) }))
      : [];
  }
  catch { return []; }
}

let localCnUsersLockDepth = 0;

function acquireLocalCnUsersLock(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockDir = path.join(dir, '.cn-users.lock');
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 250; attempt += 1) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      return lockDir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
      Atomics.wait(waitBuffer, 0, 0, 5);
    }
  }
  throw new Error('会员资料库正忙，请稍后重试');
}

export function withLocalCnUsersWriteLock<T>(work: () => T): T {
  const file = filePath();
  const dir = path.dirname(file);
  if (localCnUsersLockDepth > 0) {
    localCnUsersLockDepth += 1;
    try {
      return work();
    } finally {
      localCnUsersLockDepth -= 1;
    }
  }
  const lockDir = acquireLocalCnUsersLock(dir);
  localCnUsersLockDepth = 1;
  try {
    return work();
  } finally {
    localCnUsersLockDepth = 0;
    try { rmdirSync(lockDir); } catch {}
  }
}

function writeAll(users: LocalCnUser[]) {
  return withLocalCnUsersWriteLock(() => {
    const file = filePath();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    const fd = openSync(temporary, 'w', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(users, null, 2), 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
  });
}

function appendPromotionAudit(row: Record<string, unknown>) {
  const target = promotionAuditPath();
  let rows: Array<Record<string, unknown>> = [];
  try {
    if (existsSync(target)) {
      const parsed = JSON.parse(readFileSync(target, 'utf8'));
      rows = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    rows = [];
  }
  rows.unshift(row);
  rows = rows.slice(0, 2000);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
}

export function findLocalCnUser(identifier: string) {
  const normalized = identifier.trim().toLowerCase();
  return readAll().find((user) => user.phone === normalized || user.email.toLowerCase() === normalized || user.name.toLowerCase() === normalized) || null;
}

export function listLocalCnUsers() { return readAll(); }

export function findLocalCnUserById(id: number) {
  return readAll().find((user) => user.id === id) || null;
}

export function setLocalCnPlatformAdmin(id: number, enabled: boolean) {
  const users = readAll();
  const user = users.find((item) => item.id === id);
  if (!user) throw new Error('找不到该会员');
  user.platformAdmin = enabled;
  writeAll(users);
  return user;
}

export function ensureLocalCnTestAccount() {
  const users = readAll();
  const now = new Date().toISOString();
  const expected: LocalCnUser = {
    id: CAOMI_TEST_ACCOUNT_USER_ID,
    name: '可重置会员',
    phone: '',
    email: 'caomi-flow-test@local.invalid',
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: CAOMI_TEST_ACCOUNT_REFERRAL_CODE,
    referrerCode: CAOMI_OFFICIAL_REFERRAL_CODE,
    platformAdmin: false,
    referralSharingEnabled: true,
    store: null,
    wechatId: null,
    wechatMiniOpenId: null,
    wechatUnionId: null,
    phoneVerifiedAt: now,
    profileAuthorizedAt: now,
    onboardingCompletedAt: now,
    questionnaire: null,
    createdAt: now,
  };
  const index = users.findIndex((user) => user.id === CAOMI_TEST_ACCOUNT_USER_ID);
  const user = index >= 0 ? { ...expected, createdAt: users[index].createdAt || now } : expected;
  if (index >= 0) users[index] = user;
  else users.push(user);
  writeAll(users);
  return user;
}

export function ensureLocalCnAdminTestAccount() {
  const users = readAll();
  const now = new Date().toISOString();
  const expected: LocalCnUser = {
    id: CAOMI_ADMIN_TEST_ACCOUNT_USER_ID,
    name: '英（平台管理员）',
    phone: '',
    email: 'caomi-admin-test@local.invalid',
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: CAOMI_ADMIN_TEST_ACCOUNT_REFERRAL_CODE,
    referrerCode: CAOMI_OFFICIAL_REFERRAL_CODE,
    platformAdmin: true,
    referralSharingEnabled: false,
    store: null,
    wechatId: null,
    wechatMiniOpenId: null,
    wechatUnionId: null,
    phoneVerifiedAt: now,
    profileAuthorizedAt: now,
    onboardingCompletedAt: now,
    questionnaire: null,
    createdAt: now,
  };
  const index = users.findIndex((user) => user.id === CAOMI_ADMIN_TEST_ACCOUNT_USER_ID);
  const user = index >= 0 ? { ...expected, createdAt: users[index].createdAt || now } : expected;
  if (index >= 0) users[index] = user;
  else users.push(user);
  writeAll(users);
  return user;
}

export function ensureLocalCnScootAdminAccount() {
  const users = readAll();
  const existing = users.find((user) => user.id === CAOMI_SCOOT_ADMIN_USER_ID);
  if (existing) return existing;

  const now = new Date().toISOString();
  const user: LocalCnUser = {
    id: CAOMI_SCOOT_ADMIN_USER_ID,
    name: 'Scoot（平台主管）',
    phone: '',
    email: 'caomi-scoot-admin@local.invalid',
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: CAOMI_SCOOT_REFERRAL_CODE,
    referrerCode: CAOMI_OFFICIAL_REFERRAL_CODE,
    platformAdmin: true,
    referralSharingEnabled: true,
    store: null,
    wechatId: null,
    wechatMiniOpenId: null,
    wechatOfficialOpenId: null,
    wechatOpenPlatformOpenId: null,
    wechatUnionId: null,
    phoneVerifiedAt: now,
    profileAuthorizedAt: now,
    onboardingCompletedAt: now,
    questionnaire: null,
    createdAt: now,
  };
  users.push(user);
  writeAll(users);
  console.info(`Created missing Scoot platform-admin account ${CAOMI_SCOOT_ADMIN_USER_ID}`);
  return user;
}

export function normalizeLocalCnBrandDemoKey(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'brand-demo';
}

function demoUserIdForKey(key: string, users: LocalCnUser[]) {
  const digest = createHash('sha256').update(key).digest('hex');
  let id = CAOMI_BRAND_DEMO_USER_BASE_ID + (Number.parseInt(digest.slice(0, 10), 16) % 90_000_000);
  while (users.some((user) => user.id === id && user.email !== `brand-demo-${key}@local.invalid`)) id += 1;
  return id;
}

export function ensureLocalCnBrandDemoMember(input: { demoKey?: string | null; brandName?: string | null }) {
  const users = readAll();
  const key = normalizeLocalCnBrandDemoKey(input.demoKey);
  const email = `brand-demo-${key}@local.invalid`;
  const now = new Date().toISOString();
  const displayName = String(input.brandName || '').trim().slice(0, 80);
  const existing = users.find((user) => user.email.toLowerCase() === email);
  if (existing) {
    if (displayName && existing.name !== `${displayName}品牌方`) {
      existing.name = `${displayName}品牌方`;
      writeAll(users);
    }
    return { user: existing, demoKey: key, isNew: false };
  }
  const id = demoUserIdForKey(key, users);
  const user: LocalCnUser = {
    id,
    name: displayName ? `${displayName}品牌方` : '品牌 Demo 访客',
    phone: '',
    email,
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: `RS-CN-DEMO-${id.toString(36).toUpperCase()}`,
    referrerCode: CAOMI_OFFICIAL_REFERRAL_CODE,
    platformAdmin: false,
    referralSharingEnabled: true,
    store: null,
    wechatId: null,
    wechatMiniOpenId: null,
    wechatOfficialOpenId: null,
    wechatOpenPlatformOpenId: null,
    wechatUnionId: null,
    phoneVerifiedAt: null,
    profileAuthorizedAt: now,
    onboardingCompletedAt: now,
    questionnaire: null,
    createdAt: now,
  };
  users.push(user);
  writeAll(users);
  return { user, demoKey: key, isNew: true };
}

export function ensureLocalCnPilotInvitedMember(input: { inviteKey?: string | null; name?: string | null; contact?: string | null; referrerCode: string }) {
  const users = readAll();
  const key = normalizeLocalCnBrandDemoKey(input.inviteKey || 'brand-pilot');
  const email = `brand-pilot-${key}@local.invalid`;
  const now = new Date().toISOString();
  const displayName = String(input.name || '').trim().slice(0, 80) || '受邀品牌测试会员';
  const contact = String(input.contact || '').trim();
  const existing = users.find((user) => user.email.toLowerCase() === email);
  if (existing) {
    if (displayName && existing.name !== displayName) existing.name = displayName;
    if (!existing.referrerCode) existing.referrerCode = normalizeCnReferrerCode(input.referrerCode);
    writeAll(users);
    return { user: existing, inviteKey: key, isNew: false };
  }
  const id = demoUserIdForKey(`pilot-${key}`, users);
  const user: LocalCnUser = {
    id,
    name: displayName,
    phone: /^1\d{10}$/.test(contact) ? contact : '',
    email: contact.includes('@') ? contact.toLowerCase().slice(0, 120) : email,
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: `RS-CN-PILOT-${id.toString(36).toUpperCase()}`,
    referrerCode: normalizeCnReferrerCode(input.referrerCode),
    platformAdmin: false,
    referralSharingEnabled: true,
    store: null,
    wechatId: null,
    wechatMiniOpenId: null,
    wechatOfficialOpenId: null,
    wechatOpenPlatformOpenId: null,
    wechatUnionId: null,
    phoneVerifiedAt: null,
    profileAuthorizedAt: now,
    onboardingCompletedAt: now,
    questionnaire: null,
    createdAt: now,
  };
  users.push(user);
  writeAll(users);
  return { user, inviteKey: key, isNew: true };
}

export function ensureLocalCnBrandPilotMember(input: { inviteId: string; referrerCode?: string | null; displayName?: string | null }) {
  const users = readAll();
  const key = normalizeLocalCnBrandDemoKey(input.inviteId);
  const email = `brand-pilot-${key}@local.invalid`;
  const now = new Date().toISOString();
  const existing = users.find((user) => user.email.toLowerCase() === email);
  const displayName = String(input.displayName || '').trim().slice(0, 80);
  if (existing) {
    if (displayName && existing.name !== displayName) {
      existing.name = displayName;
      writeAll(users);
    }
    return { user: existing, isNew: false };
  }
  const id = demoUserIdForKey(`pilot:${key}`, users);
  const user: LocalCnUser = {
    id,
    name: displayName || '受邀品牌会员',
    phone: '',
    email,
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: `RS-CN-PILOT-${id.toString(36).toUpperCase()}`,
    referrerCode: normalizeCnReferrerCode(input.referrerCode),
    platformAdmin: false,
    referralSharingEnabled: true,
    store: null,
    wechatId: null,
    wechatMiniOpenId: null,
    wechatOfficialOpenId: null,
    wechatOpenPlatformOpenId: null,
    wechatUnionId: null,
    phoneVerifiedAt: null,
    profileAuthorizedAt: now,
    onboardingCompletedAt: now,
    questionnaire: null,
    createdAt: now,
  };
  users.push(user);
  writeAll(users);
  return { user, isNew: true };
}

export function updateLocalCnUserNickname(id: number, nickname: string) {
  const users = readAll();
  const user = users.find((item) => item.id === id);
  if (!user) throw new Error('找不到该会员');
  const next = String(nickname || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!next) throw new Error('请填写昵称');
  user.name = next;
  writeAll(users);
  return user;
}

export function findLocalCnUserByReferralCode(code: string) {
  const normalized = code.trim().toUpperCase();
  return readAll().find((user) => user.referralCode.toUpperCase() === normalized) || null;
}

export function referralOwnerForAttribution(memberId: number) {
  const user = findLocalCnUserById(memberId);
  if (!user) return null;
  if (user.role !== 'member') return null;
  if (user.referralSharingEnabled === false) return null;
  if (user.promotionQualificationStatus === 'disabled') return null;
  if (!user.referralCode) return null;
  return user;
}

export function localCnPromotionQualification(user: LocalCnUser | null | undefined) {
  if (!user) return { status: 'not_found' as const, canApply: false, reason: 'member_not_found' };
  if (isLocalCnAttributionPending(user)) {
    return {
      status: 'disabled' as const,
      canApply: false,
      reason: 'attribution_pending',
      appliedAt: user.promotionAppliedAt || null,
      approvedAt: user.promotionApprovedAt || null,
      policyVersion: user.promotionPolicyVersion || null,
    };
  }
  if (user.referralSharingEnabled === false) {
    return {
      status: 'disabled' as const,
      canApply: false,
      reason: user.promotionDisabledReason || 'referral_sharing_disabled',
      appliedAt: user.promotionAppliedAt || null,
      approvedAt: user.promotionApprovedAt || null,
      policyVersion: user.promotionPolicyVersion || null,
    };
  }
  if (user.promotionQualificationStatus === 'disabled') {
    return {
      status: 'disabled' as const,
      canApply: false,
      reason: user.promotionDisabledReason || 'promotion_disabled',
      appliedAt: user.promotionAppliedAt || null,
      approvedAt: user.promotionApprovedAt || null,
      policyVersion: user.promotionPolicyVersion || null,
    };
  }
  if (user.promotionQualificationStatus === 'granted') {
    return {
      status: 'granted' as const,
      canApply: false,
      reason: '',
      appliedAt: user.promotionAppliedAt || null,
      approvedAt: user.promotionApprovedAt || null,
      policyVersion: user.promotionPolicyVersion || PROMOTION_QUALIFICATION_POLICY_VERSION,
    };
  }
  return {
    status: 'not_applied' as const,
    canApply: true,
    reason: '',
    appliedAt: user.promotionAppliedAt || null,
    approvedAt: user.promotionApprovedAt || null,
    policyVersion: user.promotionPolicyVersion || null,
  };
}

export function grantLocalCnPromotionQualification(memberId: number, input: { actorId?: number | null; source?: string } = {}) {
  const users = readAll();
  const user = users.find((row) => row.id === memberId);
  if (!user) return { ok: false as const, reason: 'member_not_found' };
  const current = localCnPromotionQualification(user);
  if (current.status === 'disabled') {
    appendPromotionAudit({
      id: `PQA-${Date.now()}-${memberId}`,
      memberId,
      actorId: input.actorId || memberId,
      action: 'grant_rejected',
      result: 'rejected',
      reason: current.reason || 'disabled',
      policyVersion: PROMOTION_QUALIFICATION_POLICY_VERSION,
      createdAt: new Date().toISOString(),
    });
    return { ok: false as const, reason: current.reason || 'disabled', user, qualification: current };
  }
  if (current.status === 'granted') {
    appendPromotionAudit({
      id: `PQA-${Date.now()}-${memberId}`,
      memberId,
      actorId: input.actorId || memberId,
      action: 'grant_idempotent',
      result: 'ignored_existing',
      reason: 'already_granted',
      policyVersion: current.policyVersion || PROMOTION_QUALIFICATION_POLICY_VERSION,
      createdAt: new Date().toISOString(),
    });
    return { ok: true as const, user, qualification: current, idempotent: true };
  }
  const now = new Date().toISOString();
  user.promotionQualificationStatus = 'granted';
  user.promotionAppliedAt = user.promotionAppliedAt || now;
  user.promotionApprovedAt = user.promotionApprovedAt || now;
  user.promotionPolicyVersion = PROMOTION_QUALIFICATION_POLICY_VERSION;
  writeAll(users);
  appendPromotionAudit({
    id: `PQA-${Date.now()}-${memberId}`,
    memberId,
    actorId: input.actorId || memberId,
    action: 'grant',
    result: 'granted',
    reason: input.source || 'self_apply_auto',
    policyVersion: PROMOTION_QUALIFICATION_POLICY_VERSION,
    appliedAt: user.promotionAppliedAt,
    approvedAt: user.promotionApprovedAt,
    createdAt: now,
  });
  return { ok: true as const, user, qualification: localCnPromotionQualification(user), idempotent: false };
}

export function getFrozenReferrerMemberId(user: Pick<LocalCnUser, 'referredByMemberId' | 'referrerCode'> | null | undefined) {
  if (!user) return null;
  if (Number.isInteger(user.referredByMemberId) && Number(user.referredByMemberId) > 0) return Number(user.referredByMemberId);
  const referrer = findLocalCnUserByReferralCode(String(user.referrerCode || ''));
  return referrer?.id || null;
}

export function getFrozenReferrerCode(user: Pick<LocalCnUser, 'referredByMemberId' | 'referrerCode'> | null | undefined) {
  const referrerId = getFrozenReferrerMemberId(user);
  if (referrerId) return findLocalCnUserById(referrerId)?.referralCode || normalizeCnReferrerCode(user?.referrerCode);
  if (user && !user.referrerCode) return '';
  return normalizeCnReferrerCode(user?.referrerCode);
}

export function wouldCreateLocalCnReferralCycle(memberId: number, referrerMemberId: number) {
  if (!memberId || !referrerMemberId) return true;
  if (memberId === referrerMemberId) return true;
  const users = readAll();
  const byId = new Map(users.map((user) => [user.id, user]));
  const seen = new Set<number>([memberId]);
  let cursor = byId.get(referrerMemberId) || null;
  while (cursor) {
    if (seen.has(cursor.id)) return true;
    seen.add(cursor.id);
    const nextId = getFrozenReferrerMemberId(cursor);
    cursor = nextId ? byId.get(nextId) || null : null;
  }
  return false;
}

export function bindImmutableLocalCnReferral(input: {
  memberId: number;
  referrerMemberId: number;
  source: string;
  attributionId?: string | null;
  visitId?: string | null;
}) {
  const users = readAll();
  const member = users.find((user) => user.id === input.memberId);
  const referrer = users.find((user) => user.id === input.referrerMemberId);
  if (!member) return { ok: false as const, reason: 'member_not_found' };
  if (!referrer || !referralOwnerForAttribution(referrer.id)) return { ok: false as const, reason: 'referrer_ineligible' };
  if (member.platformAdmin === true) return { ok: false as const, reason: 'excluded_role' };
  if (getFrozenReferrerMemberId(member)) return { ok: false as const, reason: 'already_bound', member };
  if (wouldCreateLocalCnReferralCycle(member.id, referrer.id)) return { ok: false as const, reason: 'cycle_or_self' };
  const now = new Date().toISOString();
  if (member.referralSource === CAOMI_PENDING_ATTRIBUTION_SOURCE) member.referralSharingEnabled = true;
  member.referredByMemberId = referrer.id;
  member.referrerCode = normalizeCnReferrerCode(referrer.referralCode);
  member.referralBoundAt = now;
  member.referralSource = input.source;
  member.referralAttributionId = input.attributionId || null;
  member.referralVisitId = input.visitId || null;
  writeAll(users);
  return { ok: true as const, member, referrer, boundAt: now };
}

export function createLocalCnInvitedMember(input: { name: string; contact: string; referrerCode: string; invitationId: string }) {
  const users = readAll();
  const now = new Date().toISOString();
  let id = Date.now();
  while (users.some((user) => user.id === id)) id += 1;
  const referralCode = `RS-CN-P${id.toString(36).toUpperCase()}`;
  const contact = String(input.contact || '').trim();
  const user: LocalCnUser = {
    id,
    name: String(input.name || '受邀品牌会员').trim().slice(0, 80) || '受邀品牌会员',
    phone: /^1\d{10}$/.test(contact) ? contact : '',
    email: contact.includes('@') ? contact.toLowerCase().slice(0, 120) : `partner-${id}@local.invalid`,
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode,
    referrerCode: normalizeCnReferrerCode(input.referrerCode),
    platformAdmin: false,
    referralSharingEnabled: true,
    store: null,
    wechatId: null,
    wechatMiniOpenId: null,
    wechatOfficialOpenId: null,
    wechatOpenPlatformOpenId: null,
    wechatUnionId: null,
    phoneVerifiedAt: null,
    profileAuthorizedAt: now,
    onboardingCompletedAt: now,
    questionnaire: null,
    createdAt: now,
  };
  users.push(user);
  writeAll(users);
  return user;
}

export function findLocalCnUserByWechatOpenId(openId: string) {
  const memberId = findLocalCnMemberIdByWechatIdentity('', openId, null);
  return memberId ? findLocalCnUserById(memberId) : null;
}

export function findLocalCnUserByWechatIdentity(openId: string, unionId?: string | null) {
  const users = readAll();
  if (unionId) return users.find((user) => user.wechatUnionId === unionId) || null;
  return null;
}

export function findLocalCnUserByScopedWechatIdentity(appId: string, openId: string, unionId?: string | null) {
  const memberId = findLocalCnMemberIdByWechatIdentity(appId, openId, unionId);
  return memberId ? findLocalCnUserById(memberId) : null;
}

export function isKnownLocalCnReferrerCode(code: string) {
  const normalized = normalizeCnReferrerCode(code);
  return normalized === CAOMI_OFFICIAL_REFERRAL_CODE || Boolean(findLocalCnUserByReferralCode(normalized));
}

export function findOrCreateLocalWechatUser(openId: string, unionId: string | null, displayName: string, referrerCode?: string | null, source: 'mini_program' | 'official_account' | 'open_platform' = 'mini_program', appId?: string | null, verifiedPhone?: string | null, avatarUrl?: string | null) {
  const identitySource: WechatIdentitySource = source === 'official_account' ? 'wechat_official' : source === 'open_platform' ? 'wechat_open' : 'wechat_mini_program';
  if (appId) {
    const resolved = resolveLocalCnWechatIdentity({
      source: identitySource,
      appId,
      openId,
      unionId,
      verifiedPhone,
      displayName,
      avatarUrl,
      referrerCode,
    });
    if (resolved.status === 'needs_phone') throw new Error(resolved.reason);
    return { user: resolved.user, isNew: resolved.isNewMember };
  }

  const users = readAll();
  const existing = users.find((user) => (
    Boolean(unionId && user.wechatUnionId === unionId)
    || (source === 'mini_program' && user.wechatMiniOpenId === openId)
    || (source === 'official_account' && user.wechatOfficialOpenId === openId)
    || (source === 'open_platform' && user.wechatOpenPlatformOpenId === openId)
  ));
  const shouldBePlatformAdmin = configuredPlatformAdminOpenIds().has(openId);
  if (existing) {
    if (source === 'official_account') existing.wechatOfficialOpenId = openId;
    else existing.wechatMiniOpenId = openId;
    if (unionId && !existing.wechatUnionId) existing.wechatUnionId = unionId;
    if (displayName && displayName !== '微信会员' && !displayName.startsWith('微信会员_')) existing.name = displayName;
    else if (displayName && (!existing.name || existing.name === '微信会员')) existing.name = displayName;
    if (shouldBePlatformAdmin && !existing.platformAdmin) {
      existing.platformAdmin = true;
    }
    writeAll(users);
    return { user: existing, isNew: false };
  }
  let id = Number.parseInt(Buffer.from(openId).toString('hex').slice(0, 10), 16) || Date.now();
  while (users.some((user) => user.id === id)) id += 1;
  const now = new Date().toISOString();
  const explicitReferrerCode = explicitCnReferrerCode(referrerCode);
  const referrer = explicitReferrerCode ? users.find((user) => user.referralCode.toUpperCase() === explicitReferrerCode) || null : null;
  const pendingAttribution = !referrer;
  const user: LocalCnUser = {
    id,
    name: displayName || '微信会员',
    phone: '',
    email: `wechat-mini-${id}@local.invalid`,
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: `RS-CN-WX${id.toString(36).toUpperCase()}`,
    referrerCode: pendingAttribution ? null : normalizeCnReferrerCode(referrer.referralCode),
    referredByMemberId: referrer?.id || null,
    referralBoundAt: pendingAttribution ? null : now,
    referralSource: pendingAttribution ? CAOMI_PENDING_ATTRIBUTION_SOURCE : source,
    referralAttributionId: null,
    referralVisitId: null,
    platformAdmin: shouldBePlatformAdmin,
    referralSharingEnabled: !pendingAttribution,
    store: null,
    wechatId: openId,
    wechatMiniOpenId: source === 'mini_program' ? openId : null,
    wechatOfficialOpenId: source === 'official_account' ? openId : null,
    wechatUnionId: unionId,
    phoneVerifiedAt: null,
    createdAt: now,
  };
  users.push(user);
  writeAll(users);
  return { user, isNew: true };
}

export function updateLocalWechatProfile(
  currentUserId: number,
  input: { name?: string; avatarUrl?: string; referrerCode?: string },
) {
  const users = readAll();
  const current = users.find((user) => user.id === currentUserId);
  if (!current?.wechatMiniOpenId) throw new Error('当前会员尚未绑定微信身份');
  const now = new Date().toISOString();
  const name = String(input.name || '').trim();
  const avatarUrl = String(input.avatarUrl || '').trim();
  const referrerCode = String(input.referrerCode || '').trim().toUpperCase();
  if (name) current.name = name.slice(0, 80);
  if (avatarUrl && /^https:\/\//.test(avatarUrl)) current.avatarUrl = avatarUrl.slice(0, 1000);
  if (!current.referrerCode && !isLocalCnAttributionPending(current)) current.referrerCode = normalizeCnReferrerCode(referrerCode);
  current.profileAuthorizedAt = now;
  current.onboardingCompletedAt = current.onboardingCompletedAt || now;
  writeAll(users);
  return current;
}

export function completeLocalWechatOnboarding(
  currentUserId: number,
  input: { gender?: string; birthYear?: string; healthGoal?: string; store?: string; referrerCode?: string },
) {
  const users = readAll();
  const current = users.find((user) => user.id === currentUserId);
  if (!current?.wechatMiniOpenId) throw new Error('当前会员尚未绑定微信身份');
  const healthGoal = String(input.healthGoal || '').trim();
  if (!healthGoal) throw new Error('请选择目前最关注的健康方向');
  const birthYear = String(input.birthYear || '').trim();
  if (birthYear && (!/^\d{4}$/.test(birthYear) || Number(birthYear) < 1900 || Number(birthYear) > new Date().getFullYear())) {
    throw new Error('出生年份格式不正确');
  }
  const store = String(input.store || '').trim().slice(0, 100);
  const referrerCode = String(input.referrerCode || '').trim().toUpperCase();
  current.questionnaire = {
    gender: String(input.gender || '').trim().slice(0, 20),
    birthYear,
    healthGoal: healthGoal.slice(0, 100),
    store,
  };
  if (store) current.store = store;
  if (!current.referrerCode && !isLocalCnAttributionPending(current)) current.referrerCode = normalizeCnReferrerCode(referrerCode);
  current.onboardingCompletedAt = new Date().toISOString();
  writeAll(users);
  return current;
}

export function bindLocalWechatVerifiedPhone(currentUserId: number, phone: string) {
  const users = readAll();
  const current = users.find((user) => user.id === currentUserId);
  if (!current?.wechatMiniOpenId) throw new Error('当前会员尚未绑定微信身份');
  const normalized = normalizeStoredVerifiedPhone(phone);
  const target = users.find((user) => {
    if (user.id === currentUserId || !user.phone) return false;
    try {
      // Comparison only: CN local and +86 contacts represent the same phone.
      const key = (value: string) => /^1\d{10}$/.test(value) ? `+86${value}` : value;
      return key(normalizeStoredVerifiedPhone(user.phone)) === key(normalized);
    } catch { return false; }
  });
  // Provider phone ownership cannot authorize transferring another member's
  // Wechat binding or deleting the authenticated member and its referral data.
  if (target) throw new Error('无法确认原会员归属，不能按联系手机号转移微信绑定或合并会员');
  const now = new Date().toISOString();
  current.phone = normalized;
  current.phoneVerifiedAt = now;
  writeAll(users);
  return current;
}

export function createLocalCnUser(input: Omit<LocalCnUser, 'id' | 'createdAt'>) {
  return withLocalCnUsersWriteLock(() => {
    const users = readAll();
    if (users.some((user) => (Boolean(input.phone) && user.phone === input.phone) || (Boolean(input.email) && user.email.toLowerCase() === input.email.toLowerCase()))) return null;
    const id = users.reduce((next, user) => Math.max(next, user.id + 1), Date.now());
    const user: LocalCnUser = { ...input, referrerCode: normalizeCnReferrerCode(input.referrerCode), id, createdAt: new Date().toISOString() };
    users.push(user);
    writeAll(users);
    return user;
  });
}

export function resetLocalCnVerifiedEmailPassword(memberId: number, email: string, passwordHash: string) {
  return withLocalCnUsersWriteLock(() => {
    const users = readAll();
    const user = users.find(row => row.id === memberId && row.email === email && row.emailVerifiedAt && row.emailRegistrationId);
    if (!user) return null;
    user.passwordHash = passwordHash;
    user.emailCredentialVersion = (user.emailCredentialVersion || 1) + 1;
    writeAll(users);
    return user;
  });
}


export function findOrCreateLocalPhoneUser(input: {
  phone: string;
  displayName?: string | null;
  referrerCode?: string | null;
  referredByMemberId?: number | null;
  referralAttributionId?: string | null;
  referralVisitId?: string | null;
}) {
  return withLocalCnUsersWriteLock(() => {
    const rawPhone = String(input.phone || '').trim().replace(/[\s-]/g, '');
    const normalizedPhone = /^1[3-9]\d{9}$/.test(rawPhone)
      ? rawPhone
      : /^09\d{8}$/.test(rawPhone)
        ? `+886${rawPhone.slice(1)}`
        : normalizeStoredVerifiedPhone(rawPhone);
    const users = readAll();
    const key = (val: string) => /^1\d{10}$/.test(val) ? `+86${val}` : val;
    const existing = users.find((u) => u.phone && key(u.phone) === key(normalizedPhone));
    const now = new Date().toISOString();
    if (existing) {
      existing.phoneVerifiedAt = existing.phoneVerifiedAt || now;
      const customName = String(input.displayName || '').trim();
      if (customName && (!existing.name || existing.name.startsWith('手机会员'))) {
        existing.name = customName.slice(0, 80);
      }
      writeAll(users);
      return { user: existing, isNew: false };
    }
    let id = Date.now();
    while (users.some((u) => u.id === id)) id += 1;
    const explicitRefCode = explicitCnReferrerCode(input.referrerCode);
    const referrer = (input.referredByMemberId ? users.find((u) => u.id === input.referredByMemberId) : null)
      || (explicitRefCode ? users.find((u) => u.referralCode.toUpperCase() === explicitRefCode) : null)
      || null;
    const pendingAttribution = !referrer;
    const suffix = normalizedPhone.slice(-4);
    const displayName = String(input.displayName || '').trim().slice(0, 80) || `手机会员${suffix}`;
    const user: LocalCnUser = {
      id,
      name: displayName,
      phone: normalizedPhone,
      email: `phone-${id}@local.invalid`,
      passwordHash: '',
      role: 'member',
      agentLevel: 1,
      referralCode: `RS-CN-M${id.toString(36).toUpperCase()}`,
      referrerCode: referrer ? normalizeCnReferrerCode(referrer.referralCode) : null,
      referredByMemberId: referrer?.id || null,
      referralBoundAt: pendingAttribution ? null : now,
      referralSource: pendingAttribution ? CAOMI_PENDING_ATTRIBUTION_SOURCE : 'phone_sms',
      referralAttributionId: pendingAttribution ? null : input.referralAttributionId || null,
      referralVisitId: pendingAttribution ? null : input.referralVisitId || null,
      platformAdmin: false,
      referralSharingEnabled: !pendingAttribution,
      ...(pendingAttribution ? {} : {
        promotionQualificationStatus: 'granted' as const,
        promotionAppliedAt: now,
        promotionApprovedAt: now,
        promotionPolicyVersion: PROMOTION_QUALIFICATION_POLICY_VERSION,
      }),
      store: null,
      wechatId: null,
      wechatMiniOpenId: null,
      wechatOfficialOpenId: null,
      wechatOpenPlatformOpenId: null,
      wechatUnionId: null,
      phoneVerifiedAt: now,
      profileAuthorizedAt: now,
      onboardingCompletedAt: now,
      questionnaire: null,
      createdAt: now,
    };
    users.push(user);
    writeAll(users);
    return { user, isNew: true };
  });
}

export function updateLocalCnMemberProfile(
  memberId: number,
  input: {
    name?: string;
    avatarUrl?: string;
    store?: string;
    phone?: string;
    email?: string;
    wechatId?: string;
    referrerCode?: string;
  },
) {
  return withLocalCnUsersWriteLock(() => {
    const users = readAll();
    const current = users.find((user) => user.id === memberId);
    if (!current) throw new Error("找不到当前会员");
    const now = new Date().toISOString();
    const name = String(input.name || "").trim();
    const avatarUrl = String(input.avatarUrl || "").trim();
    const store = String(input.store || "").trim();
    const phone = String(input.phone || "").trim();
    const email = String(input.email || "").trim();
    const wechatId = String(input.wechatId || "").trim();
    const referrerCode = String(input.referrerCode || "").trim().toUpperCase();
    if (name) current.name = name.slice(0, 80);
    if (avatarUrl && /^https?:\/\//.test(avatarUrl)) current.avatarUrl = avatarUrl.slice(0, 1000);
    if (store) current.store = store.slice(0, 100);
    if (phone && !phone.includes("免")) current.phone = phone.slice(0, 30);
    if (email && email.includes("@") && !email.includes("免")) current.email = email.toLowerCase().slice(0, 120);
    if (wechatId) current.wechatId = wechatId.slice(0, 80);
    if (referrerCode) {
      const normalizedRef = normalizeCnReferrerCode(referrerCode);
      const refUser = users.find((u) => u.referralCode.toUpperCase() === normalizedRef && u.id !== current.id);
      if (refUser) {
        if (current.referralSource === CAOMI_PENDING_ATTRIBUTION_SOURCE) {
          current.referralSource = 'member_profile_code';
          current.referralSharingEnabled = true;
        }
        current.referrerCode = refUser.referralCode;
        current.referredByMemberId = refUser.id;
        current.referralBoundAt = current.referralBoundAt || now;
      } else if (!isLocalCnAttributionPending(current)) {
        current.referrerCode = normalizedRef;
      }
    }
    current.profileAuthorizedAt = current.profileAuthorizedAt || now;
    current.onboardingCompletedAt = current.onboardingCompletedAt || now;
    writeAll(users);
    return current;
  });
}

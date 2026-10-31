import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { normalizeStoredVerifiedPhone } from '@/lib/international-phone';
import { withLocalCnUsersWriteLock, type LocalCnUser } from '@/lib/local-cn-users';

const CAOMI_OFFICIAL_REFERRAL_CODE = 'RS-CN-OFFICIAL';

function normalizeCnReferrerCode(code?: string | null) {
  const normalized = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 100);
  return normalized || CAOMI_OFFICIAL_REFERRAL_CODE;
}

export type WechatIdentitySource = 'wechat_mini_program' | 'wechat_official' | 'wechat_open';

export type LocalCnMemberIdentity = {
  id: string;
  memberId: number;
  provider: 'wechat';
  source: WechatIdentitySource;
  appId: string;
  openId: string;
  unionId: string | null;
  verifiedPhone: string | null;
  displayName: string;
  avatarUrl: string;
  createdAt: string;
  lastLoginAt: string;
};

export type LocalCnMemberIdentityAudit = {
  id: string;
  memberId: number;
  action: 'linked' | 'merged_by_unionid' | 'merged_by_phone' | 'login';
  source: WechatIdentitySource;
  appId: string;
  openId: string;
  unionId: string | null;
  verifiedPhone: string | null;
  createdAt: string;
};

type IdentityState = {
  schemaVersion: 1;
  identities: LocalCnMemberIdentity[];
  audit: LocalCnMemberIdentityAudit[];
};

export type ResolveWechatIdentityInput = {
  source: WechatIdentitySource;
  appId: string;
  openId: string;
  unionId?: string | null;
  verifiedPhone?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  referrerCode?: string | null;
};

export type ResolveWechatIdentityResult =
  | { status: 'linked'; user: LocalCnUser; identity: LocalCnMemberIdentity; isNewMember: boolean }
  | { status: 'needs_phone'; reason: string };

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function identitiesPath() {
  return path.join(dataDir(), 'cn-member-identities.json');
}

function usersPath() {
  return path.join(dataDir(), 'cn-users.json');
}

function emptyState(): IdentityState {
  return { schemaVersion: 1, identities: [], audit: [] };
}

function readState(): IdentityState {
  try {
    if (!existsSync(identitiesPath())) return emptyState();
    const parsed = JSON.parse(readFileSync(identitiesPath(), 'utf8'));
    return {
      schemaVersion: 1,
      identities: Array.isArray(parsed.identities) ? parsed.identities : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: IdentityState) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${identitiesPath()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, identitiesPath());
}

function readUsers(): LocalCnUser[] {
  try {
    if (!existsSync(usersPath())) return [];
    const parsed = JSON.parse(readFileSync(usersPath(), 'utf8'));
    return Array.isArray(parsed)
      ? parsed.map((user) => ({ ...user, referrerCode: normalizeCnReferrerCode(user.referrerCode) }))
      : [];
  } catch {
    return [];
  }
}

function writeUsers(users: LocalCnUser[]) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${usersPath()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(users, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, usersPath());
}

function isKnownLocalCnReferrerCode(code: string, users = readUsers()) {
  const normalized = normalizeCnReferrerCode(code);
  return normalized === CAOMI_OFFICIAL_REFERRAL_CODE || users.some((user) => user.referralCode.toUpperCase() === normalized);
}

function nextMemberId(users: LocalCnUser[], seed: string) {
  let id = Number.parseInt(Buffer.from(seed).toString('hex').slice(0, 10), 16) || Date.now();
  while (users.some((user) => user.id === id)) id += 1;
  return id;
}

function createUser(users: LocalCnUser[], input: ResolveWechatIdentityInput, now: string) {
  if (!input.referrerCode) throw new Error('请从邀请链接进入完成会员注册');
  if (!isKnownLocalCnReferrerCode(input.referrerCode, users)) throw new Error('找不到该推荐码，请向推荐人确认');
  const normalizedReferrerCode = normalizeCnReferrerCode(input.referrerCode || CAOMI_OFFICIAL_REFERRAL_CODE);
  const referrer = users.find((user) => user.referralCode.toUpperCase() === normalizedReferrerCode) || null;
  const id = nextMemberId(users, `${input.appId}:${input.openId}`);
  const user: LocalCnUser = {
    id,
    name: input.displayName || '微信会员',
    phone: input.verifiedPhone ? normalizeStoredVerifiedPhone(input.verifiedPhone) : '',
    email: `wechat-${id}@local.invalid`,
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: `RS-CN-WX${id.toString(36).toUpperCase()}`,
    referrerCode: normalizedReferrerCode,
    referredByMemberId: referrer?.id || null,
    referralBoundAt: now,
    referralSource: input.source,
    referralAttributionId: null,
    referralVisitId: null,
    platformAdmin: false,
    referralSharingEnabled: true,
    promotionQualificationStatus: 'granted',
    promotionAppliedAt: now,
    promotionApprovedAt: now,
    store: null,
    wechatId: null,
    wechatMiniOpenId: input.source === 'wechat_mini_program' ? input.openId : null,
    wechatOfficialOpenId: input.source === 'wechat_official' ? input.openId : null,
    wechatOpenPlatformOpenId: input.source === 'wechat_open' ? input.openId : null,
    wechatUnionId: input.unionId || null,
    phoneVerifiedAt: input.verifiedPhone ? now : null,
    profileAuthorizedAt: now,
    onboardingCompletedAt: input.source === 'wechat_mini_program' ? null : now,
    questionnaire: null,
    createdAt: now,
  };
  users.push(user);
  return user;
}

function updateLegacyWechatFields(user: LocalCnUser, input: ResolveWechatIdentityInput, now: string) {
  if (input.source === 'wechat_mini_program') user.wechatMiniOpenId = input.openId;
  if (input.source === 'wechat_official') user.wechatOfficialOpenId = input.openId;
  if (input.source === 'wechat_open') user.wechatOpenPlatformOpenId = input.openId;
  if (input.unionId && !user.wechatUnionId) user.wechatUnionId = input.unionId;
  if (input.verifiedPhone) {
    user.phone = normalizeStoredVerifiedPhone(input.verifiedPhone);
    user.phoneVerifiedAt = now;
  }
  if (input.displayName && input.displayName !== '微信会员' && !input.displayName.startsWith('微信会员_')) user.name = input.displayName;
  else if (input.displayName && (!user.name || user.name === '微信会员')) user.name = input.displayName;
  if (input.avatarUrl) user.avatarUrl = input.avatarUrl;
  user.profileAuthorizedAt = user.profileAuthorizedAt || now;
}

function audit(state: IdentityState, action: LocalCnMemberIdentityAudit['action'], identity: LocalCnMemberIdentity, now: string) {
  state.audit.unshift({
    id: `WXA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    memberId: identity.memberId,
    action,
    source: identity.source,
    appId: identity.appId,
    openId: identity.openId,
    unionId: identity.unionId,
    verifiedPhone: identity.verifiedPhone,
    createdAt: now,
  });
  state.audit = state.audit.slice(0, 1000);
}

export function listLocalCnMemberIdentities() {
  return readState();
}

export function findLocalCnMemberIdByWechatIdentity(appId: string, openId: string, unionId?: string | null) {
  const state = readState();
  const exact = state.identities.find((identity) => identity.appId === appId && identity.openId === openId);
  if (exact) return exact.memberId;
  if (unionId) return state.identities.find((identity) => identity.unionId === unionId)?.memberId || null;
  return null;
}

function matchesStoredVerifiedPhone(phone: string | null | undefined, verifiedPhone: string) {
  if (!phone) return false;
  try {
    // Collision equivalence only; do not rewrite stored phones or select members.
    const key = (value: string) => /^1\d{10}$/.test(value) ? `+86${value}` : value;
    return key(normalizeStoredVerifiedPhone(phone)) === key(normalizeStoredVerifiedPhone(verifiedPhone));
  } catch {
    return false;
  }
}

function assertWechatIdentityMember(state: IdentityState, users: LocalCnUser[], memberId: number, input: ResolveWechatIdentityInput) {
  const user = users.find((row) => row.id === memberId);
  if (!user) throw new Error('微信身份关联的会员不存在');
  if (state.identities.some((row) => row.appId === input.appId && row.openId === input.openId && row.memberId !== memberId)) {
    throw new Error('该微信身份已绑定其他会员');
  }

  const memberIdentities = state.identities.filter((row) => row.memberId === memberId);
  const unionIds = new Set([input.unionId, user.wechatUnionId, ...memberIdentities.map((row) => row.unionId)].filter(Boolean));
  if (unionIds.size > 1) throw new Error('当前会员已绑定不同的微信 UnionID，不能替换');
  for (const unionId of Array.from(unionIds)) {
    if (state.identities.some((row) => row.unionId === unionId && row.memberId !== memberId)
      || users.some((row) => row.wechatUnionId === unionId && row.id !== memberId)) {
      throw new Error('该微信 UnionID 已绑定其他会员');
    }
  }

  // Check both incoming and stored evidence before changing either persistence file.
  const verifiedPhones = new Set([
    input.verifiedPhone,
    user.phoneVerifiedAt ? user.phone : null,
    ...memberIdentities.map((row) => row.verifiedPhone),
  ].filter(Boolean).map((phone) => normalizeStoredVerifiedPhone(phone)));
  for (const phone of Array.from(verifiedPhones)) {
    if (state.identities.some((row) => matchesStoredVerifiedPhone(row.verifiedPhone, phone) && row.memberId !== memberId)
      || users.some((row) => matchesStoredVerifiedPhone(row.phone, phone) && row.id !== memberId)) {
      throw new Error('该已验证手机号已关联其他会员');
    }
  }
}

export function resolveLocalCnWechatIdentity(input: ResolveWechatIdentityInput): ResolveWechatIdentityResult {
  return withLocalCnUsersWriteLock(() => {
  const openId = String(input.openId || '').trim();
  const appId = String(input.appId || '').trim();
  if (!appId || !openId) throw new Error('微信身份资料不完整');

  const now = new Date().toISOString();
  const state = readState();
  const users = readUsers();
  const unionId = input.unionId ? String(input.unionId) : null;
  const verifiedPhone = input.verifiedPhone ? normalizeStoredVerifiedPhone(input.verifiedPhone) : null;
  const normalizedInput = { ...input, appId, openId, unionId, verifiedPhone };

  let identity = state.identities.find((row) => row.appId === appId && row.openId === openId) || null;
  let memberId = identity?.memberId || null;
  let action: LocalCnMemberIdentityAudit['action'] = identity ? 'login' : 'linked';
  let isNewMember = false;

  if (!memberId && unionId) {
    memberId = state.identities.find((row) => row.unionId === unionId)?.memberId || users.find((user) => user.wechatUnionId === unionId)?.id || null;
    if (memberId) action = 'merged_by_unionid';
  }

  // A phone claim (even with legacy verification timestamps) is not proof of
  // ownership of an existing member. Keep selection on provider identity IDs.
  if (!memberId && !unionId) {
    return { status: 'needs_phone', reason: '无法确认原会员归属，请先登录原会员后绑定微信；不会按联系手机号自动合并' };
  }

  if (memberId) assertWechatIdentityMember(state, users, memberId, normalizedInput);
  let user = memberId ? users.find((row) => row.id === memberId) || null : null;
  if (!user) {
    user = createUser(users, normalizedInput, now);
    memberId = user.id;
    isNewMember = true;
  }
  const resolvedMemberId = memberId || user.id;

  updateLegacyWechatFields(user, normalizedInput, now);

  if (!identity) {
    identity = {
      id: `${input.source}:${appId}:${openId}`,
      memberId: resolvedMemberId,
      provider: 'wechat',
      source: input.source,
      appId,
      openId,
      unionId,
      verifiedPhone,
      displayName: input.displayName || '',
      avatarUrl: input.avatarUrl || '',
      createdAt: now,
      lastLoginAt: now,
    };
    state.identities.push(identity);
  } else {
    identity.memberId = resolvedMemberId;
    identity.unionId = unionId || identity.unionId;
    identity.verifiedPhone = verifiedPhone || identity.verifiedPhone;
    identity.displayName = input.displayName || identity.displayName;
    identity.avatarUrl = input.avatarUrl || identity.avatarUrl;
    identity.lastLoginAt = now;
  }

  const resolvedIdentity = identity;
  audit(state, action, resolvedIdentity, now);
  writeUsers(users);
  writeState(state);

  return { status: 'linked', user, identity: resolvedIdentity, isNewMember };
  });
}

export function mergeLocalCnWechatIdentityByVerifiedPhone(memberId: number, phone: string) {
  const user = readUsers().find((row) => row.id === memberId) || null;
  if (!user) throw new Error('找不到会员');
  const normalized = normalizeStoredVerifiedPhone(phone);
  const state = readState();
  const identity = state.identities.find((row) => row.memberId === memberId);
  if (!identity) throw new Error('当前会员没有微信身份');
  return resolveLocalCnWechatIdentity({
    source: identity.source,
    appId: identity.appId,
    openId: identity.openId,
    unionId: identity.unionId,
    verifiedPhone: normalized,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    referrerCode: user.referrerCode,
  });
}

export function linkLocalCnWechatIdentityToMember(memberId: number, input: ResolveWechatIdentityInput) {
  return withLocalCnUsersWriteLock(() => {
  const openId = String(input.openId || '').trim();
  const appId = String(input.appId || '').trim();
  if (!appId || !openId) throw new Error('微信身份资料不完整');
  const now = new Date().toISOString();
  const state = readState();
  const users = readUsers();
  const user = users.find((row) => row.id === memberId);
  if (!user) throw new Error('找不到当前会员');
  const existing = state.identities.find((row) => row.appId === appId && row.openId === openId);
  const unionId = input.unionId ? String(input.unionId) : null;
  const verifiedPhone = input.verifiedPhone ? normalizeStoredVerifiedPhone(input.verifiedPhone) : null;
  const normalizedInput = { ...input, appId, openId, unionId, verifiedPhone };
  assertWechatIdentityMember(state, users, memberId, normalizedInput);
  let identity = existing || null;
  updateLegacyWechatFields(user, normalizedInput, now);
  if (!identity) {
    identity = {
      id: `${input.source}:${appId}:${openId}`,
      memberId,
      provider: 'wechat',
      source: input.source,
      appId,
      openId,
      unionId,
      verifiedPhone,
      displayName: input.displayName || '',
      avatarUrl: input.avatarUrl || '',
      createdAt: now,
      lastLoginAt: now,
    };
    state.identities.push(identity);
  } else {
    identity.unionId = unionId || identity.unionId;
    identity.verifiedPhone = verifiedPhone || identity.verifiedPhone;
    identity.displayName = input.displayName || identity.displayName;
    identity.avatarUrl = input.avatarUrl || identity.avatarUrl;
    identity.lastLoginAt = now;
  }
  audit(state, 'linked', identity, now);
  writeUsers(users);
  writeState(state);
  return { user, identity };
  });
}

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { hasPlatformAdminAccess, type SessionUser } from './auth';
import { CAOMI_SCOOT_REFERRAL_CODE, ensureLocalCnBrandPilotMember, ensureLocalCnScootAdminAccount, isKnownLocalCnReferrerCode, normalizeCnReferrerCode, updateLocalCnUserNickname, type LocalCnUser } from './local-cn-users';

type InviteStatus = 'pending' | 'consumed' | 'revoked' | 'expired' | 'locked';
type ChallengeStatus = 'pending' | 'active' | 'consumed' | 'revoked' | 'expired' | 'locked';

const PERMANENT_ACCESS_EXPIRES_AT = '2099-12-31T23:59:59.999Z';

type SecureInvite = {
  id: string;
  tokenHash: string;
  codeHash: string;
  referralCode?: string;
  nickname?: string;
  identityCompletedAt?: string | null;
  status: InviteStatus;
  persistentAccess?: boolean;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  attempts: number;
  lockedUntil: string | null;
  createdBy: number;
  createdAt: string;
  consumedAt: string | null;
  lastUsedAt?: string | null;
  memberId: number | null;
  brandId: number | null;
  idempotencyKey: string | null;
};

type AuthChallenge = {
  id: string;
  codeHash: string;
  status: ChallengeStatus;
  persistentAccess?: boolean;
  memberId: number;
  brandId: number;
  expiresAt: string;
  attempts: number;
  lockedUntil: string | null;
  createdBy: number;
  createdAt: string;
  consumedAt: string | null;
  lastUsedAt?: string | null;
};

type Audit = {
  id: string;
  action: string;
  actorId: number | null;
  inviteId?: string;
  challengeId?: string;
  memberId?: number | null;
  brandId?: number | null;
  detail: string;
  createdAt: string;
};

type State = {
  schemaVersion: 2;
  invites: SecureInvite[];
  challenges: AuthChallenge[];
  audit: Audit[];
};

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function filePath() {
  return path.join(dataDir(), 'cn-brand-demo-access.json');
}

function emptyState(): State {
  return { schemaVersion: 2, invites: [], challenges: [], audit: [] };
}

function text(value: unknown, max = 120) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeInvite(row: Record<string, unknown>): SecureInvite {
  const nickname = text(row.nickname || row.contactName);
  return {
    ...(row as unknown as SecureInvite),
    nickname,
    persistentAccess: row.persistentAccess === true,
    lastUsedAt: row.lastUsedAt ? String(row.lastUsedAt) : null,
    identityCompletedAt: row.identityCompletedAt ? String(row.identityCompletedAt) : nickname ? String(row.consumedAt || row.createdAt || '') || null : null,
  };
}

function normalizeChallenge(row: Record<string, unknown>): AuthChallenge {
  return {
    ...(row as unknown as AuthChallenge),
    persistentAccess: row.persistentAccess === true || row.status === 'active',
    lastUsedAt: row.lastUsedAt ? String(row.lastUsedAt) : null,
  };
}

function readState(): State {
  if (!existsSync(filePath())) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(filePath(), 'utf8'));
    return {
      schemaVersion: 2,
      invites: Array.isArray(parsed.invites) ? parsed.invites.map(normalizeInvite) : [],
      challenges: Array.isArray(parsed.challenges) ? parsed.challenges.map(normalizeChallenge) : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: State) {
  mkdirSync(dataDir(), { recursive: true });
  const target = filePath();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
}

function withWrite<T>(operation: (state: State) => T): T {
  if (process.env.DATABASE_URL) throw new Error('DATABASE_URL 已配置时不得写入本地 JSON Demo 资料');
  const state = readState();
  try {
    const result = operation(state);
    writeState(state);
    return result;
  } catch (error) {
    writeState(state);
    throw error;
  }
}

function digest(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function safeDigestEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function randomSecret(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function nowIso() {
  return new Date().toISOString();
}

function isExpired(expiresAt: string) {
  return new Date(expiresAt).getTime() <= Date.now();
}

function audit(state: State, row: Omit<Audit, 'id' | 'createdAt'>) {
  state.audit.unshift({ id: `BDA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: nowIso(), ...row });
  state.audit = state.audit.slice(0, 1000);
}

function requireAdmin(user: SessionUser | null | undefined) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台管理员可建立或撤销受邀测试登录');
}

function publicInvite(invite: SecureInvite) {
  const status: InviteStatus = invite.status === 'pending' && !invite.persistentAccess && isExpired(invite.expiresAt) ? 'expired' : invite.status;
  return {
    id: invite.id,
    status,
    expiresAt: invite.persistentAccess ? null : invite.expiresAt,
    persistentAccess: invite.persistentAccess === true,
    useCount: invite.useCount,
    maxUses: invite.maxUses,
    memberId: invite.memberId,
    brandId: invite.brandId,
    referralCode: invite.referralCode || '',
    nickname: invite.nickname || '',
    identityComplete: Boolean(invite.nickname),
    createdAt: invite.createdAt,
    consumedAt: invite.consumedAt,
    lastUsedAt: invite.lastUsedAt || invite.consumedAt,
  };
}

function publicAccessLink(challenge: AuthChallenge) {
  return {
    id: challenge.id,
    status: challenge.status,
    persistentAccess: challenge.persistentAccess === true,
    expiresAt: null,
    memberId: challenge.memberId,
    brandId: challenge.brandId,
    createdAt: challenge.createdAt,
    lastUsedAt: challenge.lastUsedAt || challenge.consumedAt,
  };
}

export function inspectBrandDemoInvite(token: string) {
  const state = readState();
  const tokenHash = digest(token);
  const invite = state.invites.find((row) => safeDigestEqual(row.tokenHash, tokenHash));
  return invite ? publicInvite(invite) : null;
}

export function isLocalBrandPilotMemberId(memberId: number) {
  const id = Number(memberId);
  if (!Number.isFinite(id)) return false;
  const state = readState();
  return state.invites.some((invite) => invite.status === 'consumed' && Number(invite.memberId) === id);
}

export function createBrandDemoInvite(admin: SessionUser | null | undefined, input: { expiresInMinutes?: number; expiresInSeconds?: number; maxUses?: number; referralCode?: string; persistentAccess?: boolean } = {}) {
  requireAdmin(admin);
  ensureLocalCnScootAdminAccount();
  const referralCode = normalizeCnReferrerCode(input.referralCode || CAOMI_SCOOT_REFERRAL_CODE);
  if (!isKnownLocalCnReferrerCode(referralCode)) throw new Error('推荐码不存在，不能建立无推荐人的测试登录');
  const token = randomSecret();
  const code = randomCode();
  const now = nowIso();
  const persistentAccess = input.persistentAccess === true;
  const expiresInMs = Number.isFinite(Number(input.expiresInSeconds))
    ? Math.min(Math.max(Number(input.expiresInSeconds), 1), 60 * 60 * 24 * 30) * 1000
    : Math.min(Math.max(Number(input.expiresInMinutes || 60 * 24 * 7), 5), 60 * 24 * 30) * 60_000;
  const maxUses = Math.min(Math.max(Number(input.maxUses || 1), 1), 5);
  return withWrite((state) => {
    const invite: SecureInvite = {
      id: `BDI-${Date.now()}-${randomBytes(4).toString('hex')}`,
      tokenHash: digest(token),
      codeHash: digest(code),
      referralCode,
      nickname: '',
      identityCompletedAt: null,
      status: 'pending',
      persistentAccess,
      expiresAt: persistentAccess ? PERMANENT_ACCESS_EXPIRES_AT : new Date(Date.now() + expiresInMs).toISOString(),
      maxUses,
      useCount: 0,
      attempts: 0,
      lockedUntil: null,
      createdBy: admin!.id,
      createdAt: now,
      consumedAt: null,
      lastUsedAt: null,
      memberId: null,
      brandId: null,
      idempotencyKey: null,
    };
    state.invites.unshift(invite);
    audit(state, { action: 'invite.created', actorId: admin!.id, inviteId: invite.id, detail: `平台建立${persistentAccess ? '长期专属' : '短效'}受邀测试登录，推荐码 ${referralCode}` });
    return { invite: publicInvite(invite), token, code };
  });
}

export function revokeBrandDemoInvite(admin: SessionUser | null | undefined, token: string) {
  requireAdmin(admin);
  return withWrite((state) => {
    const tokenHash = digest(token);
    const invite = state.invites.find((row) => safeDigestEqual(row.tokenHash, tokenHash));
    if (!invite) throw new Error('找不到邀请');
    invite.status = 'revoked';
    audit(state, { action: 'invite.revoked', actorId: admin!.id, inviteId: invite.id, detail: '平台撤销受邀测试登录' });
    return publicInvite(invite);
  });
}

function assertCode(row: SecureInvite | AuthChallenge, code: string, state: State, auditBase: Omit<Audit, 'id' | 'createdAt' | 'action' | 'detail'>) {
  if (row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()) throw new Error('验证码错误次数过多，请稍后再试');
  if (!safeDigestEqual(row.codeHash, digest(code))) {
    row.attempts += 1;
    if (row.attempts >= 5) {
      row.lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
      if (!row.persistentAccess) row.status = 'locked' as never;
    }
    audit(state, { ...auditBase, action: 'code.failed', detail: '一次性登入码错误' });
    throw new Error('一次性登入码不正确');
  }
}

export function redeemBrandDemoInvite(input: {
  token: string;
  code: string;
  idempotencyKey: string;
  brandName?: string;
  introduction?: string;
  category?: string;
  contactName?: string;
  phone?: string;
  wechat?: string;
  confirmReferral?: boolean;
}) {
  const result = redeemBrandPilotInvite({
    token: input.token,
    code: input.code,
    idempotencyKey: input.idempotencyKey,
    displayName: input.contactName || input.brandName,
    confirmReferral: input.confirmReferral,
  });
  return { ...result, brandId: 0 };
}

export function redeemBrandPilotInvite(input: {
  token: string;
  code: string;
  idempotencyKey: string;
  displayName?: string;
  nickname?: string;
  referrerCode?: string;
  confirmReferral?: boolean;
}) {
  if (input.confirmReferral !== true) throw new Error('请先确认本次登录绑定的推荐码');
  return withWrite((state) => {
    const tokenHash = digest(input.token);
    const invite = state.invites.find((row) => safeDigestEqual(row.tokenHash, tokenHash));
    if (!invite) throw new Error('邀请不存在或已失效');
    if (invite.status === 'revoked') throw new Error('邀请已撤销');
    if (invite.status === 'consumed') {
      if (invite.memberId && (invite.persistentAccess || (invite.idempotencyKey && invite.idempotencyKey === input.idempotencyKey))) {
        if (invite.persistentAccess) assertCode(invite, input.code, state, { actorId: invite.memberId, inviteId: invite.id, memberId: invite.memberId, brandId: invite.brandId });
        const nickname = text(input.nickname || input.displayName || invite.nickname, 80);
        if (!invite.nickname) {
          if (!nickname) throw new Error('请补填昵称后继续测试');
          invite.nickname = nickname;
          invite.identityCompletedAt = nowIso();
        }
        const user = ensureLocalCnBrandPilotMember({ inviteId: invite.id, displayName: invite.nickname || nickname, referrerCode: invite.referralCode || input.referrerCode }).user;
        if (invite.persistentAccess) {
          invite.useCount += 1;
          invite.lastUsedAt = nowIso();
          invite.attempts = 0;
          invite.lockedUntil = null;
          audit(state, { action: 'pilot_access.login', actorId: user.id, inviteId: invite.id, memberId: user.id, brandId: invite.brandId, detail: '品牌方使用长期专属测试链接登入同一会员' });
        }
        return { user, memberId: invite.memberId, idempotent: !invite.persistentAccess, persistentAccess: invite.persistentAccess === true };
      }
      throw new Error('邀请已使用，请向平台索取新的登入码');
    }
    if (!invite.persistentAccess && isExpired(invite.expiresAt)) {
      invite.status = 'expired';
      throw new Error('邀请已过期');
    }
    if (invite.useCount >= invite.maxUses) throw new Error('邀请使用次数已达上限');
    if (!invite.referralCode) throw new Error('邀请缺少推荐关系，请平台重新建立邀请');
    assertCode(invite, input.code, state, { actorId: null, inviteId: invite.id });
    const nickname = text(input.nickname || input.displayName, 80);
    if (!nickname) throw new Error('请填写昵称');
    const { user } = ensureLocalCnBrandPilotMember({ inviteId: invite.id, displayName: nickname, referrerCode: invite.referralCode || input.referrerCode });
    invite.status = 'consumed';
    invite.useCount += 1;
    invite.consumedAt = nowIso();
    invite.lastUsedAt = invite.consumedAt;
    invite.memberId = user.id;
    invite.brandId = null;
    invite.idempotencyKey = input.idempotencyKey;
    invite.nickname = nickname;
    invite.identityCompletedAt = nowIso();
    audit(state, { action: 'pilot_invite.consumed', actorId: user.id, inviteId: invite.id, memberId: user.id, brandId: null, detail: `受邀测试登录已建立普通会员，推荐码 ${invite.referralCode}，昵称 ${nickname}` });
    return { user, memberId: user.id, idempotent: false, persistentAccess: invite.persistentAccess === true };
  });
}

export function createBrandDemoLoginChallenge(admin: SessionUser | null | undefined, input: { memberId: number; brandId?: number; expiresInMinutes?: number; expiresInSeconds?: number }) {
  requireAdmin(admin);
  const code = randomCode();
  const now = nowIso();
  const expiresInMs = Number.isFinite(Number(input.expiresInSeconds))
    ? Math.min(Math.max(Number(input.expiresInSeconds), 1), 15 * 60) * 1000
    : Math.min(Math.max(Number(input.expiresInMinutes || 15), 1), 15) * 60_000;
  return withWrite((state) => {
    const challenge: AuthChallenge = {
      id: `BDC-${Date.now()}-${randomBytes(4).toString('hex')}`,
      codeHash: digest(code),
      status: 'pending',
      memberId: Number(input.memberId),
      brandId: Number(input.brandId || 0),
      expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
      attempts: 0,
      lockedUntil: null,
      createdBy: admin!.id,
      createdAt: now,
      consumedAt: null,
    };
    state.challenges.unshift(challenge);
    audit(state, { action: 'challenge.created', actorId: admin!.id, challengeId: challenge.id, memberId: challenge.memberId, brandId: challenge.brandId, detail: '平台建立一次性登入码' });
    return { challenge: { id: challenge.id, expiresAt: challenge.expiresAt, memberId: challenge.memberId, brandId: challenge.brandId }, code };
  });
}

export function createBrandPilotAccessLink(admin: SessionUser | null | undefined, input: { memberId: number; brandId?: number }) {
  requireAdmin(admin);
  const code = randomCode();
  const now = nowIso();
  return withWrite((state) => {
    for (const existing of state.challenges) {
      if (existing.persistentAccess && existing.memberId === Number(input.memberId) && existing.status === 'active') {
        existing.status = 'revoked';
        audit(state, { action: 'access_link.revoked', actorId: admin!.id, challengeId: existing.id, memberId: existing.memberId, brandId: existing.brandId, detail: '建立新专属链接时自动撤销旧链接' });
      }
    }
    const access: AuthChallenge = {
      id: `BPA-${Date.now()}-${randomBytes(8).toString('hex')}`,
      codeHash: digest(code),
      status: 'active',
      persistentAccess: true,
      memberId: Number(input.memberId),
      brandId: Number(input.brandId || 0),
      expiresAt: PERMANENT_ACCESS_EXPIRES_AT,
      attempts: 0,
      lockedUntil: null,
      createdBy: admin!.id,
      createdAt: now,
      consumedAt: null,
      lastUsedAt: null,
    };
    state.challenges.unshift(access);
    audit(state, { action: 'access_link.created', actorId: admin!.id, challengeId: access.id, memberId: access.memberId, brandId: access.brandId, detail: '平台建立可撤销的长期专属品牌测试链接' });
    return { access: publicAccessLink(access), code };
  });
}

export function revokeBrandPilotAccessLink(admin: SessionUser | null | undefined, accessId: string) {
  requireAdmin(admin);
  return withWrite((state) => {
    const access = state.challenges.find((row) => row.id === accessId && row.persistentAccess);
    if (!access) throw new Error('找不到专属测试链接');
    access.status = 'revoked';
    audit(state, { action: 'access_link.revoked', actorId: admin!.id, challengeId: access.id, memberId: access.memberId, brandId: access.brandId, detail: '平台管理员撤销长期专属品牌测试链接' });
    return publicAccessLink(access);
  });
}

export function listBrandPilotPermanentAccessLinks(admin: SessionUser | null | undefined) {
  requireAdmin(admin);
  return readState().challenges
    .filter((row) => row.persistentAccess)
    .map(publicAccessLink)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function consumeBrandDemoLoginChallenge(input: { challengeId: string; code: string; nickname?: string }) {
  return withWrite((state) => {
    const challenge = state.challenges.find((row) => row.id === input.challengeId);
    if (!challenge) throw new Error('登入码不存在或已失效');
    const persistentAccess = challenge.persistentAccess === true && challenge.status === 'active';
    if (!persistentAccess && challenge.status !== 'pending') throw new Error('登入码已使用、锁定或撤销');
    if (!persistentAccess && isExpired(challenge.expiresAt)) {
      challenge.status = 'expired';
      throw new Error('登入码已过期');
    }
    const invite = state.invites.find((row) => row.status === 'consumed' && row.memberId === challenge.memberId);
    if (invite && !invite.nickname) {
      const nickname = text(input.nickname, 80);
      if (!nickname) throw new Error('请补填昵称后继续测试');
      invite.nickname = nickname;
      invite.identityCompletedAt = nowIso();
      updateLocalCnUserNickname(challenge.memberId, nickname);
      audit(state, { action: 'pilot_identity.updated', actorId: challenge.memberId, challengeId: challenge.id, memberId: challenge.memberId, brandId: challenge.brandId, detail: `补填品牌测试昵称 ${nickname}` });
    }
    assertCode(challenge, input.code, state, { actorId: challenge.memberId, challengeId: challenge.id, memberId: challenge.memberId, brandId: challenge.brandId });
    challenge.attempts = 0;
    challenge.lockedUntil = null;
    challenge.lastUsedAt = nowIso();
    if (!persistentAccess) {
      challenge.status = 'consumed';
      challenge.consumedAt = challenge.lastUsedAt;
    }
    audit(state, { action: persistentAccess ? 'access_link.login' : 'challenge.consumed', actorId: challenge.memberId, challengeId: challenge.id, memberId: challenge.memberId, brandId: challenge.brandId, detail: persistentAccess ? '品牌方使用长期专属测试链接登入同一会员' : '一次性登入码已使用' });
    return { memberId: challenge.memberId, brandId: challenge.brandId };
  });
}

export function getLocalBrandPilotIdentity(memberId: number) {
  const state = readState();
  const invite = state.invites.find((row) => row.status === 'consumed' && row.memberId === Number(memberId));
  if (!invite) return null;
  return {
    memberId: invite.memberId,
    brandId: invite.brandId,
    nickname: invite.nickname || '',
    status: invite.status,
    createdAt: invite.createdAt,
    consumedAt: invite.consumedAt,
    identityComplete: Boolean(invite.nickname),
  };
}

export function listBrandPilotAccessRows(admin: SessionUser | null | undefined) {
  requireAdmin(admin);
  return readState().invites
    .map(publicInvite)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function updateLocalBrandPilotNickname(user: SessionUser | null | undefined, nicknameInput: string) {
  if (!user) throw new Error('请先登录');
  const nickname = text(nicknameInput, 80);
  if (!nickname) throw new Error('请填写昵称');
  return withWrite((state) => {
    const invite = state.invites.find((row) => row.status === 'consumed' && row.memberId === user.id);
    if (!invite) throw new Error('当前会员不是品牌测试账号');
    invite.nickname = nickname;
    invite.identityCompletedAt = nowIso();
    const updated = updateLocalCnUserNickname(user.id, nickname);
    audit(state, { action: 'pilot_identity.updated', actorId: user.id, inviteId: invite.id, memberId: user.id, brandId: invite.brandId, detail: `更新品牌测试昵称 ${nickname}` });
    return {
      identity: {
        memberId: invite.memberId,
        brandId: invite.brandId,
        nickname: invite.nickname || '',
        status: invite.status,
        createdAt: invite.createdAt,
        consumedAt: invite.consumedAt,
        identityComplete: Boolean(invite.nickname),
      },
      user: updated,
    };
  });
}

export function toDemoSessionUser(user: LocalCnUser): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    agentLevel: user.agentLevel,
    role: user.role,
    region: 'CN',
    referralCode: user.referralCode,
    platformAdmin: false,
    demoAccount: false,
  };
}

// 品牌认领：品牌移交给真实微信会员后，撤销原品牌测试会员仍可使用的登录链接／登录码（只改状态，不删除纪录）
export function revokeBrandPilotAccessForMember(actorId: number, memberId: number, brandId: number) {
  const id = Number(memberId);
  if (!Number.isFinite(id) || id <= 0) return { revoked: 0 };
  return withWrite((state) => {
    let revoked = 0;
    for (const row of state.challenges) {
      if (row.memberId === id && (row.status === 'active' || row.status === 'pending')) {
        row.status = 'revoked';
        revoked += 1;
        audit(state, { action: row.persistentAccess ? 'access_link.revoked' : 'challenge.revoked', actorId, challengeId: row.id, memberId: id, brandId, detail: '品牌已由真实微信会员认领，自动撤销原测试会员登录' });
      }
    }
    return { revoked };
  });
}

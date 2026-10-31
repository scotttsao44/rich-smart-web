import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from './db';
import {
  authChallenges,
  brandAuditEvents,
  brandApplications,
  brandMembers,
  brandPageVersions,
  brandProductImages,
  brandProducts,
  brands,
  demoAccessAudit,
  demoInvites,
  users,
} from './schema';
import { hasPlatformAdminAccess, type SessionUser } from './auth';
import { CAOMI_OFFICIAL_REFERRAL_CODE, CAOMI_SCOOT_REFERRAL_CODE } from './local-cn-users';
import { createReferralCode, resolveReferrerId, sanitizeReferralCode } from './referrals';
import {
  createBrandPageRecord,
  normalizeBrandPageDocument,
  type BrandPageDocument,
  type BrandPageRecord,
} from './brand-page-builder';
import { enforceBrandApplicationDocumentLimits, mergeLegacyBrandApplicationDocuments } from './brand-application-documents';
import { enforceStoredBrandApplicationDocumentOwnership } from './brand-document-ownership.server';
import { normalizeBrandCommissionDefaults } from './local-cn-brand-marketplace';
import { normalizeBrandCategorySelection } from './cn-brand-taxonomy';

type DbBrand = typeof brands.$inferSelect;
type DbBrandApplication = typeof brandApplications.$inferSelect;
type DbBrandProduct = typeof brandProducts.$inferSelect;
type DbProductImage = typeof brandProductImages.$inferSelect;

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

function slugify(value: string) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || `item-${Date.now()}`;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

const PERMANENT_ACCESS_EXPIRES_AT = new Date('2099-12-31T23:59:59.999Z');

function requireAdmin(user: SessionUser | null | undefined) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台管理员可建立或撤销受邀测试登录');
}

function isExpired(expiresAt: Date | string) {
  return new Date(expiresAt).getTime() <= Date.now();
}

function publicInvite(invite: typeof demoInvites.$inferSelect) {
  const status = invite.status === 'pending' && !invite.persistentAccess && isExpired(invite.expiresAt) ? 'expired' : invite.status;
  return {
    id: invite.id,
    status,
    expiresAt: invite.persistentAccess ? null : invite.expiresAt,
    persistentAccess: invite.persistentAccess,
    useCount: invite.useCount,
    maxUses: invite.maxUses,
    memberId: invite.memberId,
    brandId: invite.brandId,
    referralCode: invite.referralCode || '',
    referrerMemberId: invite.referrerMemberId,
    nickname: invite.nickname || '',
    identityComplete: Boolean(invite.nickname),
    createdAt: invite.createdAt?.toISOString?.() || String(invite.createdAt || ''),
    consumedAt: invite.consumedAt?.toISOString?.() || null,
    lastUsedAt: invite.lastUsedAt?.toISOString?.() || invite.consumedAt?.toISOString?.() || null,
  };
}

function publicPermanentAccessLink(challenge: typeof authChallenges.$inferSelect) {
  return {
    id: challenge.challengeKey,
    status: challenge.status,
    persistentAccess: challenge.persistentAccess,
    expiresAt: null,
    memberId: challenge.memberId,
    brandId: challenge.brandId,
    createdAt: challenge.createdAt?.toISOString?.() || String(challenge.createdAt || ''),
    lastUsedAt: challenge.lastUsedAt?.toISOString?.() || challenge.consumedAt?.toISOString?.() || null,
  };
}

function toPilotSessionUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    agentLevel: Number(row.agentLevel || 0),
    role: row.role || 'member',
    region: 'CN',
    referralCode: row.referralCode || `RS${row.id}`,
    platformAdmin: false,
    demoAccount: false,
  };
}

function assertNoInlineImages(value: unknown, path = 'document') {
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) throw new Error(`${path} 不可保存浏览器 data URL，请先上传为持久图片`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoInlineImages(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
      assertNoInlineImages(next, `${path}.${key}`);
    }
  }
}

export function brandPilotDbEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export async function inspectDbBrandDemoInvite(token: string) {
  const tokenHash = digest(token);
  const invite = (await db.select().from(demoInvites).where(eq(demoInvites.tokenHash, tokenHash)).limit(1))[0];
  return invite ? publicInvite(invite) : null;
}

export async function isDbBrandPilotMemberId(memberId: number) {
  if (!brandPilotDbEnabled()) return false;
  const id = Number(memberId);
  if (!Number.isFinite(id)) return false;
  const invite = (await db.select({ id: demoInvites.id })
    .from(demoInvites)
    .where(and(eq(demoInvites.memberId, id), eq(demoInvites.status, 'consumed')))
    .limit(1))[0];
  if (invite) return true;
  const user = (await db.select({ email: users.email, referralCode: users.referralCode })
    .from(users)
    .where(eq(users.id, id))
    .limit(1))[0];
  return /^brand-(pilot|demo)-.+@/i.test(String(user?.email || ''))
    || /^RS-CN-(PILOT|DEMO)-/i.test(String(user?.referralCode || ''));
}

async function resolveInviteReferrer(admin: SessionUser, referralCodeInput: unknown) {
  const referralCode = sanitizeReferralCode(String(referralCodeInput || CAOMI_SCOOT_REFERRAL_CODE));
  if (!referralCode) throw new Error('建立邀请时必须绑定招商/推荐码');
  const configuredFrontlineId = Number(process.env.CN_FRONTLINE_REFERRER_MEMBER_ID || 0);
  const referrerMemberId = referralCode === CAOMI_OFFICIAL_REFERRAL_CODE && configuredFrontlineId > 0
    ? configuredFrontlineId
    : await resolveReferrerId(referralCode);
  if (!referrerMemberId) throw new Error('Scoot 推荐主体尚未建立，不能建立归属不明的测试登录');
  return { referralCode, referrerMemberId };
}

export async function createDbBrandDemoInvite(admin: SessionUser | null | undefined, input: { expiresInMinutes?: number; expiresInSeconds?: number; maxUses?: number; referralCode?: string; persistentAccess?: boolean } = {}) {
  requireAdmin(admin);
  const referrer = await resolveInviteReferrer(admin!, input.referralCode);
  const token = randomSecret();
  const code = randomCode();
  const persistentAccess = input.persistentAccess === true;
  const expiresInMs = Number.isFinite(Number(input.expiresInSeconds))
    ? Math.min(Math.max(Number(input.expiresInSeconds), 1), 60 * 60 * 24 * 30) * 1000
    : Math.min(Math.max(Number(input.expiresInMinutes || 60 * 24 * 7), 5), 60 * 24 * 30) * 60_000;
  const maxUses = Math.min(Math.max(Number(input.maxUses || 1), 1), 5);
  const now = new Date();
  const [invite] = await db.insert(demoInvites).values({
    tokenHash: digest(token),
    codeHash: digest(code),
    referralCode: referrer.referralCode,
    referrerMemberId: referrer.referrerMemberId,
    nickname: '',
    identityCompletedAt: null,
    status: 'pending',
    persistentAccess,
    expiresAt: persistentAccess ? PERMANENT_ACCESS_EXPIRES_AT : new Date(Date.now() + expiresInMs),
    maxUses,
    useCount: 0,
    attempts: 0,
    createdBy: admin!.id,
    createdAt: now,
  }).returning();
  await db.insert(demoAccessAudit).values({
    action: 'invite.created',
    actorId: admin!.id,
    inviteId: invite.id,
    detail: `平台建立${persistentAccess ? '长期专属' : '短效'}受邀测试登录，推荐码 ${referrer.referralCode}，token/code 分离传送`,
    createdAt: now,
  });
  return { invite: publicInvite(invite), token, code };
}

export async function revokeDbBrandDemoInvite(admin: SessionUser | null | undefined, token: string) {
  requireAdmin(admin);
  const [invite] = await db.update(demoInvites)
    .set({ status: 'revoked' })
    .where(eq(demoInvites.tokenHash, digest(token)))
    .returning();
  if (!invite) throw new Error('找不到邀请');
  await db.insert(demoAccessAudit).values({
    action: 'invite.revoked',
    actorId: admin!.id,
    inviteId: invite.id,
    detail: '平台撤销受邀测试登录',
    createdAt: new Date(),
  });
  return publicInvite(invite);
}

async function failInviteCode(invite: typeof demoInvites.$inferSelect) {
  const attempts = Number(invite.attempts || 0) + 1;
  await db.update(demoInvites).set({
    attempts,
    lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : invite.lockedUntil,
  }).where(eq(demoInvites.id, invite.id));
  await db.insert(demoAccessAudit).values({
    action: 'code.failed',
    inviteId: invite.id,
    detail: '受邀测试登录一次性码错误',
    createdAt: new Date(),
  });
}

export async function redeemDbBrandDemoInvite(input: {
  token: string;
  code: string;
  idempotencyKey: string;
  memberName?: string;
  nickname?: string;
  contact?: string;
  phone?: string;
  confirmReferral?: boolean;
}) {
  const tokenHash = digest(text(input.token));
  const codeHash = digest(text(input.code));
  const idempotencyKey = text(input.idempotencyKey);
  if (!idempotencyKey) throw new Error('缺少 idempotencyKey，无法安全登入');
  if (input.confirmReferral !== true) throw new Error('请先确认本次登录绑定的推荐码');

  const nickname = text(input.nickname || input.memberName);
  const memberName = nickname || '受邀品牌测试会员';
  const contact = text(input.phone || input.contact);
  const email = contact.includes('@') ? contact.toLowerCase().slice(0, 255) : `brand-pilot-${tokenHash.slice(0, 16)}@rich-smart.cn`;
  const phone = /^1\d{10}$/.test(contact) ? contact : text(input.phone);
  return await db.transaction(async (tx) => {
    const lockedResult = await tx.execute(sql`
      SELECT id, token_hash, code_hash, referral_code, referrer_member_id, nickname, identity_completed_at, status, persistent_access, expires_at, max_uses, use_count, attempts, locked_until, member_id, brand_id, idempotency_key, last_used_at
      FROM demo_invites
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `);
    const locked = (lockedResult as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
    if (!locked) throw new Error('邀请不存在或已失效');
    const lockedStatus = String(locked.status || '');
    const persistentAccess = locked.persistent_access === true || String(locked.persistent_access) === 'true';
    if (lockedStatus === 'revoked') throw new Error('邀请已撤销');
    if (lockedStatus === 'consumed') {
      const lockedMemberId = Number(locked.member_id || 0);
      const lockedBrandId = Number(locked.brand_id || 0);
      if (persistentAccess && lockedMemberId) {
        if (locked.locked_until && new Date(String(locked.locked_until)).getTime() > Date.now()) throw new Error('验证码错误次数过多，请稍后再试');
        if (!safeDigestEqual(String(locked.code_hash || ''), codeHash)) {
          const attempts = Number(locked.attempts || 0) + 1;
          await tx.update(demoInvites).set({
            attempts,
            lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : locked.locked_until ? new Date(String(locked.locked_until)) : null,
          }).where(eq(demoInvites.id, Number(locked.id)));
          await tx.insert(demoAccessAudit).values({ action: 'code.failed', inviteId: Number(locked.id), memberId: lockedMemberId, detail: '长期专属测试链接验证码错误', createdAt: new Date() });
          throw new Error('专属测试链接不正确');
        }
        const savedNickname = String(locked.nickname || nickname || '');
        if (!savedNickname) throw new Error('请补填昵称后继续测试');
        if (!String(locked.nickname || '')) {
          await tx.update(demoInvites).set({ nickname: savedNickname, identityCompletedAt: new Date() }).where(eq(demoInvites.id, Number(locked.id)));
          await tx.update(users).set({ name: savedNickname, updatedAt: new Date() }).where(eq(users.id, lockedMemberId));
        }
        const user = (await tx.select().from(users).where(eq(users.id, lockedMemberId)).limit(1))[0];
        if (!user) throw new Error('找不到会员');
        const nowDate = new Date();
        await tx.update(demoInvites).set({ useCount: Number(locked.use_count || 0) + 1, lastUsedAt: nowDate, attempts: 0, lockedUntil: null }).where(eq(demoInvites.id, Number(locked.id)));
        await tx.insert(demoAccessAudit).values({ action: 'pilot_access.login', actorId: lockedMemberId, inviteId: Number(locked.id), memberId: lockedMemberId, brandId: lockedBrandId || null, detail: '品牌方使用长期专属测试链接登入同一会员', createdAt: nowDate });
        return { user, memberId: lockedMemberId, brandId: lockedBrandId, idempotent: false, persistentAccess: true };
      }
      if (String(locked.idempotency_key || '') === idempotencyKey && lockedMemberId) {
        if (!String(locked.nickname || '')) {
          if (!nickname) throw new Error('请补填昵称后继续测试');
          await tx.update(demoInvites).set({
            nickname,
            identityCompletedAt: new Date(),
          }).where(eq(demoInvites.id, Number(locked.id)));
          await tx.update(users).set({ name: nickname, updatedAt: new Date() }).where(eq(users.id, lockedMemberId));
        }
        const user = (await tx.select().from(users).where(eq(users.id, lockedMemberId)).limit(1))[0];
        return { user, memberId: lockedMemberId, brandId: lockedBrandId, idempotent: true };
      }
      throw new Error('邀请已使用，请向平台索取新的登入码');
    }
    if (!persistentAccess && isExpired(String(locked.expires_at))) {
      await tx.update(demoInvites).set({ status: 'expired' }).where(eq(demoInvites.id, Number(locked.id)));
      throw new Error('邀请已过期');
    }
    if (locked.locked_until && new Date(String(locked.locked_until)).getTime() > Date.now()) throw new Error('验证码错误次数过多，请稍后再试');
    if (!safeDigestEqual(String(locked.code_hash || ''), codeHash)) {
      const attempts = Number(locked.attempts || 0) + 1;
      await tx.update(demoInvites).set({
        attempts,
        lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : locked.locked_until ? new Date(String(locked.locked_until)) : null,
      }).where(eq(demoInvites.id, Number(locked.id)));
      await tx.insert(demoAccessAudit).values({
        action: 'code.failed',
        inviteId: Number(locked.id),
        detail: '受邀测试登录一次性码错误',
        createdAt: new Date(),
      });
      throw new Error('一次性登入码不正确');
    }
    if (!persistentAccess && Number(locked.use_count || 0) >= Number(locked.max_uses || 1)) throw new Error('邀请使用次数已达上限');
    const referralCode = String(locked.referral_code || '');
    const referrerMemberId = Number(locked.referrer_member_id || 0);
    if (!referralCode || !referrerMemberId) throw new Error('邀请缺少推荐关系，请平台重新建立邀请');
    if (!nickname) throw new Error('请填写昵称');

    const nowDate = new Date();
    const [user] = await tx.insert(users).values({
      name: memberName.slice(0, 255),
      email,
      phone: phone || null,
      role: 'member',
      agentLevel: 1,
      agentStatus: 'member',
      status: 'active',
      referralCode: createReferralCode(`pilot${tokenHash.slice(0, 6)}`),
      referrerId: referrerMemberId,
      createdAt: nowDate,
      updatedAt: nowDate,
    }).returning();
    await tx.update(demoInvites).set({
      status: 'consumed',
      useCount: Number(locked.use_count || 0) + 1,
      consumedAt: nowDate,
      lastUsedAt: nowDate,
      idempotencyKey,
      memberId: user.id,
      brandId: null,
      nickname,
      identityCompletedAt: nowDate,
    }).where(eq(demoInvites.id, Number(locked.id)));
    await tx.insert(demoAccessAudit).values({
      action: 'invite.consumed',
      actorId: user.id,
      inviteId: Number(locked.id),
      memberId: user.id,
      brandId: null,
      detail: `受邀测试登录已建立正式会员，推荐码 ${referralCode} 已锁定，昵称 ${nickname}`,
      createdAt: nowDate,
    });
    return { user, memberId: user.id, brandId: 0, idempotent: false, persistentAccess };
  });
}

export async function createDbBrandDemoLoginChallenge(admin: SessionUser | null | undefined, input: { memberId: number; brandId?: number; expiresInMinutes?: number; expiresInSeconds?: number; persistentAccess?: boolean }) {
  requireAdmin(admin);
  const memberId = Number(input.memberId);
  const brandId = Number(input.brandId || 0);
  const member = (await db.select().from(users).where(eq(users.id, memberId)).limit(1))[0];
  if (!member || member.status !== 'active') throw new Error('找不到可登入的会员');
  if (brandId > 0) {
    const membership = (await db.select().from(brandMembers).where(and(
      eq(brandMembers.memberId, memberId),
      eq(brandMembers.brandId, brandId),
      eq(brandMembers.status, 'active'),
    )).limit(1))[0];
    if (!membership) throw new Error('会员不属于该品牌，不能建立品牌登入码');
  }
  const code = randomCode();
  const challengeKey = `BDC-${randomSecret(18)}`;
  const persistentAccess = input.persistentAccess === true;
  const expiresInMs = Number.isFinite(Number(input.expiresInSeconds))
    ? Math.min(Math.max(Number(input.expiresInSeconds), 1), 15 * 60) * 1000
    : Math.min(Math.max(Number(input.expiresInMinutes || 15), 1), 15) * 60_000;
  const [challenge] = await db.insert(authChallenges).values({
    challengeKey,
    codeHash: digest(code),
    status: persistentAccess ? 'active' : 'pending',
    persistentAccess,
    memberId,
    brandId,
    expiresAt: persistentAccess ? PERMANENT_ACCESS_EXPIRES_AT : new Date(Date.now() + expiresInMs),
    createdBy: admin!.id,
    createdAt: new Date(),
  }).returning();
  await db.insert(demoAccessAudit).values({
    action: persistentAccess ? 'access_link.created' : 'challenge.created',
    actorId: admin!.id,
    challengeId: challenge.id,
    memberId,
    brandId,
    detail: persistentAccess ? '平台建立可撤销的长期专属品牌测试链接' : '平台建立短效一次性登入码',
    createdAt: new Date(),
  });
  return { challenge: { id: challenge.challengeKey, expiresAt: persistentAccess ? null : challenge.expiresAt, persistentAccess, memberId, brandId }, code };
}

export async function createDbBrandPilotAccessLink(admin: SessionUser | null | undefined, input: { memberId: number; brandId?: number }) {
  requireAdmin(admin);
  const memberId = Number(input.memberId);
  await db.transaction(async (tx) => {
    const active = await tx.select().from(authChallenges).where(and(
      eq(authChallenges.memberId, memberId),
      eq(authChallenges.persistentAccess, true),
      eq(authChallenges.status, 'active'),
    ));
    for (const row of active) {
      await tx.update(authChallenges).set({ status: 'revoked' }).where(eq(authChallenges.id, row.id));
      await tx.insert(demoAccessAudit).values({ action: 'access_link.revoked', actorId: admin!.id, challengeId: row.id, memberId: row.memberId, brandId: row.brandId, detail: '建立新专属链接时自动撤销旧链接', createdAt: new Date() });
    }
  });
  const created = await createDbBrandDemoLoginChallenge(admin, { ...input, persistentAccess: true });
  return { access: { ...created.challenge, status: 'active', createdAt: new Date().toISOString(), lastUsedAt: null }, code: created.code };
}

export async function revokeDbBrandPilotAccessLink(admin: SessionUser | null | undefined, accessId: string) {
  requireAdmin(admin);
  const [access] = await db.update(authChallenges).set({ status: 'revoked' }).where(and(
    eq(authChallenges.challengeKey, text(accessId)),
    eq(authChallenges.persistentAccess, true),
  )).returning();
  if (!access) throw new Error('找不到专属测试链接');
  await db.insert(demoAccessAudit).values({ action: 'access_link.revoked', actorId: admin!.id, challengeId: access.id, memberId: access.memberId, brandId: access.brandId, detail: '平台管理员撤销长期专属品牌测试链接', createdAt: new Date() });
  return publicPermanentAccessLink(access);
}

export async function listDbBrandPilotPermanentAccessLinks(admin: SessionUser | null | undefined) {
  requireAdmin(admin);
  const rows = await db.select().from(authChallenges).where(eq(authChallenges.persistentAccess, true)).orderBy(desc(authChallenges.createdAt)).limit(300);
  return rows.map(publicPermanentAccessLink);
}

async function failChallengeCode(challenge: typeof authChallenges.$inferSelect) {
  const attempts = Number(challenge.attempts || 0) + 1;
  await db.update(authChallenges).set({
    attempts,
    lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : challenge.lockedUntil,
    status: attempts >= 5 ? 'locked' : challenge.status,
  }).where(eq(authChallenges.id, challenge.id));
  await db.insert(demoAccessAudit).values({
    action: 'challenge.code_failed',
    challengeId: challenge.id,
    memberId: challenge.memberId,
    brandId: challenge.brandId,
    detail: '一次性登入码错误',
    createdAt: new Date(),
  });
}

export async function consumeDbBrandDemoLoginChallenge(input: { challengeId: string; code: string; nickname?: string }) {
  const challenge = (await db.select().from(authChallenges).where(eq(authChallenges.challengeKey, text(input.challengeId))).limit(1))[0];
  if (!challenge) throw new Error('登入码不存在或已失效');
  const persistentAccess = challenge.persistentAccess && challenge.status === 'active';
  if (!persistentAccess && challenge.status !== 'pending') throw new Error('登入码已使用、锁定或撤销');
  if (!persistentAccess && isExpired(challenge.expiresAt)) {
    await db.update(authChallenges).set({ status: 'expired' }).where(eq(authChallenges.id, challenge.id));
    throw new Error('登入码已过期');
  }
  const invite = (await db.select().from(demoInvites).where(and(eq(demoInvites.memberId, challenge.memberId), eq(demoInvites.status, 'consumed'))).limit(1))[0];
  if (invite && !invite.nickname) {
    const nickname = text(input.nickname);
    if (!nickname) throw new Error('请补填昵称后继续测试');
    await db.update(demoInvites).set({ nickname, identityCompletedAt: new Date() }).where(eq(demoInvites.id, invite.id));
    await db.update(users).set({ name: nickname, updatedAt: new Date() }).where(eq(users.id, challenge.memberId));
    await db.insert(demoAccessAudit).values({
      action: 'pilot_identity.updated',
      actorId: challenge.memberId,
      challengeId: challenge.id,
      memberId: challenge.memberId,
      brandId: challenge.brandId,
      detail: `补填品牌测试昵称 ${nickname}`,
      createdAt: new Date(),
    });
  }
  if (challenge.lockedUntil && new Date(challenge.lockedUntil).getTime() > Date.now()) throw new Error('验证码错误次数过多，请稍后再试');
  if (!safeDigestEqual(challenge.codeHash, digest(text(input.code)))) {
    await failChallengeCode(challenge);
    throw new Error('一次性登入码不正确');
  }
  const now = new Date();
  const [consumed] = persistentAccess
    ? await db.update(authChallenges).set({ lastUsedAt: now, attempts: 0, lockedUntil: null }).where(and(eq(authChallenges.id, challenge.id), eq(authChallenges.status, 'active'))).returning()
    : await db.update(authChallenges).set({ status: 'consumed', consumedAt: now, lastUsedAt: now }).where(and(eq(authChallenges.id, challenge.id), eq(authChallenges.status, 'pending'))).returning();
  if (!consumed) throw new Error(persistentAccess ? '专属测试链接已被撤销，请联系平台' : '登入码已被使用，请重新申请');
  await db.insert(demoAccessAudit).values({
    action: persistentAccess ? 'access_link.login' : 'challenge.consumed',
    actorId: consumed.memberId,
    challengeId: consumed.id,
    memberId: consumed.memberId,
    brandId: consumed.brandId,
    detail: persistentAccess ? '品牌方使用长期专属测试链接登入同一会员' : '一次性登入码已使用',
    createdAt: now,
  });
  const user = (await db.select().from(users).where(eq(users.id, consumed.memberId)).limit(1))[0];
  if (!user) throw new Error('找不到会员');
  return { user, memberId: consumed.memberId, brandId: consumed.brandId };
}

export async function getDbBrandPilotIdentity(memberId: number) {
  const invite = (await db.select().from(demoInvites)
    .where(and(eq(demoInvites.memberId, Number(memberId)), eq(demoInvites.status, 'consumed')))
    .limit(1))[0];
  if (!invite) return null;
  return {
    memberId: invite.memberId,
    brandId: invite.brandId,
    nickname: invite.nickname || '',
    status: invite.status,
    createdAt: invite.createdAt?.toISOString?.() || String(invite.createdAt || ''),
    consumedAt: invite.consumedAt?.toISOString?.() || null,
    identityComplete: Boolean(invite.nickname),
  };
}

export async function listDbBrandPilotAccessRows(admin: SessionUser | null | undefined) {
  requireAdmin(admin);
  const rows = await db.select().from(demoInvites).orderBy(desc(demoInvites.createdAt)).limit(300);
  return rows.map(publicInvite);
}

export async function updateDbBrandPilotNickname(user: SessionUser | null | undefined, nicknameInput: string) {
  if (!user) throw new Error('请先登录');
  const nickname = text(nicknameInput);
  if (!nickname) throw new Error('请填写昵称');
  const invite = (await db.select().from(demoInvites)
    .where(and(eq(demoInvites.memberId, user.id), eq(demoInvites.status, 'consumed')))
    .limit(1))[0];
  if (!invite) throw new Error('当前会员不是品牌测试账号');
  await db.transaction(async (tx) => {
    await tx.update(demoInvites).set({ nickname, identityCompletedAt: new Date() }).where(eq(demoInvites.id, invite.id));
    await tx.update(users).set({ name: nickname, updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.insert(demoAccessAudit).values({
      action: 'pilot_identity.updated',
      actorId: user.id,
      inviteId: invite.id,
      memberId: user.id,
      brandId: invite.brandId,
      detail: `更新品牌测试昵称 ${nickname}`,
      createdAt: new Date(),
    });
  });
  const [identity, row] = await Promise.all([
    getDbBrandPilotIdentity(user.id),
    db.select().from(users).where(eq(users.id, user.id)).limit(1),
  ]);
  return { identity, user: row[0] };
}

export async function getDbUserById(id: number) {
  return (await db.select().from(users).where(eq(users.id, id)).limit(1))[0] || null;
}

export { toPilotSessionUser as toDbDemoSessionUser };

export async function getDbApprovedBrandBySlug(slug: string) {
  return (await db.select().from(brands).where(and(eq(brands.slug, slug), eq(brands.status, 'approved'))).limit(1))[0] || null;
}

export async function getDbApprovedBrandById(brandId: number) {
  return (await db.select().from(brands).where(and(eq(brands.id, brandId), eq(brands.status, 'approved'))).limit(1))[0] || null;
}

export async function getDbApprovedBrandForUser(userId: number) {
  const rows = await db.select({ brand: brands }).from(brandMembers)
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    .where(and(eq(brandMembers.memberId, userId), eq(brandMembers.status, 'active'), eq(brands.status, 'approved')))
    .limit(1);
  return rows[0]?.brand || null;
}

export async function getDbBrandCommissionDefaults(user: SessionUser) {
  const brand = await getDbApprovedBrandForUser(user.id);
  if (!brand) throw new Error('品牌审核通过后才能设置商品分润');
  return normalizeBrandCommissionDefaults(brand.commissionDefaults);
}

export async function updateDbBrandCommissionDefaults(user: SessionUser, input: Record<string, unknown>) {
  const brand = await getDbApprovedBrandForUser(user.id);
  if (!brand) throw new Error('品牌审核通过后才能设置商品分润');
  await assertDbBrandRole(user, brand.id, ['owner', 'admin', 'editor', 'finance']);
  const defaults = normalizeBrandCommissionDefaults(input);
  const now = new Date();
  const stored = { ...defaults, updatedAt: now.toISOString(), updatedBy: user.id };
  await db.transaction(async (tx) => {
    await tx.update(brands).set({ commissionDefaults: stored, updatedAt: now }).where(eq(brands.id, brand.id));
    await tx.insert(brandAuditEvents).values({
      brandId: brand.id,
      actorId: user.id,
      entityType: 'brand',
      entityId: String(brand.id),
      action: 'brand_commission_defaults_updated',
      metadata: stored,
      createdAt: now,
    });
  });
  return stored;
}

function applicationDocuments(input: Record<string, unknown>) {
  const businessLicenseDocument = text(input.businessLicenseDocument);
  const businessLicenseName = text(input.businessLicenseName);
  const profileDocument = text(input.profileDocument);
  const profileDocumentName = text(input.profileDocumentName);
  const trademarkDocument = text(input.trademarkDocument);
  const trademarkName = text(input.trademarkName);
  return {
    registrationNo: text(input.registrationNo),
    legalRepresentative: text(input.legalRepresentative),
    companyType: text(input.companyType),
    registeredCapital: text(input.registeredCapital),
    establishmentDate: text(input.establishmentDate),
    companyAddress: text(input.companyAddress),
    businessScope: text(input.businessScope),
    businessLicenseDocument,
    businessLicenseName,
    profileDocument,
    profileDocumentName,
    trademarkDocument,
    trademarkName,
    brandDocuments: enforceBrandApplicationDocumentLimits(mergeLegacyBrandApplicationDocuments(input.brandDocuments, [
      { token: businessLicenseDocument, name: businessLicenseName, kind: 'license' },
      { token: profileDocument, name: profileDocumentName, kind: 'brand_profile' },
      { token: trademarkDocument, name: trademarkName, kind: 'brand_rights' },
    ])),
    logoUrl: text(input.logoUrl),
    officialWebsite: text(input.officialWebsite),
    socialLink: text(input.socialLink),
    pageTemplate: text(input.pageTemplate || 'professional'),
  };
}

function normalizeBrandApplicationInput(input: Record<string, unknown>) {
  const brandName = text(input.brandName);
  const companyName = text(input.companyName);
  const categorySelection = normalizeBrandCategorySelection({
    categoryMajorId: input.categoryMajorId,
    categoryMinorId: input.categoryMinorId,
  });
  const category = categorySelection.categoryLabel;
  const contactName = text(input.contactName);
  const contactPhone = text(input.phone || input.contactPhone);
  const contactWechat = text(input.wechat || input.contactWechat);
  const introduction = text(input.introduction);
  const documents = applicationDocuments(input);
  if (!brandName || !companyName || !contactName || !introduction) throw new Error('请完整填写品牌、公司主体、联系人和品牌简介');
  if (!categorySelection.categoryMajorId || !categorySelection.categoryMinorId) throw new Error('请选择有效的品牌大类与小类');
  if (!documents.registrationNo) throw new Error('请填写统一社会信用代码或公司登记编号');
  if (!documents.businessLicenseDocument && !documents.brandDocuments.some((document) => document.kind === 'license')) throw new Error('请上传营业执照或公司设立登记文件');
  if (!contactPhone && !contactWechat) throw new Error('联系电话与微信至少填写一项');
  if (contactPhone && !/^(?:1\d{10}|[\d()+\-\s]{6,20})$/.test(contactPhone)) throw new Error('联系电话格式不正确');
  if (documents.officialWebsite && !/^https?:\/\//.test(documents.officialWebsite)) throw new Error('官方网站必须是完整的 http 或 https 网址');
  if (documents.socialLink && !/^https?:\/\//.test(documents.socialLink)) throw new Error('社群链接必须是完整的 http 或 https 网址');
  assertNoInlineImages({ documents, logoUrl: documents.logoUrl });
  return {
    brandName,
    companyName,
    category,
    categoryMajorId: categorySelection.categoryMajorId,
    categoryMinorId: categorySelection.categoryMinorId,
    categoryMajorLabel: categorySelection.categoryMajorLabel,
    categoryMinorLabel: categorySelection.categoryMinorLabel,
    categoryLabel: categorySelection.categoryLabel,
    contactName,
    contactPhone,
    contactWechat,
    introduction,
    documents: {
      ...documents,
      categoryMajorId: categorySelection.categoryMajorId,
      categoryMinorId: categorySelection.categoryMinorId,
      categoryMajorLabel: categorySelection.categoryMajorLabel,
      categoryMinorLabel: categorySelection.categoryMinorLabel,
      categoryLabel: categorySelection.categoryLabel,
      categoryQualificationDocuments: categorySelection.qualificationDocuments,
      categoryQualificationNote: categorySelection.qualificationNote,
    },
  };
}

function dbApplicationDto(row: DbBrandApplication) {
  const documents = row.documents && typeof row.documents === 'object' && !Array.isArray(row.documents)
    ? row.documents as Record<string, unknown>
    : {};
  return {
    id: row.id,
    brandId: row.brandId,
    applicantUserId: row.applicantMemberId,
    accountUserId: row.brandId ? row.applicantMemberId : null,
    status: row.status as 'pending' | 'approved' | 'rejected',
    brandName: row.brandName,
    companyName: row.companyName,
    category: row.category || '',
    categoryMajorId: row.categoryMajorId || text(documents.categoryMajorId),
    categoryMinorId: row.categoryMinorId || text(documents.categoryMinorId),
    categoryMajorLabel: row.categoryMajorLabel || text(documents.categoryMajorLabel),
    categoryMinorLabel: row.categoryMinorLabel || text(documents.categoryMinorLabel),
    categoryLabel: row.categoryLabel || text(documents.categoryLabel),
    officialWebsite: text(documents.officialWebsite),
    socialLink: text(documents.socialLink),
    contactName: row.contactName || '',
    phone: row.contactPhone || '',
    wechat: row.contactWechat || '',
    introduction: row.introduction,
    registrationNo: text(documents.registrationNo),
    legalRepresentative: text(documents.legalRepresentative),
    companyType: text(documents.companyType),
    registeredCapital: text(documents.registeredCapital),
    establishmentDate: text(documents.establishmentDate),
    companyAddress: text(documents.companyAddress),
    businessScope: text(documents.businessScope),
    businessLicenseDocument: text(documents.businessLicenseDocument),
    businessLicenseName: text(documents.businessLicenseName),
    profileDocument: text(documents.profileDocument),
    profileDocumentName: text(documents.profileDocumentName),
    trademarkDocument: text(documents.trademarkDocument),
    trademarkName: text(documents.trademarkName),
    brandDocuments: mergeLegacyBrandApplicationDocuments(documents.brandDocuments, [
      { token: text(documents.businessLicenseDocument), name: text(documents.businessLicenseName), kind: 'license' },
      { token: text(documents.profileDocument), name: text(documents.profileDocumentName), kind: 'brand_profile' },
      { token: text(documents.trademarkDocument), name: text(documents.trademarkName), kind: 'brand_rights' },
    ]),
    logoUrl: text(documents.logoUrl),
    pageTemplate: text(documents.pageTemplate),
    referrerBrandId: null,
    referrerBrandName: '',
    referrerBrandCode: '',
    referrerRewardRate: 0,
    reviewNote: row.reviewNote || '',
    submittedAt: row.submittedAt?.toISOString?.() || String(row.submittedAt || ''),
    reviewedAt: row.reviewedAt?.toISOString?.() || null,
    reviewedBy: row.reviewedBy,
    createdAt: row.createdAt?.toISOString?.() || String(row.createdAt || ''),
    updatedAt: row.updatedAt?.toISOString?.() || String(row.updatedAt || ''),
  };
}

export async function listDbApprovedBrands() {
  const rows = await db.select().from(brands).where(eq(brands.status, 'approved')).orderBy(desc(brands.updatedAt));
  return rows.map((brand) => ({
    id: brand.id,
    slug: brand.slug,
    brandName: brand.brandName,
    companyName: brand.companyName,
    brandReferralCode: '',
  }));
}

export async function listDbBrandApplications(user: SessionUser, scope: 'self' | 'all' = 'all') {
  const isAdmin = hasPlatformAdminAccess(user);
  const rows = scope === 'self' || !isAdmin
    ? await db.select().from(brandApplications)
      .where(eq(brandApplications.applicantMemberId, user.id))
      .orderBy(desc(brandApplications.updatedAt))
      .limit(200)
    : await db.select().from(brandApplications)
      .orderBy(desc(brandApplications.updatedAt))
      .limit(200);
  return rows.map(dbApplicationDto);
}

export async function submitDbBrandApplication(user: SessionUser, input: Record<string, unknown>) {
  const normalized = normalizeBrandApplicationInput(input);
  enforceStoredBrandApplicationDocumentOwnership(normalized.documents.brandDocuments, user.id);
  const own = await db.select().from(brandApplications)
    .where(eq(brandApplications.applicantMemberId, user.id))
    .orderBy(desc(brandApplications.updatedAt))
    .limit(1);
  if (own[0]?.status === 'pending') throw new Error('当前已有待审核的品牌申请，请勿重复提交');
  if (own[0]?.status === 'approved') throw new Error('当前账号已经绑定审核通过的品牌');
  const duplicate = (await db.select().from(brands).where(eq(brands.brandName, normalized.brandName)).limit(1))[0];
  if (duplicate) throw new Error('该品牌名称已经存在');
  const now = new Date();
  const [application] = await db.insert(brandApplications).values({
    applicantMemberId: user.id,
    status: 'pending',
    brandName: normalized.brandName,
    companyName: normalized.companyName,
    category: normalized.category,
    categoryMajorId: normalized.categoryMajorId,
    categoryMinorId: normalized.categoryMinorId,
    categoryMajorLabel: normalized.categoryMajorLabel,
    categoryMinorLabel: normalized.categoryMinorLabel,
    categoryLabel: normalized.categoryLabel,
    contactName: normalized.contactName,
    contactPhone: normalized.contactPhone,
    contactWechat: normalized.contactWechat,
    introduction: normalized.introduction,
    documents: normalized.documents,
    reviewNote: '',
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  }).returning();
  await db.insert(brandAuditEvents).values({
    actorId: user.id,
    entityType: 'brand_application',
    entityId: String(application.id),
    action: 'brand_submitted',
    metadata: { brandName: application.brandName },
    createdAt: now,
  });
  return dbApplicationDto(application);
}

export async function reviewDbBrandApplication(user: SessionUser, id: number, decision: 'approved' | 'rejected', note: string) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可审核品牌');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('审核动作不正确');
  if (decision === 'rejected' && !text(note)) throw new Error('退回时必须填写原因');
  return db.transaction(async (tx) => {
    const lockedResult = await tx.execute(sql`
      SELECT *
      FROM brand_applications
      WHERE id = ${id}
      FOR UPDATE
    `);
    const locked = (lockedResult as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0];
    if (!locked) throw new Error('找不到品牌申请');
    if (String(locked.status) !== 'pending') throw new Error('该申请已处理，请刷新后再操作');
    const now = new Date();
    if (decision === 'rejected') {
      const [application] = await tx.update(brandApplications).set({
        status: 'rejected',
        reviewNote: text(note),
        reviewedAt: now,
        reviewedBy: user.id,
        updatedAt: now,
      }).where(eq(brandApplications.id, id)).returning();
      await tx.insert(brandAuditEvents).values({ actorId: user.id, entityType: 'brand_application', entityId: String(id), action: 'brand_rejected', metadata: { note: text(note) }, createdAt: now });
      return dbApplicationDto(application);
    }
    const documents = locked.documents && typeof locked.documents === 'object' && !Array.isArray(locked.documents)
      ? locked.documents as Record<string, unknown>
      : {};
    const brandName = String(locked.brand_name || '');
    const introduction = String(locked.introduction || '');
    const [brand] = await tx.insert(brands).values({
      slug: `${slugify(brandName)}-${id}`.slice(0, 255),
      brandName,
      companyName: String(locked.company_name || ''),
      category: String(locked.category || ''),
      categoryMajorId: text(locked.category_major_id || documents.categoryMajorId) || null,
      categoryMinorId: text(locked.category_minor_id || documents.categoryMinorId) || null,
      categoryMajorLabel: text(locked.category_major_label || documents.categoryMajorLabel) || null,
      categoryMinorLabel: text(locked.category_minor_label || documents.categoryMinorLabel) || null,
      categoryLabel: text(locked.category_label || documents.categoryLabel || locked.category) || null,
      introduction,
      logoUrl: text(documents.logoUrl) || null,
      ownerMemberId: Number(locked.applicant_member_id),
      status: 'approved',
      createdAt: now,
      updatedAt: now,
    }).returning();
    await tx.insert(brandMembers).values({ brandId: brand.id, memberId: brand.ownerMemberId, role: 'owner', status: 'active', createdAt: now }).onConflictDoNothing();
    const page = createBrandPageRecord(brand.brandName, brand.introduction, false);
    await tx.insert(brandPageVersions).values({ brandId: brand.id, kind: 'draft', version: 1, document: page.draft, createdBy: brand.ownerMemberId, createdAt: now }).onConflictDoNothing();
    const [application] = await tx.update(brandApplications).set({
      brandId: brand.id,
      status: 'approved',
      reviewNote: text(note),
      reviewedAt: now,
      reviewedBy: user.id,
      updatedAt: now,
    }).where(eq(brandApplications.id, id)).returning();
    await tx.insert(brandAuditEvents).values({ brandId: brand.id, actorId: user.id, entityType: 'brand_application', entityId: String(id), action: 'brand_approved', metadata: { brandName }, createdAt: now });
    return dbApplicationDto(application);
  });
}

export async function assertDbBrandRole(user: SessionUser, brandId: number, roles: string[]) {
  if (hasPlatformAdminAccess(user)) return;
  const membership = (await db.select().from(brandMembers).where(and(
    eq(brandMembers.brandId, brandId),
    eq(brandMembers.memberId, user.id),
    eq(brandMembers.status, 'active'),
  )).limit(1))[0];
  if (!membership || !roles.includes(membership.role)) throw new Error('当前职位无权操作该品牌资料');
}

function dbBrandPageRecord(brand: DbBrand, draft: BrandPageDocument | null, published: BrandPageDocument | null): BrandPageRecord {
  const fallback = createBrandPageRecord(brand.brandName, brand.introduction, false);
  return {
    status: published ? 'published' : 'draft',
    draft: normalizeBrandPageDocument(draft, fallback.draft),
    published: published ? normalizeBrandPageDocument(published, fallback.draft) : null,
    moderationNote: '',
    moderatedAt: null,
    moderatedBy: null,
  };
}

async function latestBrandPageDocument(brandId: number, kind: 'draft' | 'published') {
  const row = (await db.select().from(brandPageVersions)
    .where(and(eq(brandPageVersions.brandId, brandId), eq(brandPageVersions.kind, kind)))
    .orderBy(desc(brandPageVersions.version))
    .limit(1))[0];
  return row?.document as BrandPageDocument | null | undefined || null;
}

export async function getDbBrandPageRecord(brand: DbBrand) {
  const [draft, published] = await Promise.all([
    latestBrandPageDocument(brand.id, 'draft'),
    latestBrandPageDocument(brand.id, 'published'),
  ]);
  return dbBrandPageRecord(brand, draft, published);
}

export function publicDbBrand(brand: DbBrand, brandPage: BrandPageRecord, includeDraft = true) {
  return {
    id: brand.id,
    slug: brand.slug,
    brandName: brand.brandName,
    companyName: brand.companyName,
    introduction: brand.introduction,
    logoUrl: brand.logoUrl || '',
    brandPage: includeDraft ? brandPage : { status: brandPage.status, published: brandPage.published, moderationNote: '' },
  };
}

function imageList(images: DbProductImage[]) {
  return images.sort((a, b) => a.sortOrder - b.sortOrder).map((image) => image.url);
}

export function dbProductDto(product: DbBrandProduct, images: string[], brandName?: string) {
  return {
    id: product.id,
    slug: product.slug,
    brandId: product.brandId,
    brandName: brandName || '',
    ownerUserId: product.ownerMemberId,
    sku: product.sku,
    name: product.name,
    category: product.category,
    description: product.description,
    imageUrl: images[0] || '',
    images,
    compareAtPrice: product.compareAtPriceCny == null ? null : Number(product.compareAtPriceCny),
    variants: Array.isArray(product.variants) ? product.variants : [],
    shippingMethods: Array.isArray(product.shippingMethods) ? product.shippingMethods : [],
    salesStatus: product.salesStatus,
    imageIsTest: false,
    imageDisclosure: '',
    priceCny: String(product.priceCny),
    priceTwd: String(product.priceCny),
    supplyPriceCny: product.supplyPriceCny == null ? 0 : Number(product.supplyPriceCny),
    stockQuantity: product.stockQuantity,
    fulfillmentInfo: product.fulfillmentInfo,
    commissionRate: product.commissionRate == null ? '' : String(product.commissionRate),
    directRate: product.directRate == null ? 30 : Number(product.directRate),
    upperRate: product.upperRate == null ? 5 : Number(product.upperRate),
    activeRate: product.activeRate == null ? 65 : Number(product.activeRate),
    status: product.status,
    reviewStatus: product.reviewStatus,
    reviewNote: product.reviewNote || '',
    submittedAt: product.submittedAt?.toISOString?.() || String(product.submittedAt || ''),
    reviewedAt: product.reviewedAt?.toISOString?.() || null,
    reviewedBy: product.reviewedBy,
    isActive: product.isActive,
    createdAt: product.createdAt?.toISOString?.() || String(product.createdAt || ''),
    updatedAt: product.updatedAt?.toISOString?.() || String(product.updatedAt || ''),
  };
}

async function productsWithImages(productRows: DbBrandProduct[], brandNameById = new Map<number, string>()) {
  if (!productRows.length) return [];
  const images = await db.select().from(brandProductImages).where(inArray(brandProductImages.productId, productRows.map((row) => row.id)));
  const byProduct = new Map<number, DbProductImage[]>();
  for (const image of images) {
    const list = byProduct.get(image.productId) || [];
    list.push(image);
    byProduct.set(image.productId, list);
  }
  return productRows.map((product) => dbProductDto(product, imageList(byProduct.get(product.id) || []), brandNameById.get(product.brandId)));
}

export async function listDbBrandProducts(user: SessionUser, scope: 'mine' | 'review' | 'public' = 'mine') {
  if (scope === 'review') {
    if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可查看全部商品审核');
    const rows = await db.select().from(brandProducts).orderBy(desc(brandProducts.updatedAt)).limit(200);
    const brandRows = rows.length ? await db.select().from(brands).where(inArray(brands.id, rows.map((row) => row.brandId))) : [];
    return productsWithImages(rows, new Map(brandRows.map((brand) => [brand.id, brand.brandName])));
  }
  if (scope === 'public') return listDbPublicBrandProducts();
  const brand = await getDbApprovedBrandForUser(user.id);
  if (!brand) return [];
  const rows = await db.select().from(brandProducts).where(eq(brandProducts.brandId, brand.id)).orderBy(desc(brandProducts.updatedAt));
  return productsWithImages(rows, new Map([[brand.id, brand.brandName]]));
}

export async function listDbPublicBrandProducts(brandId?: number) {
  const conditions = brandId
    ? and(eq(brandProducts.brandId, brandId), eq(brandProducts.status, 'approved'), eq(brandProducts.reviewStatus, 'approved'), eq(brandProducts.isActive, true), eq(brandProducts.salesStatus, 'active'), gt(brandProducts.stockQuantity, 0))
    : and(eq(brandProducts.status, 'approved'), eq(brandProducts.reviewStatus, 'approved'), eq(brandProducts.isActive, true), eq(brandProducts.salesStatus, 'active'), gt(brandProducts.stockQuantity, 0));
  const rows = await db.select().from(brandProducts).where(conditions).orderBy(desc(brandProducts.updatedAt)).limit(200);
  const brandRows = rows.length ? await db.select().from(brands).where(and(inArray(brands.id, rows.map((row) => row.brandId)), eq(brands.status, 'approved'))) : [];
  const brandNameById = new Map(brandRows.map((brand) => [brand.id, brand.brandName]));
  return productsWithImages(rows.filter((row) => brandNameById.has(row.brandId)), brandNameById);
}

export async function getDbPublicBrandProduct(id: number) {
  const rows = await db.select().from(brandProducts).where(and(
    eq(brandProducts.id, id),
    eq(brandProducts.status, 'approved'),
    eq(brandProducts.reviewStatus, 'approved'),
    eq(brandProducts.isActive, true),
    eq(brandProducts.salesStatus, 'active'),
    gt(brandProducts.stockQuantity, 0),
  )).limit(1);
  const brand = rows[0] ? await getDbApprovedBrandById(rows[0].brandId) : null;
  return rows[0] && brand ? (await productsWithImages(rows, new Map([[brand.id, brand.brandName]])))[0] : null;
}

function productInput(input: Record<string, unknown>) {
  const name = text(input.name);
  const category = text(input.category);
  const description = text(input.description);
  const imageUrl = text(input.imageUrl);
  const images = Array.isArray(input.images) ? input.images.map(text).filter(Boolean).slice(0, 12) : imageUrl ? [imageUrl] : [];
  const fulfillmentInfo = text(input.fulfillmentInfo);
  const priceCny = Number(input.priceCny ?? input.priceTwd);
  const compareAtPrice = input.compareAtPrice === '' || input.compareAtPrice == null ? null : Number(input.compareAtPrice);
  const supplyPriceCny = Number(input.supplyPriceCny ?? 0);
  const stockQuantity = Number(input.stockQuantity);
  const directRate = Number(input.directRate ?? 30);
  const upperRate = Number(input.upperRate ?? 5);
  const activeRate = Number(input.activeRate ?? 65);
  if (!name || !category || !description || !fulfillmentInfo) throw new Error('请完整填写商品名称、分类、说明和发货方式');
  if (!Number.isFinite(priceCny) || priceCny <= 0) throw new Error('商品售价必须大于 0');
  if (compareAtPrice != null && (!Number.isFinite(compareAtPrice) || compareAtPrice <= priceCny)) throw new Error('划线价必须高于商品售价');
  if (!Number.isFinite(supplyPriceCny) || supplyPriceCny < 0) throw new Error('品牌结算价必须大于或等于 0');
  if (supplyPriceCny >= priceCny) throw new Error('品牌结算价必须低于商品售价');
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0) throw new Error('库存必须是大于或等于 0 的整数');
  if ([directRate, upperRate, activeRate].some((rate) => !Number.isFinite(rate) || rate < 0 || rate > 100)) throw new Error('三段分润比例必须介于 0% 至 100%');
  if (Math.abs(directRate + upperRate + activeRate - 100) > 0.001) throw new Error('直接推荐、上层推荐与近30天销售贡献榜比例合计必须等于 100%');
  if (!images.length) throw new Error('请先上传至少一张持久商品图片');
  if (images.some((url) => /^data:/i.test(url))) throw new Error('商品图片不可使用浏览器 data URL，请先上传为持久图片');
  if (images.some((url) => !url.startsWith('/') && !/^https?:\/\//.test(url))) throw new Error('商品图片必须是有效网址或站内路径');
  return {
    name,
    category,
    description,
    images,
    sku: text(input.sku),
    compareAtPrice,
    variants: Array.isArray(input.variants) ? input.variants : [],
    shippingMethods: Array.isArray(input.shippingMethods) ? input.shippingMethods : text(input.shippingMethodsText).split(/[,，\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 12),
    fulfillmentInfo,
    priceCny: priceCny.toFixed(2),
    supplyPriceCny: supplyPriceCny.toFixed(2),
    stockQuantity,
    directRate,
    upperRate,
    activeRate,
  };
}

export async function createDbBrandProduct(user: SessionUser, input: Record<string, unknown>, autoPublish = false) {
  const brand = await getDbApprovedBrandForUser(user.id);
  if (!brand) throw new Error('品牌审核通过后才能提交商品');
  await assertDbBrandRole(user, brand.id, ['owner', 'admin', 'editor']);
  const defaults = normalizeBrandCommissionDefaults(brand.commissionDefaults);
  const normalized = productInput({ ...defaults, ...input });
  const slug = `${slugify(normalized.name)}-${Date.now().toString(36)}`.slice(0, 255);
  const now = new Date();
  const [product] = await db.insert(brandProducts).values({
    brandId: brand.id,
    ownerMemberId: user.id,
    slug,
    sku: normalized.sku || `${autoPublish ? 'DEMO' : 'BR'}-${brand.id}-${Date.now()}`,
    name: normalized.name,
    category: normalized.category,
    description: normalized.description,
    priceCny: normalized.priceCny,
    compareAtPriceCny: normalized.compareAtPrice == null ? null : String(normalized.compareAtPrice),
    supplyPriceCny: normalized.supplyPriceCny,
    stockQuantity: normalized.stockQuantity,
    fulfillmentInfo: normalized.fulfillmentInfo,
    commissionRate: String(normalized.directRate),
    directRate: String(normalized.directRate),
    upperRate: String(normalized.upperRate),
    activeRate: String(normalized.activeRate),
    variants: normalized.variants,
    shippingMethods: normalized.shippingMethods,
    status: autoPublish ? 'approved' : 'pending',
    reviewStatus: autoPublish ? 'approved' : 'pending',
    reviewNote: autoPublish ? 'Demo 商品自动上架' : '',
    reviewedAt: autoPublish ? now : null,
    reviewedBy: autoPublish ? user.id : null,
    isActive: autoPublish,
    salesStatus: autoPublish ? (normalized.stockQuantity > 0 ? 'active' : 'sold_out') : 'draft',
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  }).returning();
  await db.insert(brandProductImages).values(normalized.images.map((url, index) => ({
    productId: product.id,
    brandId: brand.id,
    url,
    sortOrder: index,
    createdAt: now,
  })));
  await db.insert(brandAuditEvents).values({
    brandId: brand.id,
    actorId: user.id,
    entityType: 'product',
    entityId: String(product.id),
    action: autoPublish ? 'demo_product_published' : 'product_submitted',
    metadata: { name: product.name, imageCount: normalized.images.length },
    createdAt: now,
  });
  return (await productsWithImages([product], new Map([[brand.id, brand.brandName]])))[0];
}

export async function reviewDbBrandProduct(user: SessionUser, id: number, decision: 'approved' | 'rejected', note: string) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台账号可审核商品');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('请选择通过或退回');
  if (decision === 'rejected' && !text(note)) throw new Error('退回时必须填写原因');
  const existing = (await db.select().from(brandProducts).where(eq(brandProducts.id, id)).limit(1))[0];
  if (!existing) throw new Error('找不到商品');
  if (existing.status !== 'pending') throw new Error('该商品已处理，请刷新后再操作');
  const now = new Date();
  const [product] = await db.update(brandProducts).set({
    status: decision,
    reviewStatus: decision,
    reviewNote: text(note),
    reviewedAt: now,
    reviewedBy: user.id,
    isActive: decision === 'approved',
    salesStatus: decision === 'approved' ? (existing.stockQuantity > 0 ? 'active' : 'sold_out') : 'draft',
    updatedAt: now,
  }).where(eq(brandProducts.id, id)).returning();
  const brand = (await db.select().from(brands).where(eq(brands.id, product.brandId)).limit(1))[0];
  await db.insert(brandAuditEvents).values({
    brandId: product.brandId,
    actorId: user.id,
    entityType: 'product',
    entityId: String(product.id),
    action: decision === 'approved' ? 'product_approved' : 'product_rejected',
    metadata: { note: text(note), name: product.name },
    createdAt: now,
  });
  return (await productsWithImages([product], new Map([[product.brandId, brand?.brandName || '']])))[0];
}

export async function updateDbBrandProduct(user: SessionUser, id: number, action: 'toggle' | 'commission' | 'resubmit', input: Record<string, unknown>) {
  const existing = (await db.select().from(brandProducts).where(eq(brandProducts.id, id)).limit(1))[0];
  if (!existing) throw new Error('找不到商品');
  const brand = await getDbApprovedBrandForUser(user.id);
  if (!brand || brand.id !== existing.brandId) throw new Error('无权修改该商品');
  await assertDbBrandRole(user, brand.id, action === 'commission' ? ['owner', 'admin', 'editor', 'finance'] : ['owner', 'admin', 'editor']);
  const now = new Date();
  if (action === 'toggle') {
    if (existing.status !== 'approved') throw new Error('只有审核通过的商品可以调整销售状态');
    const isActive = Boolean(input.isActive);
    const [product] = await db.update(brandProducts).set({
      isActive,
      salesStatus: isActive ? (existing.stockQuantity > 0 ? 'active' : 'sold_out') : 'archived',
      updatedAt: now,
    }).where(eq(brandProducts.id, id)).returning();
    await db.insert(brandAuditEvents).values({ brandId: brand.id, actorId: user.id, entityType: 'product', entityId: String(id), action: isActive ? 'product_activated' : 'product_deactivated', metadata: { name: existing.name }, createdAt: now });
    return (await productsWithImages([product], new Map([[brand.id, brand.brandName]])))[0];
  }
  if (action === 'resubmit') {
    if (existing.status !== 'rejected') throw new Error('只有被退回的商品可以补充后重新提交');
    const normalized = productInput(input);
    const [product] = await db.update(brandProducts).set({
      sku: normalized.sku || existing.sku,
      name: normalized.name,
      category: normalized.category,
      description: normalized.description,
      priceCny: normalized.priceCny,
      compareAtPriceCny: normalized.compareAtPrice == null ? null : String(normalized.compareAtPrice),
      supplyPriceCny: normalized.supplyPriceCny,
      stockQuantity: normalized.stockQuantity,
      fulfillmentInfo: normalized.fulfillmentInfo,
      commissionRate: String(normalized.directRate),
      directRate: String(normalized.directRate),
      upperRate: String(normalized.upperRate),
      activeRate: String(normalized.activeRate),
      variants: normalized.variants,
      shippingMethods: normalized.shippingMethods,
      status: 'pending',
      reviewStatus: 'pending',
      reviewNote: '',
      submittedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      isActive: false,
      salesStatus: 'draft',
      updatedAt: now,
    }).where(eq(brandProducts.id, id)).returning();
    await db.delete(brandProductImages).where(eq(brandProductImages.productId, id));
    await db.insert(brandProductImages).values(normalized.images.map((url, index) => ({ productId: id, brandId: brand.id, url, sortOrder: index, createdAt: now })));
    await db.insert(brandAuditEvents).values({ brandId: brand.id, actorId: user.id, entityType: 'product', entityId: String(id), action: 'product_resubmitted', metadata: { name: normalized.name }, createdAt: now });
    return (await productsWithImages([product], new Map([[brand.id, brand.brandName]])))[0];
  }
  const defaults = normalizeBrandCommissionDefaults(input);
  const [product] = await db.update(brandProducts).set({
    commissionRate: String(defaults.directRate),
    directRate: String(defaults.directRate),
    upperRate: String(defaults.upperRate),
    activeRate: String(defaults.activeRate),
    updatedAt: now,
  }).where(eq(brandProducts.id, id)).returning();
  await db.insert(brandAuditEvents).values({
    brandId: brand.id,
    actorId: user.id,
    entityType: 'product',
    entityId: String(id),
    action: 'product_commission_updated',
    metadata: defaults,
    createdAt: now,
  });
  return (await productsWithImages([product], new Map([[brand.id, brand.brandName]])))[0];
}

async function nextBrandPageVersion(brandId: number, kind: 'draft' | 'published') {
  const row = (await db.select({ maxVersion: sql<number>`coalesce(max(${brandPageVersions.version}), 0)` }).from(brandPageVersions)
    .where(and(eq(brandPageVersions.brandId, brandId), eq(brandPageVersions.kind, kind))))[0];
  return Number(row?.maxVersion || 0) + 1;
}

export async function saveDbBrandPageDraft(user: SessionUser, input: Record<string, unknown>) {
  const brand = await getDbApprovedBrandForUser(user.id);
  if (!brand) throw new Error('品牌审核通过后才能编辑品牌前页');
  await assertDbBrandRole(user, brand.id, ['owner', 'admin', 'editor']);
  const record = await getDbBrandPageRecord(brand);
  const draft = normalizeBrandPageDocument(input.document || input, record.draft);
  assertNoInlineImages(draft);
  const version = await nextBrandPageVersion(brand.id, 'draft');
  draft.status = 'draft';
  draft.draftVersion = version;
  draft.publishedVersion = record.published?.publishedVersion || 0;
  draft.publishedAt = record.published?.publishedAt || null;
  draft.updatedAt = new Date().toISOString();
  await db.insert(brandPageVersions).values({ brandId: brand.id, kind: 'draft', version, document: draft, createdBy: user.id, createdAt: new Date() });
  await db.insert(brandAuditEvents).values({ brandId: brand.id, actorId: user.id, entityType: 'brand_page', entityId: String(version), action: 'brand_page_draft_saved', metadata: { version }, createdAt: new Date() });
  return brand;
}

export async function publishDbBrandPage(user: SessionUser, input: Record<string, unknown>) {
  const brand = await getDbApprovedBrandForUser(user.id);
  if (!brand) throw new Error('品牌审核通过后才能发布品牌前页');
  await assertDbBrandRole(user, brand.id, ['owner', 'admin', 'editor']);
  const record = await getDbBrandPageRecord(brand);
  const draft = normalizeBrandPageDocument(input.document || input || record.draft, record.draft);
  assertNoInlineImages(draft);
  const publishedVersion = await nextBrandPageVersion(brand.id, 'published');
  const now = new Date().toISOString();
  const published: BrandPageDocument = { ...draft, status: 'published', publishedVersion, publishedAt: now, updatedAt: now };
  const nextDraftVersion = await nextBrandPageVersion(brand.id, 'draft');
  const currentDraft: BrandPageDocument = { ...published, status: 'draft', draftVersion: nextDraftVersion };
  await db.insert(brandPageVersions).values({ brandId: brand.id, kind: 'draft', version: nextDraftVersion, document: currentDraft, createdBy: user.id, createdAt: new Date() });
  await db.insert(brandPageVersions).values({ brandId: brand.id, kind: 'published', version: publishedVersion, document: published, createdBy: user.id, createdAt: new Date() });
  await db.insert(brandAuditEvents).values({ brandId: brand.id, actorId: user.id, entityType: 'brand_page', entityId: String(publishedVersion), action: 'brand_page_published', metadata: { publishedVersion }, createdAt: new Date() });
  return brand;
}

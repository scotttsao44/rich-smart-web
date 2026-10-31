import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { createSessionToken, getFreshSessionUser, toSessionUser } from '@/lib/auth';
import { bindLocalWechatVerifiedPhone, findLocalCnUserByScopedWechatIdentity, findOrCreateLocalWechatUser, listLocalCnUsers } from '@/lib/local-cn-users';
import { referralBindingAudit, userIdentities, users } from '@/lib/schema';
import { jsonWithSession } from '@/lib/oauth';
import { normalizeWechatVerifiedPhone } from '@/lib/international-phone';
import { consumeWechatMiniPreAuthToken, readWechatMiniPreAuthToken, WechatMiniPreAuthStoreError } from '@/lib/wechat-mini-preauth';
import { createReferralCode, resolveReferrerId } from '@/lib/referrals';
import { phoneContactLookupValues, samePhoneContact } from '@/lib/wechat-phone-contact';

function contactConflictResponse() {
  return NextResponse.json({ error: '无法确认原会员归属，请登录原会员后绑定微信', code: 'ORIGINAL_MEMBER_LOGIN_REQUIRED' }, { status: 409 });
}

async function databasePhoneCollision(phone: string, memberId?: number, database: Pick<typeof db, 'select'> = db) {
  const aliases = phoneContactLookupValues(phone);
  const compact = sql<string>`regexp_replace(translate(trim(${users.phone}), '０１２３４５６７８９', '0123456789'), '[[:space:]()（）-]', '', 'g')`;
  const contact = or(inArray(users.phone, aliases), inArray(compact, aliases));
  const condition = memberId === undefined ? contact : and(contact, ne(users.id, memberId));
  return (await database.select({ id: users.id }).from(users).where(condition).limit(1)).length > 0;
}

function localPhoneCollision(phone: string, memberId?: number) {
  return listLocalCnUsers().some((row) => row.id !== memberId && row.phone && samePhoneContact(row.phone, phone));
}

async function accessToken(appId: string, appSecret: string) {
  const response = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret: appSecret, force_refresh: false }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.errmsg || '无法取得微信 access token');
  return String(data.access_token);
}

async function verifiedPhone(appId: string, appSecret: string, phoneCode: string) {
  if (process.env.WECHAT_MINI_MOCK_LOGIN === '1') {
    const parsed = JSON.parse(Buffer.from(phoneCode, 'base64url').toString('utf8'));
    return normalizeWechatVerifiedPhone(String(parsed.phone || parsed.purePhoneNumber || ''), String(parsed.countryCode || '86'));
  }
  const token = await accessToken(appId, appSecret);
  const response = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: phoneCode }),
  });
  const data = await response.json();
  if (!response.ok || data.errcode || !data.phone_info?.purePhoneNumber) throw new Error(data.errmsg || '无法取得微信验证手机号');
  return normalizeWechatVerifiedPhone(data.phone_info.purePhoneNumber, data.phone_info.countryCode);
}

async function finishPreAuthDatabaseLogin(appId: string, preAuthToken: string, phone: string) {
  const preAuth = readWechatMiniPreAuthToken(preAuthToken, appId);
  const providerUserId = `${appId}:${preAuth.openId}`;
  let result;
  try {
    result = await db.transaction(async (transaction) => {
      // Serialize by provider identity and phone; unique provider identity remains
      // the durable retry anchor if commit succeeds but file consumption fails.
      const locks = [`wechat-mini-id:${providerUserId}`, `wechat-mini-phone:${phoneContactLookupValues(phone)[0]}`].sort();
      for (const key of locks) await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${key})::bigint)`);
      readWechatMiniPreAuthToken(preAuthToken, appId);
      const exactIdentity = (await transaction.select().from(userIdentities).where(and(eq(userIdentities.provider, 'wechat_mini_program'), eq(userIdentities.providerUserId, providerUserId))).limit(1))[0];
      if (exactIdentity) {
        const row = (await transaction.select().from(users).where(eq(users.id, exactIdentity.userId)).limit(1))[0];
        if (!row) return { response: NextResponse.json({ error: '微信身份已存在，但会员资料不存在' }, { status: 409 }) };
        if (row.status && row.status !== 'active') return { response: NextResponse.json({ error: '无法完成当前绑定' }, { status: 403 }) };
        if (!row.phone && await databasePhoneCollision(phone, row.id, transaction)) return { response: contactConflictResponse() };
        const updated = row.phone ? row : (await transaction.update(users).set({ phone, updatedAt: new Date() }).where(eq(users.id, row.id)).returning())[0];
        return { row: updated, onboardingCompleted: true };
      }

      if (await databasePhoneCollision(phone, undefined, transaction)) return { response: contactConflictResponse() };
      const referrerId = await resolveReferrerId(preAuth.referralCode, transaction);
      if (!referrerId) return { response: NextResponse.json({ error: '找不到该推荐码，请向推荐人确认' }, { status: 400 }) };
      const now = new Date();
      const row = (await transaction.insert(users).values({
        name: preAuth.displayName || '微信会员', phone, role: 'member', agentLevel: 0, agentStatus: 'member', status: 'active',
        referralCode: createReferralCode('wechat_mini_program'), referrerId, referredByMemberId: referrerId,
        referralBoundAt: now, referralSource: 'wechat_mini_program_phone', createdAt: now, updatedAt: now,
      }).returning())[0];
      await transaction.insert(referralBindingAudit).values({
        auditId: `RBA-MINI-${Date.now()}-${row.id}`, memberId: row.id, referredByMemberId: referrerId,
        linkId: String(preAuth.referralToken || '').split('.')[0] || 'wechat-mini-preauth',
        visitId: `wechat-mini:${providerUserId}`, attributionId: `wechat-mini:${providerUserId}`,
        source: 'wechat_mini_program_phone', result: 'bound', reason: 'first_valid_bind', createdAt: now,
      });
      // A uniqueness failure must throw: returning a response here could commit
      // an orphan member/audit without its identity.
      await transaction.insert(userIdentities).values({
        userId: row.id, provider: 'wechat_mini_program', providerUserId,
        displayName: preAuth.displayName || null, avatarUrl: preAuth.avatarUrl || null,
        metadata: { unionId: preAuth.unionId, appId, openId: preAuth.openId, verifiedPhone: phone, linkedAt: now.toISOString(), mergeSource: 'new_phone' },
        createdAt: now, updatedAt: now,
      });
      return { row, onboardingCompleted: false };
    }, { isolationLevel: 'read committed' });
  } catch {
    return NextResponse.json({ error: '注册暂不可用，请稍后重新验证重试', code: 'REGISTRATION_RETRY_REQUIRED' }, { status: 503 });
  }
  if ('response' in result) return result.response;
  // Never consume before DB commit. Failure here leaves the committed identity
  // intact; retry resolves that same ID rather than inserting another member.
  consumeWechatMiniPreAuthToken(preAuthToken, appId);
  const user = toSessionUser(result.row);
  return jsonWithSession({ user, token: createSessionToken(user), phoneBound: true, onboardingCompleted: result.onboardingCompleted }, user);
}

export async function POST(request: NextRequest) {
  const appId = process.env.WECHAT_MINI_APP_ID;
  const appSecret = process.env.WECHAT_MINI_APP_SECRET;
  if (!appId || !appSecret) return NextResponse.json({ error: '微信小程序 AppID 或 AppSecret 尚未配置，无法验证手机号' }, { status: 503 });
  try {
    const body = await request.json();
    const phoneCode = String(body.phoneCode || '').trim();
    const preAuthToken = String(body.preAuthToken || '').trim();
    if (!phoneCode) return NextResponse.json({ error: '缺少微信手机号授权凭证' }, { status: 400 });
    const phone = await verifiedPhone(appId, appSecret, phoneCode);

    if (preAuthToken) {
      if (!process.env.DATABASE_URL) {
        const preAuth = readWechatMiniPreAuthToken(preAuthToken, appId);
        const existing = findLocalCnUserByScopedWechatIdentity(appId, preAuth.openId, preAuth.unionId);
        if (localPhoneCollision(phone, existing?.id)) return contactConflictResponse();
        consumeWechatMiniPreAuthToken(preAuthToken, appId);
        const result = findOrCreateLocalWechatUser(preAuth.openId, preAuth.unionId || null, preAuth.displayName || '微信会员', preAuth.referralCode, 'mini_program', appId, phone, preAuth.avatarUrl);
        const local = result.user;
        const user = { id: local.id, name: local.name, email: local.email, agentLevel: local.agentLevel, role: local.role, region: 'CN', referralCode: local.referralCode, platformAdmin: local.platformAdmin === true };
        return jsonWithSession({ user, token: createSessionToken(user), phoneBound: true, onboardingCompleted: Boolean(local.onboardingCompletedAt), isNewMember: result.isNew }, user);
      }
      return await finishPreAuthDatabaseLogin(appId, preAuthToken, phone);
    }

    const session = await getFreshSessionUser(request);
    if (!session) return NextResponse.json({ error: '请先完成微信登录' }, { status: 401 });
    if (!process.env.DATABASE_URL) {
      if (localPhoneCollision(phone, session.id)) return contactConflictResponse();
      const local = bindLocalWechatVerifiedPhone(session.id, phone);
      const user = { id: local.id, name: local.name, email: local.email, agentLevel: local.agentLevel, role: local.role, region: 'CN', referralCode: local.referralCode, platformAdmin: local.platformAdmin === true };
      return jsonWithSession({ user, token: createSessionToken(user), phoneBound: true, onboardingCompleted: Boolean(local.onboardingCompletedAt) }, user);
    }

    const current = (await db.select().from(users).where(eq(users.id, session.id)).limit(1))[0];
    if (!current) return NextResponse.json({ error: '找不到当前会员' }, { status: 404 });
    if (await databasePhoneCollision(phone, current.id)) return contactConflictResponse();
    const updated = (await db.update(users).set({ phone, updatedAt: new Date() }).where(eq(users.id, current.id)).returning())[0];
    const user = toSessionUser(updated);
    return jsonWithSession({ user, token: createSessionToken(user), phoneBound: true, onboardingCompleted: false }, user);
  } catch (error) {
    if (error instanceof WechatMiniPreAuthStoreError) return NextResponse.json({ error: error.message, code: 'PREAUTH_STORE_RETRY_REQUIRED' }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : '微信手机号绑定失败' }, { status: 400 });
  }
}

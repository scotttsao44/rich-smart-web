import { jsonWithSession, linkOrCreateUserFromExternalProfile } from '@/lib/oauth';
import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, toSessionUser } from '@/lib/auth';
import {
  findLocalCnUserByScopedWechatIdentity,
  findOrCreateLocalWechatUser,
  isKnownLocalCnReferrerCode,
} from '@/lib/local-cn-users';
import { db } from '@/lib/db';
import { userIdentities, users } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { resolveReferrerId } from '@/lib/referrals';
import { createWechatMiniPreAuthToken } from '@/lib/wechat-mini-preauth';
import { referralCodeFromLocalCnReferralToken } from '@/lib/local-cn-referral-attribution';

export const dynamic = 'force-dynamic';

type WechatMiniSession = { openid: string; unionid?: string | null; errcode?: number; errmsg?: string };

function miniSessionUser(localUser: {
  id: number;
  name: string;
  email: string | null;
  agentLevel: number | null;
  role: string;
  referralCode: string | null;
  platformAdmin?: boolean;
  phoneVerifiedAt?: string | null;
}) {
  return {
    id: localUser.id,
    name: localUser.name,
    email: localUser.email || '',
    agentLevel: localUser.agentLevel || 0,
    role: localUser.role,
    region: 'CN',
    referralCode: localUser.referralCode || '',
    platformAdmin: localUser.platformAdmin === true,
    phoneBound: Boolean(localUser.phoneVerifiedAt),
  };
}

async function exchangeWechatMiniCode(appId: string, appSecret: string, code: string): Promise<WechatMiniSession> {
  if (process.env.WECHAT_MINI_MOCK_LOGIN === '1') {
    try {
      const parsed = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
      return {
        openid: String(parsed.openid || parsed.openId || ''),
        unionid: parsed.unionid || parsed.unionId ? String(parsed.unionid || parsed.unionId) : null,
      };
    } catch {
      // fall through
    }
  }
  if (!appSecret && process.env.CN_TRANSITIONAL_TEST_MODE !== 'false') {
    const { createHash } = await import('crypto');
    const digest = createHash('sha256').update(code).digest('hex').slice(0, 20);
    return {
      openid: `wx_mini_open_${digest}`,
      unionid: `wx_mini_union_${digest}`,
    };
  }

  const sessionUrl = new URL('https://api.weixin.qq.com/sns/jscode2session');
  sessionUrl.searchParams.set('appid', appId);
  sessionUrl.searchParams.set('secret', appSecret);
  sessionUrl.searchParams.set('js_code', code);
  sessionUrl.searchParams.set('grant_type', 'authorization_code');
  const sessionRes = await fetch(sessionUrl);
  const data = await sessionRes.json();
  if ((data.errcode || !data.openid) && process.env.CN_TRANSITIONAL_TEST_MODE !== 'false') {
    const { createHash } = await import('crypto');
    const digest = createHash('sha256').update(code).digest('hex').slice(0, 20);
    return {
      openid: `wx_mini_open_${digest}`,
      unionid: `wx_mini_union_${digest}`,
    };
  }
  return data;
}

function metadataUnionId(identity: { metadata: unknown }) {
  const metadata = identity.metadata && typeof identity.metadata === 'object' ? identity.metadata as Record<string, unknown> : {};
  return String(metadata.unionId || metadata.unionid || '').trim();
}

async function findDatabaseIdentityByUnionId(unionId: string) {
  if (!unionId) return null;
  const rows = await db.select().from(userIdentities);
  return rows.find((identity) => metadataUnionId(identity) === unionId) || null;
}

function phoneRequired(appId: string, session: WechatMiniSession, referralCode: string, referralToken: string, displayName: string, avatarUrl: string) {
  return NextResponse.json({
    code: 'PHONE_REQUIRED',
    error: '微信未返回 UnionID，请先完成手机号验证后合并会员',
    preAuthToken: createWechatMiniPreAuthToken({
      appId,
      openId: session.openid,
      unionId: session.unionid || null,
      referralCode,
      referralToken,
      displayName,
      avatarUrl,
    }),
  }, { status: 409 });
}

export async function POST(request: NextRequest) {
  try {
    const appId = process.env.WECHAT_MINI_APP_ID || 'wx7d5e900c9d185513';
    const appSecret = process.env.WECHAT_MINI_APP_SECRET || '';
    if ((!appId || !appSecret) && process.env.CN_TRANSITIONAL_TEST_MODE === 'false') {
      return NextResponse.json({ error: '管理员尚未完成微信登录设置', code: 'WECHAT_MINI_NOT_CONFIGURED' }, { status: 503 });
    }

    const body = await request.json();
    const code = String(body.code || '').trim();
    const referralToken = String(body.referralToken || '').trim();
    const rawRefCode = String(body.referrerCode || body.ref || '').trim();
    const referrerCode = (referralToken ? referralCodeFromLocalCnReferralToken(referralToken) || '' : '')
      || rawRefCode
      || (process.env.CN_TRANSITIONAL_TEST_MODE !== 'false' ? 'RS-CN-SCOOT' : '');
    if (!code) return NextResponse.json({ error: '缺少小程序 login code' }, { status: 400 });

    const session = await exchangeWechatMiniCode(appId, appSecret, code);
    if (session.errcode || !session.openid) {
      return NextResponse.json({ error: session.errmsg || '小程序登录失败' }, { status: 400 });
    }

    const userInfo = body.userInfo && typeof body.userInfo === 'object' ? body.userInfo : {};
    const displayName = String(userInfo.nickName || userInfo.nickname || '微信会员');
    const avatarUrl = String(userInfo.avatarUrl || '');

    if (!process.env.DATABASE_URL) {
      const existing = findLocalCnUserByScopedWechatIdentity(appId, session.openid, session.unionid || null);
      if (existing) {
        const result = findOrCreateLocalWechatUser(session.openid, session.unionid || null, displayName, null, 'mini_program', appId, null, avatarUrl);
        const localUser = result.user;
        const user = miniSessionUser(localUser);
        return jsonWithSession({
          user,
          token: createSessionToken(user),
          isNewMember: result.isNew,
          needsProfile: !localUser.profileAuthorizedAt,
          needsOnboarding: !localUser.onboardingCompletedAt,
          phoneBound: Boolean(localUser.phoneVerifiedAt),
        }, user);
      }
      if (!referralToken && !referrerCode) return NextResponse.json({ error: '请从邀请链接进入完成会员注册', code: 'REFERRAL_REQUIRED' }, { status: 400 });
      if (!referrerCode) return NextResponse.json({ error: '邀请链接已失效，请联系邀请人重新分享', code: 'REFERRAL_TOKEN_INVALID' }, { status: 400 });
      if (!isKnownLocalCnReferrerCode(referrerCode)) {
        return NextResponse.json({ error: '找不到该推荐码，请向推荐人确认', code: 'REFERRAL_NOT_FOUND' }, { status: 400 });
      }
      if (!session.unionid) return phoneRequired(appId, session, referrerCode, referralToken, displayName, avatarUrl);

      const result = findOrCreateLocalWechatUser(session.openid, session.unionid || null, displayName, referrerCode, 'mini_program', appId, null, avatarUrl);
      const localUser = result.user;
      const user = miniSessionUser(localUser);
      return jsonWithSession({
        user,
        token: createSessionToken(user),
        isNewMember: result.isNew,
        needsProfile: !localUser.profileAuthorizedAt,
        needsOnboarding: !localUser.onboardingCompletedAt,
        phoneBound: Boolean(localUser.phoneVerifiedAt),
      }, user);
    }

    const providerUserId = `${appId}:${session.openid}`;
    const existingIdentity = (await db.select().from(userIdentities).where(and(eq(userIdentities.provider, 'wechat_mini_program'), eq(userIdentities.providerUserId, providerUserId))).limit(1))[0];
    if (existingIdentity) {
      const row = (await db.select().from(users).where(eq(users.id, existingIdentity.userId)).limit(1))[0];
      if (!row) return NextResponse.json({ error: '微信身份已存在，但会员资料不存在' }, { status: 409 });
      const user = toSessionUser(row);
      return jsonWithSession({ user, token: createSessionToken(user), isNewMember: false, needsProfile: false, needsOnboarding: false, phoneBound: Boolean(row.phone) }, user);
    }

    const unionIdentity = session.unionid ? await findDatabaseIdentityByUnionId(String(session.unionid)) : null;
    if (unionIdentity) {
      const row = (await db.select().from(users).where(eq(users.id, unionIdentity.userId)).limit(1))[0];
      if (!row) return NextResponse.json({ error: '微信身份已存在，但会员资料不存在' }, { status: 409 });
      const now = new Date();
      await db.insert(userIdentities).values({
        userId: row.id,
        provider: 'wechat_mini_program',
        providerUserId,
        displayName,
        avatarUrl: avatarUrl || null,
        metadata: { unionId: session.unionid, appId, openId: session.openid, linkedAt: now.toISOString(), mergeSource: 'unionid' },
        createdAt: now,
        updatedAt: now,
      });
      const user = toSessionUser(row);
      return jsonWithSession({ user, token: createSessionToken(user), isNewMember: false, needsProfile: false, needsOnboarding: false, phoneBound: Boolean(row.phone) }, user);
    }

    if (!referralToken && !referrerCode) return NextResponse.json({ error: '请从邀请链接进入完成会员注册', code: 'REFERRAL_REQUIRED' }, { status: 400 });
    if (!referrerCode) return NextResponse.json({ error: '邀请链接已失效，请联系邀请人重新分享', code: 'REFERRAL_TOKEN_INVALID' }, { status: 400 });
    if (!(await resolveReferrerId(referrerCode))) {
      return NextResponse.json({ error: '找不到该推荐码，请向推荐人确认', code: 'REFERRAL_NOT_FOUND' }, { status: 400 });
    }
    if (!session.unionid) return phoneRequired(appId, session, referrerCode, referralToken, displayName, avatarUrl);

    const user = await linkOrCreateUserFromExternalProfile(request, {
      provider: 'wechat_mini_program',
      providerUserId,
      displayName,
      avatarUrl: avatarUrl || null,
      metadata: {
        unionId: session.unionid,
        appId,
        openId: session.openid,
        linkedAt: new Date().toISOString(),
      },
    }, referrerCode);

    const identity = (await db.select().from(userIdentities).where(and(eq(userIdentities.provider, 'wechat_mini_program'), eq(userIdentities.providerUserId, providerUserId))).limit(1))[0];
    const row = (await db.select({ phone: users.phone }).from(users).where(eq(users.id, user.id)).limit(1))[0];
    const metadata = identity?.metadata && typeof identity.metadata === 'object' ? identity.metadata as Record<string, unknown> : {};
    return jsonWithSession({
      user,
      token: createSessionToken(user),
      isNewMember: true,
      needsProfile: !metadata.profileAuthorizedAt,
      needsOnboarding: !metadata.onboardingCompletedAt,
      phoneBound: Boolean(row?.phone),
    }, user);
  } catch (error) {
    console.error('微信小程序登录失败:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '微信小程序登录失败' }, { status: 500 });
  }
}

import { confirmWechatQrSession, getWechatQrSession } from "@/lib/wechat-qr-session";
import { NextRequest, NextResponse } from 'next/server';
import { appOrigin, createOAuthState, redirectWithSession, setOAuthStateCookie, verifyOAuthState } from '@/lib/oauth';
import { getFreshSessionUser } from '@/lib/auth';
import {
  bindImmutableLocalCnReferral,
  CAOMI_OFFICIAL_REFERRAL_CODE,
  findLocalCnUserById,
  findLocalCnUserByReferralCode,
  findOrCreateLocalWechatUser,
  grantLocalCnPromotionQualification,
  isKnownLocalCnReferrerCode,
  normalizeCnReferrerCode,
} from '@/lib/local-cn-users';
import { db } from '@/lib/db';
import { userIdentities } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { linkOrCreateUserFromExternalProfile } from '@/lib/oauth';
import { linkLocalCnWechatIdentityToMember } from '@/lib/local-cn-member-identities';
import { readPendingReferralAttribution } from '@/lib/local-cn-referral-attribution';

export type WechatWebKind = 'official' | 'open';

export type WechatWebProfile = {
  openId: string;
  unionId: string | null;
  verifiedPhone?: string | null;
  nickname: string;
  avatarUrl: string;
  city?: string;
  province?: string;
  country?: string;
};

type WechatToken = {
  accessToken: string;
  openId: string;
  unionId: string | null;
};

export function wechatWebProvider(kind: WechatWebKind) {
  return kind === 'official'
    ? {
      source: 'wechat_official' as const,
      provider: 'wechat_official' as const,
      appId: process.env.WECHAT_OFFICIAL_APP_ID || '',
      appSecret: process.env.WECHAT_OFFICIAL_APP_SECRET || '',
      callbackPath: '/api/auth/wechat/official/callback',
      authBase: 'https://open.weixin.qq.com/connect/oauth2/authorize',
      scope: 'snsapi_userinfo',
    }
    : {
      source: 'wechat_open' as const,
      provider: 'wechat_open' as const,
      appId: process.env.WECHAT_OPEN_APP_ID || '',
      appSecret: process.env.WECHAT_OPEN_APP_SECRET || '',
      callbackPath: '/api/auth/wechat/open/callback',
      authBase: 'https://open.weixin.qq.com/connect/qrconnect',
      scope: 'snsapi_login',
    };
}

export function fixedWechatCallbackUrl(kind: WechatWebKind) {
  const configured = (
    kind === 'official'
      ? process.env.WECHAT_WEB_AUTH_ORIGIN || process.env.WECHAT_WEB_AUTH_DOMAIN
      : process.env.WECHAT_OPEN_REDIRECT_ORIGIN || process.env.WECHAT_OPEN_REDIRECT_DOMAIN
  ) || process.env.PUBLIC_DOMAIN || 'https://rich-smart.cn';
  const origin = configured.startsWith('http://') || configured.startsWith('https://')
    ? configured.replace(/\/+$/, '')
    : `https://${configured.replace(/\/+$/, '')}`;
  return `${origin}${wechatWebProvider(kind).callbackPath}`;
}

export function wechatWebConfigured(kind: WechatWebKind) {
  const provider = wechatWebProvider(kind);
  return Boolean(provider.appId && provider.appSecret);
}

export function isWechatBrowser(userAgent: string) {
  return /micromessenger/i.test(userAgent);
}

export function sanitizeCnReturnTo(value: string | null) {
  if (!value) return '/cn/shop';
  if (!value.startsWith('/') || value.startsWith('//')) return '/cn/shop';
  return value.startsWith('/cn') || value.startsWith('/vendor') ? value : '/cn/shop';
}

function loginErrorRedirect(request: NextRequest, message: string, referralCode = '') {
  const url = new URL('/cn/login', appOrigin(request));
  url.searchParams.set('error', message);
  if (referralCode) url.searchParams.set('ref', referralCode);
  return NextResponse.redirect(url);
}

export async function startWechatWebOAuth(request: NextRequest, kind: WechatWebKind) {
  const provider = wechatWebProvider(kind);
  const returnTo = sanitizeCnReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const queryRef = (
    request.nextUrl.searchParams.get('ref') ||
    request.nextUrl.searchParams.get('r') ||
    request.nextUrl.searchParams.get('referrerCode') ||
    ''
  ).trim();
  const pendingReferral = readPendingReferralAttribution(request);
  const pendingRefCode = pendingReferral
    ? normalizeCnReferrerCode(findLocalCnUserById(pendingReferral.referrerMemberId)?.referralCode)
    : '';
  const referralCode = queryRef ? normalizeCnReferrerCode(queryRef) : pendingRefCode;
  const bindCurrent = request.nextUrl.searchParams.get('bind') === '1';
  const currentUser = bindCurrent ? await getFreshSessionUser(request).catch(() => null) : null;
  if (bindCurrent && (!currentUser || currentUser.region !== 'CN')) {
    return loginErrorRedirect(request, '请先登录后绑定微信');
  }
  if (!provider.appId || !provider.appSecret) {
    const url = new URL('/cn/login', appOrigin(request));
    url.searchParams.set('wechatQuick', '1');
    if (returnTo) url.searchParams.set('returnTo', returnTo);
    if (referralCode) url.searchParams.set('ref', referralCode);
    return NextResponse.redirect(url);
  }

  const state = createOAuthState(provider.provider, returnTo, referralCode, currentUser?.id);
  const authUrl = new URL(provider.authBase);
  authUrl.searchParams.set('appid', provider.appId);
  authUrl.searchParams.set('redirect_uri', fixedWechatCallbackUrl(kind));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', provider.scope);
  authUrl.searchParams.set('state', state);
  const suffix = kind === 'official' ? '#wechat_redirect' : '';
  const response = NextResponse.redirect(`${authUrl.toString()}${suffix}`);
  setOAuthStateCookie(response, state);
  return response;
}

function mockProfile(kind: WechatWebKind, code: string): WechatWebProfile | null {
  if (process.env.WECHAT_AUTH_MOCK !== 'true') return null;
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境不可启用微信 OAuth mock');
  const raw = kind === 'official' ? process.env.WECHAT_OFFICIAL_MOCK_PROFILE : process.env.WECHAT_OPEN_MOCK_PROFILE;
  const parsed = raw ? JSON.parse(raw) : {};
  return {
    openId: String(parsed.openid || parsed.openId || `${kind}-openid-${code}`),
    unionId: parsed.unionid === null ? null : String(parsed.unionid || parsed.unionId || `union-${code}`),
    verifiedPhone: parsed.phone || parsed.verifiedPhone ? String(parsed.phone || parsed.verifiedPhone) : null,
    nickname: String(parsed.nickname || '微信测试会员'),
    avatarUrl: String(parsed.headimgurl || parsed.avatarUrl || ''),
    city: parsed.city ? String(parsed.city) : '',
    province: parsed.province ? String(parsed.province) : '',
    country: parsed.country ? String(parsed.country) : '',
  };
}

async function exchangeWechatToken(kind: WechatWebKind, code: string, fetcher: typeof fetch = fetch): Promise<WechatToken> {
  const provider = wechatWebProvider(kind);
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.searchParams.set('appid', provider.appId);
  tokenUrl.searchParams.set('secret', provider.appSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  const response = await fetcher(tokenUrl);
  const data = await response.json();
  if (!response.ok || data.errcode || !data.openid || !data.access_token) throw new Error(data.errmsg || '微信 token 交换失败');
  return { accessToken: String(data.access_token), openId: String(data.openid), unionId: data.unionid ? String(data.unionid) : null };
}

async function fetchWechatProfile(token: WechatToken, fetcher: typeof fetch = fetch): Promise<WechatWebProfile> {
  const profileUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  profileUrl.searchParams.set('access_token', token.accessToken);
  profileUrl.searchParams.set('openid', token.openId);
  profileUrl.searchParams.set('lang', 'zh_CN');
  const response = await fetcher(profileUrl);
  const data = await response.json();
  if (!response.ok || data.errcode) throw new Error(data.errmsg || '微信会员资料读取失败');
  return {
    openId: String(data.openid || token.openId),
    unionId: data.unionid ? String(data.unionid) : token.unionId,
    nickname: String(data.nickname || '微信会员'),
    avatarUrl: String(data.headimgurl || ''),
    city: data.city ? String(data.city) : '',
    province: data.province ? String(data.province) : '',
    country: data.country ? String(data.country) : '',
  };
}

export async function exchangeWechatWebProfile(kind: WechatWebKind, code: string, fetcher: typeof fetch = fetch) {
  const mocked = mockProfile(kind, code);
  if (mocked) return mocked;
  const token = await exchangeWechatToken(kind, code, fetcher);
  return fetchWechatProfile(token, fetcher);
}

export async function finishWechatWebOAuth(request: NextRequest, kind: WechatWebKind) {
  let referralCode = '';
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) throw new Error('微信未回传授权 code');
    const provider = wechatWebProvider(kind);
    if (!provider.appId || !provider.appSecret) throw new Error('微信登入尚未配置');
    const state = verifyOAuthState(request, provider.provider, request.nextUrl.searchParams.get('state'));
    const pendingReferral = readPendingReferralAttribution(request);
    referralCode = pendingReferral
      ? normalizeCnReferrerCode(findLocalCnUserById(pendingReferral.referrerMemberId)?.referralCode)
      : state.referralCode || '';
    if (state.bindMemberId) {
      const currentUser = await getFreshSessionUser(request).catch(() => null);
      if (!currentUser || currentUser.region !== 'CN' || currentUser.id !== state.bindMemberId) {
        throw new Error('当前登录会员已变更或失效，请重新登录后绑定微信');
      }
    }
    const profile = await exchangeWechatWebProfile(kind, code);

    if (!process.env.DATABASE_URL && (state.returnTo.startsWith('/cn') || state.returnTo.startsWith('/vendor'))) {
      let qrSid = '';
      try {
        const returnUrl = new URL(state.returnTo, 'http://localhost');
        qrSid = String(returnUrl.searchParams.get('sid') || '').trim();
      } catch {}
      const qrSession = qrSid ? getWechatQrSession(qrSid) : null;
      const effectiveRefCode = normalizeCnReferrerCode(
        referralCode || qrSession?.referrerCode || CAOMI_OFFICIAL_REFERRAL_CODE,
      );
      const effectiveUnionId = profile.unionId || `wx_union_${provider.appId}_${profile.openId}`;

      if (state.bindMemberId) {
        const linked = linkLocalCnWechatIdentityToMember(state.bindMemberId, {
          source: provider.source,
          appId: provider.appId,
          openId: profile.openId,
          unionId: effectiveUnionId,
          verifiedPhone: profile.verifiedPhone || null,
          displayName: profile.nickname,
          avatarUrl: profile.avatarUrl,
          referrerCode: effectiveRefCode,
        });
        return redirectWithSession(new URL(state.returnTo, appOrigin(request)).toString(), {
          id: linked.user.id,
          name: linked.user.name,
          email: linked.user.email,
          agentLevel: linked.user.agentLevel,
          role: linked.user.role,
          region: 'CN',
          referralCode: linked.user.referralCode,
          platformAdmin: linked.user.platformAdmin === true,
        });
      }
      const existing = findOrCreateLocalWechatUser(
        profile.openId,
        effectiveUnionId,
        profile.nickname,
        effectiveRefCode,
        kind === 'official' ? 'official_account' : 'open_platform',
        provider.appId,
        profile.verifiedPhone || null,
        profile.avatarUrl,
      );
      if (existing.isNew && effectiveRefCode && !isKnownLocalCnReferrerCode(effectiveRefCode)) {
        throw new Error('邀请链接已失效，请联系邀请人重新分享');
      }
      const localUser = existing.user;
      const refUser = effectiveRefCode ? findLocalCnUserByReferralCode(effectiveRefCode) : null;
      if (refUser && !localUser.referredByMemberId && localUser.id !== refUser.id) {
        bindImmutableLocalCnReferral({
          memberId: localUser.id,
          referrerMemberId: pendingReferral?.referrerMemberId || refUser.id,
          source: kind === 'official' ? 'wechat_official_oauth' : 'wechat_open_oauth',
          attributionId: pendingReferral?.attributionId || null,
          visitId: pendingReferral?.visitId || null,
        });
      }
      grantLocalCnPromotionQualification(localUser.id, {
        actorId: localUser.id,
        source: 'wechat_oauth_auto',
      });
      const freshUser = findLocalCnUserById(localUser.id) || localUser;
      if (qrSid) {
        confirmWechatQrSession(qrSid, { memberId: freshUser.id, nickname: freshUser.name });
      }
      return redirectWithSession(new URL(state.returnTo, appOrigin(request)).toString(), {
        id: freshUser.id,
        name: freshUser.name,
        email: freshUser.email,
        agentLevel: freshUser.agentLevel,
        role: freshUser.role,
        region: 'CN',
        referralCode: freshUser.referralCode,
        platformAdmin: freshUser.platformAdmin === true,
      });
    }

    const providerUserId = `${provider.appId}:${profile.openId}`;
    const existingIdentity = await db.select({ id: userIdentities.id }).from(userIdentities).where(and(
      eq(userIdentities.provider, provider.provider),
      eq(userIdentities.providerUserId, providerUserId),
    )).limit(1);
    if (!state.bindMemberId && !existingIdentity[0] && !profile.unionId && !profile.verifiedPhone) {
      throw new Error('微信未返回 UnionID，请先完成手机号验证后合并会员');
    }
    if (!state.bindMemberId && !existingIdentity[0] && !referralCode) throw new Error('请从邀请链接进入完成会员注册');
    const user = await linkOrCreateUserFromExternalProfile(request, {
      provider: provider.provider,
      providerUserId,
      displayName: profile.nickname,
      avatarUrl: profile.avatarUrl,
      metadata: {
        appId: provider.appId,
        openId: profile.openId,
        unionId: profile.unionId,
        city: profile.city,
        province: profile.province,
        country: profile.country,
        linkedAt: new Date().toISOString(),
      },
    }, referralCode);
    return redirectWithSession(new URL(state.returnTo, appOrigin(request)).toString(), user);
  } catch (error) {
    const message = error instanceof Error ? error.message : '微信授权失败';
    return loginErrorRedirect(request, message, referralCode);
  }
}

export function jsonWechatWebConfig() {
  return NextResponse.json({
    officialConfigured: wechatWebConfigured('official'),
    openConfigured: wechatWebConfigured('open'),
    officialStartUrl: '/api/auth/wechat/official/start',
    openStartUrl: '/api/auth/wechat/open/start',
    testEntryEnabled: process.env.NODE_ENV !== 'production' || process.env.CN_TEST_ACCOUNT_ENABLED === 'true',
  });
}

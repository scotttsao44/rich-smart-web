import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { createSessionToken, getFreshSessionUser, setSessionCookie, type SessionUser } from '@/lib/auth';
import {
  bindImmutableLocalCnReferral,
  CAOMI_OFFICIAL_REFERRAL_CODE,
  findLocalCnUserById,
  findLocalCnUserByReferralCode,
  findLocalCnUserByWechatIdentity,
  findOrCreateLocalWechatUser,
  explicitCnReferrerCode,
  grantLocalCnPromotionQualification,
  isLocalCnAttributionPending,
  normalizeCnReferrerCode,
  updateLocalCnMemberProfile,
} from '@/lib/local-cn-users';
import {
  clearPendingReferralAttributionCookie,
  ensureLocalCnReferralLink,
  readPendingReferralAttribution,
} from '@/lib/local-cn-referral-attribution';
import { wechatWebConfigured } from '@/lib/wechat-web-auth';

export const dynamic = 'force-dynamic';

const WX_QUICK_COOKIE = 'rs_wx_identity';

function toSessionUser(user: NonNullable<ReturnType<typeof findLocalCnUserById>>): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    agentLevel: user.agentLevel,
    role: user.role,
    region: 'CN',
    referralCode: user.referralCode,
    platformAdmin: user.platformAdmin === true,
    referralSharingEnabled: user.referralSharingEnabled !== false,
  };
}

function buildMemberPayload(user: NonNullable<ReturnType<typeof findLocalCnUserById>>) {
  const referrer = user.referredByMemberId
    ? findLocalCnUserById(user.referredByMemberId)
    : user.referrerCode
      ? findLocalCnUserByReferralCode(user.referrerCode)
      : null;
  return {
    id: user.id,
    name: user.name,
    phone: user.phone || '',
    email: user.email && !user.email.endsWith('@local.invalid') ? user.email : '',
    referralCode: user.referralCode,
    referredByMemberId: referrer?.id || user.referredByMemberId || null,
    referrerCode: referrer?.referralCode || user.referrerCode || (isLocalCnAttributionPending(user) ? '' : CAOMI_OFFICIAL_REFERRAL_CODE),
    referrerName: referrer?.name || (isLocalCnAttributionPending(user) ? '待确认归属（客服核对中）' : '糙米健康官方直属'),
    profileAuthorized: Boolean(user.profileAuthorizedAt),
    onboardingCompleted: Boolean(user.onboardingCompletedAt),
  };
}

function clearResidualWechatCookie(response: NextResponse) {
  response.cookies.set(WX_QUICK_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.ALLOW_HTTP_SESSION_COOKIE !== 'true',
    path: '/',
    maxAge: 0,
  });
}

export async function GET() {
  const officialConfigured = wechatWebConfigured('official');
  const openConfigured = wechatWebConfigured('open');

  // Never return any residual savedMember or cookie identity on GET
  const response = NextResponse.json({
    officialConfigured,
    openConfigured,
    hasSavedIdentity: false,
    savedMember: null,
    member: null,
    user: null,
    token: null,
  });
  clearResidualWechatCookie(response);
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawNickname = String(body.nickname || '').trim().slice(0, 60);
    const rawPhone = String(body.phone || '').trim();
    const rawEmail = String(body.email || '').trim().toLowerCase();
    const authorizeProfile = Boolean(body.authorizeProfile);
    const bodyReferrerCode = String(body.referrerCode || '').trim().toUpperCase();
    // Only honor explicit forceNew from the client. Do NOT auto-forceNew when the user is
    // saving/updating nickname or profile on an existing WeChat session — that was creating a
    // brand-new wx_quick_* member and made「保存昵称 / 确认授权并保存会员资料」appear broken.
    let forceNew = Boolean(body.forceNew);

    // 已登录会员保存资料（authorizeProfile）一律视为更新本人资料，不因 forceNew 另建会员
    const activeSession = (!forceNew || authorizeProfile) ? await getFreshSessionUser(request).catch(() => null) : null;
    if (activeSession?.id && !authorizeProfile) {
      const existing = findLocalCnUserById(activeSession.id);
      if (existing) {
        // Multi-level quick-login testing (non-profile flows only): treat self-ref / changed
        // referrer / different nickname as a request to mint a fresh test member.
        const existingRef = String(existing.referrerCode || '').trim().toUpperCase();
        const existingOwnCode = String(existing.referralCode || '').trim().toUpperCase();
        if (
          (bodyReferrerCode && (bodyReferrerCode === existingOwnCode || (existingRef && bodyReferrerCode !== existingRef))) ||
          (rawNickname && existing.name && rawNickname !== existing.name)
        ) {
          forceNew = true;
        }
      }
    }

    if (authorizeProfile && activeSession?.id) {
      const existing = findLocalCnUserById(activeSession.id);
      if (existing) {
        // 资料更新不改推荐人。改绑只走管理员接口。
        const updated = updateLocalCnMemberProfile(existing.id, {
          name: rawNickname || existing.name,
          phone: rawPhone || undefined,
          email: rawEmail || undefined,
        });
        ensureLocalCnReferralLink(updated.id);
        const sessionUser = toSessionUser(updated);
        const token = createSessionToken(sessionUser);
        const response = NextResponse.json({
          user: sessionUser,
          member: buildMemberPayload(updated),
          token,
          isNew: false,
          authMode: 'session_profile_update',
        });
        setSessionCookie(response, sessionUser);
        clearResidualWechatCookie(response);
        return response;
      }
    }

    // 生产环境不再以随机 wx_quick_ openid 建立会员（每次都会产生新会员/新推荐码）；必须走微信公众号真实 OAuth
    if (process.env.NODE_ENV === 'production' && process.env.CN_QUICK_LOGIN_TEST !== 'true') {
      return NextResponse.json({ error: '请在微信内打开或使用微信扫一扫登录', requiresWechatOAuth: true }, { status: 403 });
    }

    // Always generate a fresh identity token; never reuse residual rs_wx_identity cookies or device tokens
    const rawToken = randomBytes(12).toString('hex');
    const digest = createHash('sha256').update(`caomi-wx-quick:${rawToken}`).digest('hex').slice(0, 24);
    const openId = `wx_quick_${digest}`;
    const unionId = `wx_union_${digest}`;

    const bodyReferrerUser = bodyReferrerCode ? findLocalCnUserByReferralCode(bodyReferrerCode) : null;
    const pendingReferral = readPendingReferralAttribution(request, bodyReferrerCode || null);
    const pendingReferrerUser = pendingReferral ? findLocalCnUserById(pendingReferral.referrerMemberId) : null;
    // Explicit referrerCode from the form/URL always takes precedence over any residual cookie
    const resolvedReferrerUser = bodyReferrerUser || pendingReferrerUser;
    const resolvedReferrerCode = explicitCnReferrerCode(resolvedReferrerUser?.referralCode || bodyReferrerCode || '');

    const existingIdentityUser = findLocalCnUserByWechatIdentity(openId, unionId);
    const displayName =
      rawNickname ||
      (existingIdentityUser?.name && !existingIdentityUser.name.startsWith('微信会员')
        ? existingIdentityUser.name
        : `微信用户_${digest.slice(0, 4).toUpperCase()}`);

    const result = findOrCreateLocalWechatUser(
      openId,
      unionId,
      displayName,
      resolvedReferrerCode,
      'official_account',
      null,
      null,
      null,
    );

    let user = result.user;
    if (authorizeProfile) {
      user = updateLocalCnMemberProfile(user.id, {
        name: rawNickname || user.name,
        phone: rawPhone || undefined,
        email: rawEmail || undefined,
      });
    } else if (rawNickname && user.name !== rawNickname) {
      user = updateLocalCnMemberProfile(user.id, { name: rawNickname });
    } else if (user.name.startsWith('微信会员_') && displayName.startsWith('微信用户_')) {
      user = updateLocalCnMemberProfile(user.id, { name: displayName });
    }

    if (resolvedReferrerUser && user.id !== resolvedReferrerUser.id) {
      bindImmutableLocalCnReferral({
        memberId: user.id,
        referrerMemberId: resolvedReferrerUser.id,
        source: 'wechat_quick_auth',
        attributionId: pendingReferral?.attributionId || null,
        visitId: pendingReferral?.visitId || null,
      });
    }

    if (!isLocalCnAttributionPending(findLocalCnUserById(user.id) || user)) {
      grantLocalCnPromotionQualification(user.id, {
        actorId: user.id,
        source: 'wechat_quick_auth_auto',
      });
      ensureLocalCnReferralLink(user.id);
    }

    const freshUser = findLocalCnUserById(user.id) || user;
    const sessionUser = toSessionUser(freshUser);
    const token = createSessionToken(sessionUser);

    const memberPayload = buildMemberPayload(freshUser);
    const response = NextResponse.json({
      user: {
        ...sessionUser,
        referrerCode: memberPayload.referrerCode,
        referrerName: memberPayload.referrerName,
        referredByMemberId: memberPayload.referredByMemberId,
      },
      member: memberPayload,
      token,
      isNew: result.isNew,
      authMode: 'wechat_quick_auth',
    });

    setSessionCookie(response, sessionUser);
    clearResidualWechatCookie(response);
    clearPendingReferralAttributionCookie(response, request.nextUrl.protocol === 'https:');
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '微信一键登录失败，请稍后重试' },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getFreshSessionUser(request).catch(() => null);
    if (!session?.id) {
      return NextResponse.json({ error: '请先登录后再修改昵称' }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const nickname = String(body.nickname || body.name || '').trim();
    if (!nickname) {
      return NextResponse.json({ error: '请填写昵称' }, { status: 400 });
    }
    const updated = updateLocalCnMemberProfile(session.id, { name: nickname });
    ensureLocalCnReferralLink(updated.id);
    const sessionUser = toSessionUser(updated);
    const token = createSessionToken(sessionUser);
    const response = NextResponse.json({
      user: sessionUser,
      member: buildMemberPayload(updated),
      token,
      isNew: false,
      authMode: 'session_nickname_patch',
    });
    setSessionCookie(response, sessionUser);
    clearResidualWechatCookie(response);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '昵称更新失败' },
      { status: 400 },
    );
  }
}

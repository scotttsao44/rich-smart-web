import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { createSessionToken, setSessionCookie, type SessionUser } from '@/lib/auth';
import {
  bindImmutableLocalCnReferral,
  findLocalCnUserById,
  findLocalCnUserByReferralCode,
  findLocalCnUserByWechatIdentity,
  findOrCreateLocalWechatUser,
  explicitCnReferrerCode,
  grantLocalCnPromotionQualification,
  isLocalCnAttributionPending,
  updateLocalCnMemberProfile,
} from '@/lib/local-cn-users';
import {
  clearPendingReferralAttributionCookie,
  readPendingReferralAttribution,
} from '@/lib/local-cn-referral-attribution';
import {
  confirmWechatQrSession,
  consumeConfirmedWechatQrSession,
  createWechatQrSession,
  getWechatQrSession,
  markWechatQrSessionScanned,
} from '@/lib/wechat-qr-session';
import { wechatWebConfigured } from '@/lib/wechat-web-auth';

export const dynamic = 'force-dynamic';

const WX_QUICK_COOKIE = 'rs_wx_identity';

function clearResidualWechatCookie(response: NextResponse) {
  response.cookies.set(WX_QUICK_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.ALLOW_HTTP_SESSION_COOKIE !== 'true',
    path: '/',
    maxAge: 0,
  });
}

function appOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (forwardedHost) return `${forwardedProto || 'http'}://${forwardedHost}`;
  return request.nextUrl.origin;
}

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

export async function GET(request: NextRequest) {
  const sid = String(request.nextUrl.searchParams.get('sid') || '').trim();
  if (!sid) {
    return NextResponse.json({ error: '缺少扫码会话 ID' }, { status: 400 });
  }
  const current = getWechatQrSession(sid);
  if (!current || current.status === 'expired' || current.status === 'consumed') {
    return NextResponse.json({ status: 'expired', consumed: current?.status === 'consumed' });
  }
  if (current.status !== 'confirmed' || !current.memberId) {
    return NextResponse.json({
      status: current.status,
      nickname: current.nickname || null,
      expiresAt: current.expiresAt,
    });
  }

  const session = consumeConfirmedWechatQrSession(sid);
  if (!session || !session.memberId) {
    return NextResponse.json({ status: 'expired' });
  }

  const user = findLocalCnUserById(session.memberId);
  if (!user) {
    return NextResponse.json({ status: 'expired' });
  }

  const sessionUser = toSessionUser(user);
  const token = createSessionToken(sessionUser);
  const response = NextResponse.json({
    status: 'confirmed',
    user: sessionUser,
    token,
    redirectTo: session.returnTo || '/cn/member',
  });
  setSessionCookie(response, sessionUser);
  clearResidualWechatCookie(response);
  clearPendingReferralAttributionCookie(response, request.nextUrl.protocol === 'https:');
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'create').trim();

    if (action === 'create') {
      const bodyRef = String(body.referrerCode || '').trim().toUpperCase();
      const pendingReferral = readPendingReferralAttribution(request, bodyRef || null);
      const pendingReferrerUser = pendingReferral ? findLocalCnUserById(pendingReferral.referrerMemberId) : null;
      const rawRef = String(bodyRef || pendingReferrerUser?.referralCode || '').trim().toUpperCase();
      const returnTo = String(body.returnTo || '/cn/member').trim() || '/cn/member';
      const session = createWechatQrSession({ referrerCode: rawRef, returnTo });
      const origin = appOrigin(request);
      const scanUrl = `${origin}/cn/wechat-scan?sid=${encodeURIComponent(session.sid)}${session.referrerCode ? `&ref=${encodeURIComponent(session.referrerCode)}` : ''}`;
      const response = NextResponse.json({
        sid: session.sid,
        scanUrl,
        status: session.status,
        expiresAt: session.expiresAt,
      });
      clearResidualWechatCookie(response);
      return response;
    }

    if (action === 'scan') {
      const sid = String(body.sid || '').trim();
      const nicknameHint = String(body.nicknameHint || '').trim();
      const session = sid ? markWechatQrSessionScanned(sid, nicknameHint) : null;
      const refCode = String(session?.referrerCode || body.referrerCode || '').trim().toUpperCase();
      const refUser = refCode ? findLocalCnUserByReferralCode(refCode) : null;
      const response = NextResponse.json({
        session,
        officialConfigured: wechatWebConfigured('official'),
        savedMember: null,
        referrerName: refUser?.name || null,
        referrerCode: refUser?.referralCode || refCode || null,
      });
      clearResidualWechatCookie(response);
      return response;
    }

    if (action === 'confirm') {
      const sid = String(body.sid || '').trim();
      const session = sid ? getWechatQrSession(sid) : null;
      if (sid && (!session || session.status === 'expired')) {
        return NextResponse.json({ error: '二维码已过期，请刷新电脑端二维码后重新扫描' }, { status: 400 });
      }

      // 扫码登录只接受微信公众号真实 OAuth（/api/auth/wechat/official/callback 确认会话）；不再以随机 openid 建会员
      if (process.env.NODE_ENV === 'production' && process.env.CN_QUICK_LOGIN_TEST !== 'true') {
        return NextResponse.json({ error: '请使用微信扫一扫扫码，并在微信内完成授权', requiresWechatOAuth: true }, { status: 403 });
      }

      const rawNickname = String(body.nickname || '').trim().slice(0, 60);
      const rawToken = randomBytes(12).toString('hex');
      const digest = createHash('sha256').update(`caomi-wx-quick:${rawToken}`).digest('hex').slice(0, 24);
      const openId = `wx_quick_${digest}`;
      const unionId = `wx_union_${digest}`;

      const bodyReferrerCode = String(session?.referrerCode || body.referrerCode || '').trim().toUpperCase();
      const bodyReferrerUser = bodyReferrerCode ? findLocalCnUserByReferralCode(bodyReferrerCode) : null;
      const pendingReferral = readPendingReferralAttribution(request, bodyReferrerCode || null);
      const pendingReferrerUser = pendingReferral ? findLocalCnUserById(pendingReferral.referrerMemberId) : null;
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
      if (rawNickname && user.name !== rawNickname) {
        user = updateLocalCnMemberProfile(user.id, { name: rawNickname });
      } else if (user.name.startsWith('微信会员_') && displayName.startsWith('微信用户_')) {
        user = updateLocalCnMemberProfile(user.id, { name: displayName });
      }

      if (resolvedReferrerUser && user.id !== resolvedReferrerUser.id) {
        bindImmutableLocalCnReferral({
          memberId: user.id,
          referrerMemberId: resolvedReferrerUser.id,
          source: 'wechat_qr_scan',
          attributionId: pendingReferral?.attributionId || null,
          visitId: pendingReferral?.visitId || null,
        });
      }

      if (!isLocalCnAttributionPending(findLocalCnUserById(user.id) || user)) {
        grantLocalCnPromotionQualification(user.id, {
          actorId: user.id,
          source: 'wechat_qr_scan_auto',
        });
      }

      const freshUser = findLocalCnUserById(user.id) || user;
      if (sid) {
        confirmWechatQrSession(sid, {
          memberId: freshUser.id,
          wxIdentityToken: rawToken,
          nickname: freshUser.name,
        });
      }

      const sessionUser = toSessionUser(freshUser);
      const token = createSessionToken(sessionUser);
      const response = NextResponse.json({
        ok: true,
        user: sessionUser,
        token,
        isNew: result.isNew,
        redirectTo: session?.returnTo || '/cn/member',
      });
      setSessionCookie(response, sessionUser);
      clearResidualWechatCookie(response);
      clearPendingReferralAttributionCookie(response, request.nextUrl.protocol === 'https:');
      return response;
    }

    return NextResponse.json({ error: '不支持的操作类型' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '微信扫码会话处理失败' },
      { status: 400 },
    );
  }
}

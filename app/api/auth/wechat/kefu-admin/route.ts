import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess, kefuAdminOpenids, type SessionUser } from '@/lib/auth';
import { clearOAuthStateCookie, createOAuthState, redirectWithSession, setOAuthStateCookie, verifyOAuthState } from '@/lib/oauth';
import { payOrigin } from '@/lib/wechat-pay-openid';
import { isWechatBrowser } from '@/lib/wechat-web-auth';
import { findLocalCnMemberIdByWechatIdentity } from '@/lib/local-cn-member-identities';
import { findLocalCnUserById } from '@/lib/local-cn-users';
import { confirmWechatQrSession, denyWechatQrSession, getWechatQrSession, markWechatQrSessionScanned } from '@/lib/wechat-qr-session';

export const dynamic = 'force-dynamic';

// 客服通知链接入口：微信内打开 → 服务号 snsapi_base 静默授权 → openid 在 KEFU_NOTIFY_OPENIDS 白名单内
// 且已绑定会员 → 写入既有 session cookie → 进入 /admin/wechat-inbox（定位到该会话）。
// 链接本身不带任何凭证；非微信浏览器、非白名单、授权失败一律回到原管理员登录页（密码登录不变）。

const INBOX = '/admin/wechat-inbox';

function inboxPath(openid: string | null) {
  const o = String(openid || '').trim().slice(0, 128);
  return o ? `${INBOX}?openid=${encodeURIComponent(o)}` : INBOX;
}

// 后台页回跳：仅允许 /cn/ops 及其子路径（站内相对路径）
function opsPath(value: string | null) {
  const v = String(value || '').trim();
  return /^\/cn\/ops(\/[A-Za-z0-9\-_/]*)?$/.test(v) ? v : null;
}

// 电脑端「微信扫码验证管理员」：手机扫码进入 ?sid=…，结果页 /cn/wechat-scan/admin（手机端不写入登录状态）
const SCAN_RESULT = '/cn/wechat-scan/admin';

function scanSid(returnTo: string) {
  const m = /^\/cn\/wechat-scan\/admin\?sid=([a-f0-9]{16,64})$/.exec(returnTo);
  return m ? m[1] : null;
}

function scanResult(r: string) {
  const response = NextResponse.redirect(new URL(`${SCAN_RESULT}?r=${r}`, payOrigin()));
  clearOAuthStateCookie(response);
  return response;
}

function loginRedirect(next: string) {
  const response = NextResponse.redirect(new URL(`/login?mode=admin&next=${encodeURIComponent(next)}`, payOrigin()));
  clearOAuthStateCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const appId = process.env.WECHAT_OFFICIAL_APP_ID || '';
  const appSecret = process.env.WECHAT_OFFICIAL_APP_SECRET || '';
  const code = params.get('code');

  const sid = String(params.get('sid') || '').trim();
  if (!code && sid) {
    const qr = /^[a-f0-9]{16,64}$/.test(sid) ? getWechatQrSession(sid) : null;
    if (!qr || qr.purpose !== 'admin' || !['pending', 'scanned'].includes(qr.status)) return scanResult('expired');
    if (!isWechatBrowser(request.headers.get('user-agent') || '')) return scanResult('wechat');
    if (!appId || !appSecret || process.env.DATABASE_URL || kefuAdminOpenids().length === 0) return scanResult('error');
    markWechatQrSessionScanned(sid);
    const state = createOAuthState('wechat_official', `${SCAN_RESULT}?sid=${sid}`);
    const authorize = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
    authorize.searchParams.set('appid', appId);
    authorize.searchParams.set('redirect_uri', `${payOrigin()}/api/auth/wechat/kefu-admin`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'snsapi_base');
    authorize.searchParams.set('state', state);
    const response = NextResponse.redirect(`${authorize.toString()}#wechat_redirect`);
    setOAuthStateCookie(response, state);
    return response;
  }

  if (!code) {
    const next = opsPath(params.get('next')) || inboxPath(params.get('openid'));
    const current = await getFreshSessionUser(request).catch(() => null);
    if (hasPlatformAdminAccess(current)) return NextResponse.redirect(new URL(next, payOrigin()));
    if (!isWechatBrowser(request.headers.get('user-agent') || '') || !appId || !appSecret || process.env.DATABASE_URL || kefuAdminOpenids().length === 0) {
      return loginRedirect(next);
    }
    const state = createOAuthState('wechat_official', next);
    const authorize = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
    authorize.searchParams.set('appid', appId);
    authorize.searchParams.set('redirect_uri', `${payOrigin()}/api/auth/wechat/kefu-admin`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'snsapi_base');
    authorize.searchParams.set('state', state);
    const response = NextResponse.redirect(`${authorize.toString()}#wechat_redirect`);
    setOAuthStateCookie(response, state);
    return response;
  }

  let next = INBOX;
  let qrSid: string | null = null;
  try {
    const payload = verifyOAuthState(request, 'wechat_official', params.get('state'));
    qrSid = scanSid(payload.returnTo);
    if (payload.returnTo === INBOX || payload.returnTo.startsWith(`${INBOX}?`) || opsPath(payload.returnTo)) next = payload.returnTo;
    const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    tokenUrl.searchParams.set('appid', appId);
    tokenUrl.searchParams.set('secret', appSecret);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    const res = await fetch(tokenUrl, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const openid = String(data?.openid || '');
    if (!res.ok || data?.errcode || !openid) throw new Error('wechat oauth failed');
    const allowlisted = kefuAdminOpenids().includes(openid);
    const memberId = allowlisted ? findLocalCnMemberIdByWechatIdentity(appId, openid, data?.unionid || null) : null;
    const member = memberId ? findLocalCnUserById(memberId) : null;
    if (qrSid) {
      if (!member || member.wechatOfficialOpenId !== openid) {
        denyWechatQrSession(qrSid);
        return scanResult('denied');
      }
      return scanResult(confirmWechatQrSession(qrSid, { memberId: member.id, nickname: member.name, adminOpenid: openid }) ? 'ok' : 'expired');
    }
    if (!allowlisted) throw new Error('openid not allowlisted');
    if (!member || member.wechatOfficialOpenId !== openid) throw new Error('member not bound');
    const user: SessionUser = {
      id: member.id,
      name: member.name,
      email: member.email,
      agentLevel: member.agentLevel,
      role: member.role,
      region: 'CN',
      referralCode: member.referralSharingEnabled === false ? undefined : member.referralCode,
      platformAdmin: member.platformAdmin === true,
      referralSharingEnabled: member.referralSharingEnabled !== false,
      emailCredentialVersion: member.emailRegistrationId ? (member.emailCredentialVersion || 1) : undefined,
      kefuAdminOpenid: openid,
    };
    return redirectWithSession(new URL(next, payOrigin()).toString(), user);
  } catch {
    if (qrSid) return scanResult('error');
    return loginRedirect(next);
  }
}

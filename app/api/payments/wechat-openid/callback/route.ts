import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { clearPayStateCookie, payOrigin, setPayOpenIdCookie, verifyPayState } from '@/lib/wechat-pay-openid';

export const dynamic = 'force-dynamic';

function withParam(next: string, key: string, value: string) {
  return `${next}${next.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

export async function GET(request: NextRequest) {
  let next = '/cn/orders';
  try {
    // 微信回传的 state 必须与发起时写入的 httpOnly cookie 一致且签名有效
    const state = verifyPayState(request, request.nextUrl.searchParams.get('state'));
    next = state.next;
    const user = getRequestSession(request);
    if (!user || user.id !== state.userId) throw new Error('登录状态已变化，请重新登录后付款');
    const code = request.nextUrl.searchParams.get('code');
    if (!code) throw new Error('微信未返回授权 code');
    const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
    tokenUrl.searchParams.set('appid', process.env.WECHAT_OFFICIAL_APP_ID || '');
    tokenUrl.searchParams.set('secret', process.env.WECHAT_OFFICIAL_APP_SECRET || '');
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    const res = await fetch(tokenUrl, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.errcode || !data.openid) throw new Error(data.errmsg || '微信授权失败');
    const response = NextResponse.redirect(new URL(withParam(next, 'autopay', '1'), payOrigin()));
    setPayOpenIdCookie(response, user.id, String(data.openid));
    clearPayStateCookie(response);
    return response;
  } catch (error) {
    const response = NextResponse.redirect(new URL(withParam(next, 'payError', error instanceof Error ? error.message : '微信授权失败'), payOrigin()));
    clearPayStateCookie(response);
    return response;
  }
}

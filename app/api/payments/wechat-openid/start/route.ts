import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { createPayState, payOrigin, sanitizeNext, setPayStateCookie } from '@/lib/wechat-pay-openid';

export const dynamic = 'force-dynamic';

/** 微信内置浏览器付款前，静默 (snsapi_base) 取得公众号 openid，完成后回到原订单页。 */
export async function GET(request: NextRequest) {
  const next = sanitizeNext(request.nextUrl.searchParams.get('next'));
  const user = getRequestSession(request);
  if (!user) return NextResponse.redirect(new URL(`/cn/login?next=${encodeURIComponent(next)}`, payOrigin()));
  const appId = process.env.WECHAT_OFFICIAL_APP_ID || '';
  if (!appId) return NextResponse.redirect(new URL(`${next}${next.includes('?') ? '&' : '?'}payError=official_not_configured`, payOrigin()));
  const state = createPayState(user.id, next);
  const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  url.searchParams.set('appid', appId);
  url.searchParams.set('redirect_uri', `${payOrigin()}/api/payments/wechat-openid/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'snsapi_base');
  url.searchParams.set('state', 'pay');
  const response = NextResponse.redirect(`${url.toString()}#wechat_redirect`);
  setPayStateCookie(response, state);
  return response;
}

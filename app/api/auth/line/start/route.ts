import { appOrigin, createOAuthState, setOAuthStateCookie } from '@/lib/oauth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const channelId = process.env.LINE_CHANNEL_ID;
  if (!channelId) {
    return NextResponse.json({ error: 'LINE Login 尚未设定 Channel ID' }, { status: 503 });
  }

  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/portal/profile';
  const referralCode = request.nextUrl.searchParams.get('ref');
  const redirectUri =
    process.env.LINE_LOGIN_CALLBACK_URL || `${appOrigin(request)}/api/auth/line/callback`;
  const state = createOAuthState('line', returnTo, referralCode);
  const authUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', channelId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'profile openid');

  const response = NextResponse.redirect(authUrl);
  setOAuthStateCookie(response, state);
  return response;
}

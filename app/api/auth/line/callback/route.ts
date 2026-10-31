import {
  appOrigin,
  linkOrCreateUserFromExternalProfile,
  redirectWithSession,
  verifyOAuthState,
} from '@/lib/oauth';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const error = request.nextUrl.searchParams.get('error');
    if (error) throw new Error(request.nextUrl.searchParams.get('error_description') || error);

    const code = request.nextUrl.searchParams.get('code');
    if (!code) throw new Error('LINE 未回传授权 code');

    const channelId = process.env.LINE_CHANNEL_ID;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (!channelId || !channelSecret) throw new Error('LINE Login 尚未完整设定');

    const state = verifyOAuthState(request, 'line', request.nextUrl.searchParams.get('state'));
    const redirectUri =
      process.env.LINE_LOGIN_CALLBACK_URL || `${appOrigin(request)}/api/auth/line/callback`;
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    });

    const token = await tokenRes.json();
    if (!tokenRes.ok || !token.access_token) {
      throw new Error(token.error_description || token.error || 'LINE token 交换失败');
    }

    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const profile = await profileRes.json();
    if (!profileRes.ok || !profile.userId) throw new Error('LINE 会员资料读取失败');

    const user = await linkOrCreateUserFromExternalProfile(request, {
      provider: 'line',
      providerUserId: profile.userId,
      displayName: profile.displayName,
      avatarUrl: profile.pictureUrl,
      metadata: {
        statusMessage: profile.statusMessage,
        linkedAt: new Date().toISOString(),
      },
    }, state.referralCode);

    return redirectWithSession(new URL(state.returnTo, appOrigin(request)).toString(), user);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LINE 授权失败';
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, appOrigin(request))
    );
  }
}

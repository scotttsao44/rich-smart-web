import { clearSessionCookie } from '@/lib/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  const secure = process.env.NODE_ENV === 'production' && process.env.ALLOW_HTTP_SESSION_COOKIE !== 'true';
  response.cookies.set('rs_wx_identity', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  });
  response.cookies.set('rs_email_browser', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/auth/email',
    maxAge: 0,
  });
  return response;
}

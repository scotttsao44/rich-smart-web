import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  REFERRAL_SESSION_COOKIE,
  ensureLocalCnReferralLink,
  readPendingReferralAttribution,
  recordLocalCnReferralLanding,
  setPendingReferralAttributionCookie,
} from '@/lib/local-cn-referral-attribution';
import { ensureLocalCnScootAdminAccount, findLocalCnUserById, findLocalCnUserByReferralCode } from '@/lib/local-cn-users';

export const dynamic = 'force-dynamic';

function appOrigin(request: NextRequest) {
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host) return `${proto}://${host}`;
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^/]+$/i.test(configured)) return configured;
  return request.nextUrl.origin;
}

function safeNextPath(raw?: string | null) {
  const value = String(raw || '').trim();
  if (value.startsWith('/cn') || value.startsWith('/vendor')) return value;
  return '/cn/login?referral=ready';
}

export async function GET(request: NextRequest) {
  const rawToken = String(request.nextUrl.searchParams.get('t') || '').trim();
  const refCode = String(request.nextUrl.searchParams.get('ref') || request.nextUrl.searchParams.get('r') || '').trim();
  let token = rawToken;
  if (!token) {
    const owner = (refCode ? findLocalCnUserByReferralCode(refCode) : null) || ensureLocalCnScootAdminAccount();
    const ensured = ensureLocalCnReferralLink(owner.id);
    if (ensured) token = ensured.token;
  }
  const existingSession = request.cookies.get(REFERRAL_SESSION_COOKIE)?.value || randomUUID();
  const hasExplicitLink = Boolean(rawToken || refCode);
  const existingCookieOnly = !hasExplicitLink && request.cookies.get('rs_ref_attr')?.value
    ? readPendingReferralAttribution(request)
    : null;
  let result = recordLocalCnReferralLanding({
    token,
    existingPending: existingCookieOnly,
    sessionId: existingSession,
    sourcePath: `${request.nextUrl.pathname}${request.nextUrl.search}`,
    userAgent: request.headers.get('user-agent'),
  });
  if (!result.ok) {
    const fallbackOwner = ensureLocalCnScootAdminAccount();
    const ensured = ensureLocalCnReferralLink(fallbackOwner.id);
    if (ensured) {
      result = recordLocalCnReferralLanding({
        token: ensured.token,
        existingPending: null,
        sessionId: existingSession,
        sourcePath: `${request.nextUrl.pathname}${request.nextUrl.search}`,
        userAgent: request.headers.get('user-agent'),
      });
    }
  }
  if (!result.ok) {
    return NextResponse.redirect(new URL('/cn/login?referral=invalid', appOrigin(request)), 302);
  }
  const nextPath = safeNextPath(request.nextUrl.searchParams.get('next') || request.nextUrl.searchParams.get('to'));
  const targetUrl = new URL(nextPath, appOrigin(request));
  const referrerUser = findLocalCnUserById(result.pending.referrerMemberId);
  if (referrerUser?.referralCode && !targetUrl.searchParams.get('ref')) {
    targetUrl.searchParams.set('ref', referrerUser.referralCode);
  }
  const response = NextResponse.redirect(targetUrl, 302);
  const secure = appOrigin(request).startsWith('https://');
  response.cookies.set(REFERRAL_SESSION_COOKIE, result.sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
  setPendingReferralAttributionCookie(response, result.pending, secure);
  return response;
}

import { NextRequest, NextResponse } from 'next/server';
import { recordReferralVisit } from '@/lib/local-cn-referral-engagement';
import {
  resolveReferralAttributionFromCode,
  setPendingReferralAttributionCookie,
} from '@/lib/local-cn-referral-attribution';

export const dynamic = 'force-dynamic';

function publicOrigin(request: NextRequest) {
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (host) return `${proto}://${host}`;
  return (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, '');
}

function safeTargetPath(rawTarget: string | null) {
  const value = String(rawTarget || '/cn/shop').trim();
  if (!value.startsWith('/cn') || value.startsWith('//')) {
    return '/cn/shop';
  }
  return value;
}

export async function GET(request: NextRequest) {
  const referralCode = String(request.nextUrl.searchParams.get('ref') || request.nextUrl.searchParams.get('code') || request.nextUrl.searchParams.get('r') || '').trim().toUpperCase();
  const target = safeTargetPath(request.nextUrl.searchParams.get('target') || request.nextUrl.searchParams.get('to') || request.nextUrl.searchParams.get('next'));
  const targetUrl = new URL(target, publicOrigin(request));

  if (referralCode) {
    targetUrl.searchParams.set('ref', referralCode);
  }

  const forwardedFor = request.headers.get('x-forwarded-for') || '';
  const ipAddress = forwardedFor.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  const userAgent = request.headers.get('user-agent') || null;
  const pending = referralCode ? resolveReferralAttributionFromCode(referralCode, targetUrl.pathname) : null;

  try {
    if (referralCode) {
      recordReferralVisit({
        referralCode,
        sourcePath: `${targetUrl.pathname}${targetUrl.search}`,
        ipHint: ipAddress,
        userAgent,
      });
    }
  } catch (error) {
    console.warn('[Referral Visit] record failed:', error);
  }

  const response = NextResponse.redirect(targetUrl);
  if (pending) {
    const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '');
    setPendingReferralAttributionCookie(response, pending, proto === 'https');
  }
  return response;
}

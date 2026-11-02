import { NextRequest, NextResponse } from 'next/server';
import {
  readPendingReferralAttribution,
  referralDisplayName,
  setPendingReferralAttributionCookie,
} from '@/lib/local-cn-referral-attribution';
import { CAOMI_OFFICIAL_REFERRAL_CODE, findLocalCnUserById } from '@/lib/local-cn-users';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pending = readPendingReferralAttribution(request);
  if (!pending) return NextResponse.json({ pending: false, hasPending: false, attribution: null });
  const referrer = findLocalCnUserById(pending.referrerMemberId);
  const referrerName = referralDisplayName(pending.referrerMemberId);
  const referrerCode = referrer?.referralCode || '';
  const response = NextResponse.json({
    pending: true,
    hasPending: true,
    referrerName,
    referrerCode,
    referredByCode: referrerCode,
    officialReferralCode: CAOMI_OFFICIAL_REFERRAL_CODE,
    defaultReferralCode: '',
    referrerMemberId: pending.referrerMemberId,
    attributionId: pending.attributionId,
    visitId: pending.visitId,
    attribution: {
      attributionId: pending.attributionId,
      visitId: pending.visitId,
      referrerMemberId: pending.referrerMemberId,
      referrerName,
      referrerCode,
      createdAt: pending.createdAt,
    },
  });
  const secure = request.nextUrl.protocol === 'https:';
  setPendingReferralAttributionCookie(response, pending, secure);
  return response;
}

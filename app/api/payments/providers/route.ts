import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { isBrandPilotPaymentContext, paymentCapabilities } from '@/lib/cn-payments';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  const forceDisabled = await isBrandPilotPaymentContext({ user })
    || /^brand-(pilot|demo)-.+@/i.test(String(user?.email || ''))
    || /^RS-CN-(PILOT|DEMO)-/i.test(String(user?.referralCode || ''));
  return NextResponse.json({ providers: Object.values(paymentCapabilities({ forceDisabled })) });
}

import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getCnPaymentSettings, updateCnPaymentSettings } from '@/lib/cn-payment-settings';

export const dynamic = 'force-dynamic';

function sessionUser(request: NextRequest) {
  const user = getRequestSession(request);
  return user;
}

function platformAdmin(request: NextRequest) {
  const user = sessionUser(request);
  return hasPlatformAdminAccess(user) ? user : null;
}

export async function GET(request: NextRequest) {
  if (!sessionUser(request)) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  return NextResponse.json({ settings: getCnPaymentSettings() });
}

export async function PATCH(request: NextRequest) {
  const user = platformAdmin(request);
  if (!user) return NextResponse.json({ error: '仅平台可修改支付费率' }, { status: 403 });
  try {
    const body = await request.json();
    const settings = updateCnPaymentSettings({
      platformFeeRate: body.platformFeeRate,
      paymentChannelFeeRate: body.paymentChannelFeeRate,
      riskReserveRate: body.riskReserveRate,
      updatedBy: user.id,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '支付费率保存失败' }, { status: 400 });
  }
}

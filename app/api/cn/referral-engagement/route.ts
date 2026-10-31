import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { getReferralEngagement, sendReferralReminders, type ReferralRange, type ReferralTemplate } from '@/lib/local-cn-referral-engagement';

export const dynamic = 'force-dynamic';

function range(value: string | null): ReferralRange {
  return value === '7d' || value === '90d' || value === 'month' ? value : '30d';
}

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user || user.role !== 'member') return NextResponse.json({ error: '请先登录会员账号' }, { status: user ? 403 : 401 });
  return NextResponse.json(getReferralEngagement(user, range(request.nextUrl.searchParams.get('range'))));
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user || user.role !== 'member') return NextResponse.json({ error: '请先登录会员账号' }, { status: user ? 403 : 401 });
  try {
    const body = await request.json();
    const template = String(body.template || '') as ReferralTemplate;
    const recipientIds = Array.isArray(body.recipientIds) ? body.recipientIds : [];
    return NextResponse.json(sendReferralReminders(user, { template, recipientIds }), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '提醒发送失败' }, { status: 400 });
  }
}

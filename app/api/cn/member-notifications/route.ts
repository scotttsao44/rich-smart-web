import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { listReferralNotifications, markReferralNotificationRead } from '@/lib/local-cn-referral-engagement';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user || user.role !== 'member') return NextResponse.json({ error: '请先登录会员账号' }, { status: user ? 403 : 401 });
  return NextResponse.json({ notifications: listReferralNotifications(user) });
}

export async function PATCH(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user || user.role !== 'member') return NextResponse.json({ error: '请先登录会员账号' }, { status: user ? 403 : 401 });
  const body = await request.json();
  const updated = markReferralNotificationRead(user, String(body.id || ''));
  return updated ? NextResponse.json({ notification: updated }) : NextResponse.json({ error: '找不到通知' }, { status: 404 });
}

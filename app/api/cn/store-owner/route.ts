import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { getOwnerStatus, setOwnerOptIn } from '@/lib/local-cn-store-owners';

export const dynamic = 'force-dynamic';

// 会员中心「我是店主／体验点负责人，接收预约与线索通知」
export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user || user.role !== 'member') return NextResponse.json({ error: '请先登录会员账号' }, { status: user ? 403 : 401 });
  return NextResponse.json(getOwnerStatus(user.id), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user || user.role !== 'member') return NextResponse.json({ error: '请先登录会员账号' }, { status: user ? 403 : 401 });
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(setOwnerOptIn(user.id, body.enabled === true));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '设置失败' }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { getWalletEntryDetail } from '@/lib/local-cn-commerce';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const detail = getWalletEntryDetail(user.id, params.id);
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: '找不到该笔收益记录' }, { status: 404 });
}

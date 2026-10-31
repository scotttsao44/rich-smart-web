import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { createStoreApplication, listStoreApplications, memberDirectory, updateStoreApplication } from '@/lib/local-cn-store-applications';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  return NextResponse.json({ applications: listStoreApplications(user), directory: memberDirectory(user) });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user || user.role !== 'member') return NextResponse.json({ error: '仅会员可申请门店' }, { status: user ? 403 : 401 });
  try {
    const created = createStoreApplication(user, await request.json());
    return NextResponse.json({ created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '申请失败' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const body = await request.json();
    const updated = updateStoreApplication(user, String(body.id || ''), String(body.action || ''), body);
    return updated ? NextResponse.json({ updated }) : NextResponse.json({ error: '找不到申请' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400 });
  }
}

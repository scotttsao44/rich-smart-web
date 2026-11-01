import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import {
  getMyEntityChangeOverview,
  listEntityChangesForAdmin,
  reviewEntityChange,
  submitEntityChange,
} from '@/lib/local-cn-brand-claim';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    if (request.nextUrl.searchParams.get('scope') === 'admin') {
      if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台管理员可查看' }, { status: 403 });
      return NextResponse.json({ requests: listEntityChangesForAdmin(user) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json(getMyEntityChangeOverview(user), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取失败' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json({ request: submitEntityChange(user, body) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '提交失败' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台管理员可审核' }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json({ request: reviewEntityChange(user, String(body.id || ''), body.decision, body.reviewNote) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '审核失败' }, { status: 400 });
  }
}

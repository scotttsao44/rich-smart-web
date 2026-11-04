import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { lastPushRuns } from '@/lib/cn-push-schedule';
import { listPushPeople, setExperiencePointOwners } from '@/lib/local-cn-store-owners';

export const dynamic = 'force-dynamic';

// 后台「需要推送的人」：店主／体验点负责人、绑定状态、最近通知与送达结果、48 小时窗口
export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401 });
  return NextResponse.json({ ...listPushPeople(), runs: lastPushRuns(5) }, { headers: { 'Cache-Control': 'no-store' } });
}

// 设置体验点负责人：{ pointId, ownerMemberIds: number[] }
export async function POST(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const ids = Array.isArray(body.ownerMemberIds) ? body.ownerMemberIds.map(Number) : [];
    const point = setExperiencePointOwners(String(body.pointId || ''), ids);
    return NextResponse.json({ point, ...listPushPeople() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '设置失败' }, { status: 400 });
  }
}

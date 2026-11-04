import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { lastPushRuns } from '@/lib/cn-push-schedule';
import { listPushPeople, setExperiencePointOwners } from '@/lib/local-cn-store-owners';
import { listLocalCnUsers } from '@/lib/local-cn-users';
import { listKefuConversations } from '@/lib/local-cn-wechat-kefu';

// 服务号回复数字自报身份（会员记录优先；未绑定会员的关注者取会话记录）。自报，店主／代理需管理员确认
function selfDeclared() {
  const users = listLocalCnUsers();
  const rows = users.filter((u) => u.selfIdentity).map((u) => ({ memberId: u.id, name: u.name, ...u.selfIdentity! }));
  for (const c of listKefuConversations() as Array<{ openid: string; memberId?: number | null; memberName?: string | null; identity?: { type: string; label: string; detail: string; at: string; confirmed: boolean } }>) {
    if (!c.identity) continue;
    const u = users.find((x) => x.wechatOfficialOpenId === c.openid);
    if (u?.selfIdentity) continue;
    rows.push({ memberId: u?.id || 0, name: u?.name || c.memberName || `关注者…${c.openid.slice(-4)}`, source: 'service_account_menu', ...c.identity });
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200);
}

export const dynamic = 'force-dynamic';

// 后台「需要推送的人」：店主／体验点负责人、绑定状态、最近通知与送达结果、48 小时窗口
export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401 });
  return NextResponse.json({ ...listPushPeople(), runs: lastPushRuns(5), selfDeclared: selfDeclared() }, { headers: { 'Cache-Control': 'no-store' } });
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

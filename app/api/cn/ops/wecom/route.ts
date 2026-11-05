import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { listPushPeople } from '@/lib/local-cn-store-owners';
import { listMemberTiersForPush } from '@/lib/local-cn-referral-engagement';
import { ensureDefaultContactWay, ensureMemberInviteQr, inviteMembersToWecom, syncWecomCustomers, wecomOverview } from '@/lib/local-cn-wecom';

export const dynamic = 'force-dynamic';

function people() {
  const rows = new Map<number, { memberId: number; name: string; role: string }>();
  for (const o of listPushPeople().owners) rows.set(o.memberId, { memberId: o.memberId, name: o.name, role: '店主' });
  for (const r of listMemberTiersForPush()) if (!rows.has(r.member.id)) rows.set(r.member.id, { memberId: r.member.id, name: r.member.name, role: r.tierLabel });
  return Array.from(rows.values());
}

// 后台「企业微信客户联系」：GET 概览；POST { action: 'invite', memberIds } | { action: 'sync' } | { action: 'default-qr' } | { action: 'member-qr', memberId }（只生成会员专属企微邀请码，不发送）
export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401 });
  return NextResponse.json(wecomOverview(people()), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === 'invite') {
      const ids = Array.isArray(body.memberIds) ? body.memberIds.map(Number) : [];
      if (!ids.length) return NextResponse.json({ error: '请先勾选会员' }, { status: 400 });
      const result = await inviteMembersToWecom(ids, user?.id);
      return NextResponse.json({ ...result, overview: wecomOverview(people()) });
    }
    if (body.action === 'sync') {
      const r = await syncWecomCustomers();
      return NextResponse.json({ sync: r, overview: wecomOverview(people()) });
    }
    if (body.action === 'default-qr') {
      await ensureDefaultContactWay();
      return NextResponse.json({ overview: wecomOverview(people()) });
    }
    if (body.action === 'member-qr') {
      const way = await ensureMemberInviteQr(Number(body.memberId));
      return NextResponse.json({ memberId: Number(body.memberId), qrCode: way.qrCode, overview: wecomOverview(people()) });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400 });
  }
}

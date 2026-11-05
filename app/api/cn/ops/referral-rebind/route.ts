import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { listLocalCnReferralRebindAudits, rebindLocalCnMemberReferral } from '@/lib/local-cn-users';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

function memberView(member: {
  id: number;
  name: string;
  referralCode: string;
  referrerCode: string | null;
  referredByMemberId?: number | null;
  referralSource?: string | null;
}, referrerName: string | null) {
  return {
    id: member.id,
    name: member.name,
    referralCode: member.referralCode,
    referrerCode: member.referrerCode,
    referredByMemberId: member.referredByMemberId || null,
    referralSource: member.referralSource || null,
    referrerName,
  };
}

export async function GET(request: NextRequest) {
  const actor = await getFreshSessionUser(request);
  if (!actor) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  if (!hasPlatformAdminAccess(actor)) return NextResponse.json({ error: '仅平台管理员可查看改绑记录' }, { status: 403, headers: noStore });
  const memberId = Number(request.nextUrl.searchParams.get('memberId') || 0);
  const rows = listLocalCnReferralRebindAudits(memberId > 0 ? memberId : null);
  return NextResponse.json({ audits: rows.slice(0, 50) }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const actor = await getFreshSessionUser(request);
  if (!actor) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  if (!hasPlatformAdminAccess(actor)) return NextResponse.json({ error: '仅平台管理员可改绑推荐人' }, { status: 403, headers: noStore });
  try {
    const body = await request.json().catch(() => ({}));
    const result = rebindLocalCnMemberReferral({
      memberId: Number(body.memberId),
      actorId: actor.id,
      actorName: actor.name,
      reason: String(body.reason || ''),
      officialDirect: body.officialDirect === true,
      referrerCode: body.referrerCode,
      referrerMemberId: body.referrerMemberId,
    });
    return NextResponse.json({
      ok: true,
      message: result.audit.officialDirect
        ? '已设为官方直属。已产生的收益与结算不回溯，之后的新订单按新推荐人计算。'
        : '已改绑推荐人。已产生的收益与结算不回溯，之后的新订单按新推荐人计算。',
      member: memberView(result.member, result.audit.officialDirect ? null : result.audit.toReferrerName),
      audit: result.audit,
    }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '改绑失败' }, { status: 400, headers: noStore });
  }
}

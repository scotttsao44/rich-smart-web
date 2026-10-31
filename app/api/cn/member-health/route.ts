import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { addMemberHealthRecord, deleteMemberHealthRecord } from '@/lib/local-cn-member-workspace';
import { findLocalCnUser, findLocalCnUserById } from '@/lib/local-cn-users';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const actor = getRequestSession(request);
  if (!actor) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!['member', 'store', 'admin'].includes(actor.role)) return NextResponse.json({ error: '无权上传会员健康资料' }, { status: 403 });

  const body = await request.json();
  let target = actor;
  if (actor.role !== 'member') {
    const requestedId = Number(body.memberId || 0);
    const user = requestedId ? findLocalCnUserById(requestedId) : findLocalCnUser(String(body.memberName || ''));
    if (!user) return NextResponse.json({ error: '找不到会员，请先建立会员账号' }, { status: 404 });
    target = { id: user.id, name: user.name, email: user.email, agentLevel: user.agentLevel, role: user.role, region: 'CN', referralCode: user.referralCode };
  }

  try {
    const record = addMemberHealthRecord(target, {
      label: body.label,
      value: body.value,
      advice: body.summary,
      category: body.category,
      fileName: body.fileName,
      source: body.source || actor.name,
      dValue: body.dValue,
      consentGranted: body.consentGranted === true,
      hasPacemaker: body.hasPacemaker === true,
      isPregnant: body.isPregnant === true,
      isUnderFive: body.isUnderFive === true,
    });
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '健康资料保存失败' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const actor = getRequestSession(request);
  if (!actor || actor.role !== 'member') return NextResponse.json({ error: '仅会员本人可删除健康资料' }, { status: actor ? 403 : 401 });
  const id = request.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ error: '缺少健康记录编号' }, { status: 400 });
  return deleteMemberHealthRecord(actor, id)
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: '找不到健康记录' }, { status: 404 });
}

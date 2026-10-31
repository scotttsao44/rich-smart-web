import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getOwnedBrandForUser } from '@/lib/local-cn-brand-marketplace';
import { listStoreApplications } from '@/lib/local-cn-store-applications';
import { acceptOrganizationInvite, createOrganizationInvite, getOrganizationInvite, getOrganizationRole, listOrganizationAccess, type OrganizationRole, type OrganizationType } from '@/lib/local-cn-organization-members';

export const dynamic = 'force-dynamic';

function canManage(user: NonNullable<ReturnType<typeof getRequestSession>>, type: OrganizationType, id: string) {
  if (hasPlatformAdminAccess(user)) return true;
  if (type === 'brand' && String(getOwnedBrandForUser(user.id)?.id) === id) return true;
  if (type === 'store' && listStoreApplications(user).some((item) => item.id === id && item.applicantId === user.id)) return true;
  return ['owner', 'admin'].includes(getOrganizationRole(type, id, user.id) || '');
}

export async function GET(request: NextRequest) {
  const user = getRequestSession(request); if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const token = String(request.nextUrl.searchParams.get('token') || '');
  if (token) { const invite = getOrganizationInvite(token); return invite ? NextResponse.json({ invite }) : NextResponse.json({ error: '邀请不存在' }, { status: 404 }); }
  const type = String(request.nextUrl.searchParams.get('type') || '') as OrganizationType; const id = String(request.nextUrl.searchParams.get('id') || '');
  if (!['brand', 'store'].includes(type) || !id || !canManage(user, type, id)) return NextResponse.json({ error: '无权查看成员' }, { status: 403 });
  return NextResponse.json(listOrganizationAccess(type, id));
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request); if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try { const body = await request.json(); const type = String(body.organizationType || '') as OrganizationType; const id = String(body.organizationId || ''); if (!['brand', 'store'].includes(type) || !id || !canManage(user, type, id)) return NextResponse.json({ error: '无权邀请成员' }, { status: 403 }); const invite = createOrganizationInvite(user, { organizationType: type, organizationId: id, organizationName: String(body.organizationName || ''), role: String(body.role || 'viewer') as OrganizationRole }); return NextResponse.json({ invite }, { status: 201 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '邀请建立失败' }, { status: 400 }); }
}

export async function PATCH(request: NextRequest) {
  const user = getRequestSession(request); if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try { const body = await request.json(); return NextResponse.json(acceptOrganizationInvite(user, String(body.token || ''))); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : '无法接受邀请' }, { status: 400 }); }
}

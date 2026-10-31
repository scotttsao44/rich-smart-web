import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { createPartnerInvitation, isPartnerInvitationLoginEnabled, listPartnerInvitations } from '@/lib/local-cn-partner-invitations';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isPartnerInvitationLoginEnabled()) {
    return NextResponse.json({ error: '此功能尚未开放' }, { status: 404 });
  }
  const user = getRequestSession(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台管理员可查看邀请' }, { status: 403 });
  return NextResponse.json({ invitations: listPartnerInvitations() });
}

export async function POST(request: NextRequest) {
  if (!isPartnerInvitationLoginEnabled()) {
    return NextResponse.json({ error: '此功能尚未开放' }, { status: 404 });
  }
  const user = getRequestSession(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台管理员可建立邀请' }, { status: 403 });
  try {
    return NextResponse.json({ invitation: createPartnerInvitation(user!, await request.json()) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '建立邀请失败' }, { status: 400 });
  }
}

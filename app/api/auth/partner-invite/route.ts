import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/auth';
import { consumePartnerInvitation, isPartnerInvitationLoginEnabled } from '@/lib/local-cn-partner-invitations';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isPartnerInvitationLoginEnabled()) {
    return NextResponse.json({ error: '此登入方式尚未开放' }, { status: 404 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const { user, invitation } = consumePartnerInvitation(String(body.token || ''));
    const sessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      agentLevel: user.agentLevel,
      role: user.role,
      region: 'CN',
      referralCode: user.referralCode,
      platformAdmin: user.platformAdmin === true,
    };
    const response = NextResponse.json({ user: sessionUser, invitation: { id: invitation.id, referralCode: invitation.referralCode } });
    setSessionCookie(response, sessionUser);
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '邀请登入失败' }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { ensureLocalCnReferralLink } from '@/lib/local-cn-referral-attribution';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (process.env.DATABASE_URL || user.region !== 'CN') return NextResponse.json({ error: '暂不支持此账号类型' }, { status: 503 });
  const link = ensureLocalCnReferralLink(user.id);
  if (!link) return NextResponse.json({ error: '此账号未开放邀请' }, { status: 403 });
  return NextResponse.json({ referralPath: `${link.path}&to=%2Fcn%2Femail` }, { headers: { 'Cache-Control': 'no-store' } });
}

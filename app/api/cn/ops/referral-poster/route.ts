import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { ensureReferralPoster, POSTER_BLOCKS } from '@/lib/cn-referral-poster';
import { followQrEligibility } from '@/lib/local-cn-follow-qr';
import { findLocalCnUserById } from '@/lib/local-cn-users';

// 后台「代生成推广长图」（仅平台管理方，含 kefu-admin 微信验证）：
//   GET ?memberIds=1,2      → 各会员能否生成＋原因（不生成）
//   POST { memberId }       → 用「该会员」的推荐码生成（或读缓存）长图，不发送任何消息
//   GET ?memberId=1         → 输出 PNG（inline，页内 fetch→blob→objectURL 显示，勿用 attachment）
// 没资格不代开通、不改用别人的码。
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };
const BLOCKS = [...POSTER_BLOCKS];

const REASON: Record<string, string> = {
  member_not_found: '会员不存在',
  not_member: '非会员账号',
  no_referral_code: '没有推荐码',
  attribution_pending: '推荐归属待确认，暂无推荐资格',
  not_applied: '尚未取得推荐资格',
  referral_sharing_disabled: '已关闭推荐分享',
  promotion_disabled: '推荐资格已停用',
};

function eligibility(memberId: number) {
  const user = findLocalCnUserById(memberId);
  if (!user) return { memberId, eligible: false, reason: REASON.member_not_found };
  if (user.role !== 'member') return { memberId, eligible: false, reason: REASON.not_member };
  if (!user.referralCode) return { memberId, eligible: false, reason: REASON.no_referral_code };
  const check = followQrEligibility(memberId);
  if (!check.eligible) return { memberId, eligible: false, reason: REASON[check.reason] || `暂无推荐资格（${check.reason}）` };
  return { memberId, eligible: true, reason: '', referralCode: String(user.referralCode).toUpperCase() };
}

async function admin(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!hasPlatformAdminAccess(user)) return { user: null, denied: NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401, headers: noStore }) };
  return { user, denied: null };
}

export async function GET(request: NextRequest) {
  const { denied } = await admin(request);
  if (denied) return denied;
  const params = request.nextUrl.searchParams;
  const list = params.get('memberIds');
  if (list != null) {
    const ids = Array.from(new Set(list.split(',').map(Number).filter((n) => n > 0))).slice(0, 500);
    return NextResponse.json({ rows: ids.map(eligibility) }, { headers: noStore });
  }
  const memberId = Number(params.get('memberId'));
  const e = eligibility(memberId);
  if (!e.eligible) return NextResponse.json({ error: e.reason }, { status: 403, headers: noStore });
  const r = await ensureReferralPoster(memberId, BLOCKS);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: noStore });
  return new NextResponse(new Uint8Array(r.png), {
    headers: { 'Content-Type': 'image/png', 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function POST(request: NextRequest) {
  const { user, denied } = await admin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const memberId = Number(body?.memberId);
  const e = eligibility(memberId);
  if (!e.eligible) return NextResponse.json({ ok: false, error: e.reason }, { status: 403, headers: noStore });
  const r = await ensureReferralPoster(memberId, BLOCKS);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: noStore });
  console.info('[ops-referral-poster] generated', { memberId, by: user?.id });
  return NextResponse.json({ ok: true, memberId, referralCode: e.referralCode }, { headers: noStore });
}

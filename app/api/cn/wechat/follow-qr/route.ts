import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getRequestSession } from '@/lib/auth';
import { ensureMemberFollowQr, followQrEligibility, getMemberFollowQr } from '@/lib/local-cn-follow-qr';

// 专属关注码：GET 查询资格/已生成状态；GET ?format=png 输出二维码图片；POST 生成（已有则复用）。
// PNG 必须 Content-Disposition:inline（或省略），供页内 <img> 长按存相册；勿用 attachment。
// 不在日志或响应里输出 ticket、access_token。
export const dynamic = 'force-dynamic';

function memberId(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session || !(session.id > 0) || session.role !== 'member') return null;
  return session.id;
}

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const id = memberId(request);
  if (!id) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  const check = followQrEligibility(id);
  const qr = check.eligible ? getMemberFollowQr(id) : null;
  if (request.nextUrl.searchParams.get('format') === 'png') {
    if (!qr) return NextResponse.json({ error: '尚未生成' }, { status: 404, headers: noStore });
    const png = await QRCode.toBuffer(qr.url, { type: 'png', width: 600, margin: 2, errorCorrectionLevel: 'M' });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  return NextResponse.json({ eligible: check.eligible, reason: check.eligible ? '' : check.reason, generated: Boolean(qr), referralCode: qr?.referralCode || '', createdAt: qr?.createdAt || '' }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const id = memberId(request);
  if (!id) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  const r = await ensureMemberFollowQr(id);
  if (!r.ok || !r.qr) {
    const notEligible = !followQrEligibility(id).eligible;
    return NextResponse.json({ ok: false, error: notEligible ? '暂未取得推荐资格' : '生成失败，请稍后再试' }, { status: notEligible ? 403 : 502, headers: noStore });
  }
  return NextResponse.json({ ok: true, generated: true, referralCode: r.qr.referralCode, createdAt: r.qr.createdAt }, { headers: noStore });
}

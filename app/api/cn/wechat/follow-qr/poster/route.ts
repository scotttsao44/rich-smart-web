import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { ensureReferralPoster, parsePosterBlocks } from '@/lib/cn-referral-poster';

// 推广长图：POST {blocks:"abcd"} 生成；GET ?blocks=abcd 输出 PNG（未生成则当场生成）。
// 只输出 image/png + Content-Disposition:inline，供页内 <img> 长按存相册；勿用 attachment（微信会变「接收文件」）。
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const noStore = { 'Cache-Control': 'no-store' };

function memberId(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session || !(session.id > 0) || session.role !== 'member') return null;
  return session.id;
}

export async function GET(request: NextRequest) {
  const id = memberId(request);
  if (!id) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  const r = await ensureReferralPoster(id, parsePosterBlocks(request.nextUrl.searchParams.get('blocks')));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: noStore });
  return new NextResponse(new Uint8Array(r.png), {
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: NextRequest) {
  const id = memberId(request);
  if (!id) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  const body = await request.json().catch(() => ({}));
  const blocks = parsePosterBlocks(typeof body?.blocks === 'string' ? body.blocks : null);
  const r = await ensureReferralPoster(id, blocks);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: noStore });
  return NextResponse.json({ ok: true, blocks: blocks.join('') }, { headers: noStore });
}

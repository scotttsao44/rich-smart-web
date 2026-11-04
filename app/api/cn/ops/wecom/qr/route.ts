import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { fetchQrImage, memberInviteQr, readWecomConfig } from '@/lib/local-cn-wecom';

export const dynamic = 'force-dynamic';

// 下载「联系我」二维码图片：?memberId=123（会员专属邀请码）或不带参数（默认二维码）
export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401 });
  const memberId = Number(request.nextUrl.searchParams.get('memberId') || 0);
  const url = memberId ? memberInviteQr(memberId) : readWecomConfig().default?.qrCode || null;
  if (!url) return NextResponse.json({ error: '二维码尚未生成' }, { status: 404 });
  try {
    const image = await fetchQrImage(url);
    const png = image[0] === 0x89 && image[1] === 0x50;
    const ext = png ? 'png' : 'jpg';
    const name = memberId ? `wecom-invite-${memberId}.${ext}` : `wecom-default-qr.${ext}`;
    return new NextResponse(new Uint8Array(image), { headers: { 'Content-Type': png ? 'image/png' : 'image/jpeg', 'Content-Disposition': `${request.nextUrl.searchParams.get('inline') === '1' ? 'inline' : 'attachment'}; filename="${name}"`, 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '二维码图片读取失败' }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getRequestSession } from '@/lib/auth';
import { ownerBindScene } from '@/lib/local-cn-store-owners';
import { createMpTempQr } from '@/lib/wechat-mp-api';

// 店主绑定服务号：登录会员专属的「糙米量子」临时带参二维码（30 分钟有效）。扫码关注／已关注扫码 → 服务号收到事件 → 绑定 openid 并开启店主通知。
export const dynamic = 'force-dynamic';

const cache = new Map<number, { png: Buffer; expiresAt: number }>();

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user || user.role !== 'member' || !(user.id > 0)) return NextResponse.json({ error: '请先登录会员账号' }, { status: 401 });
  const hit = cache.get(user.id);
  if (hit && hit.expiresAt > Date.now()) {
    return new NextResponse(new Uint8Array(hit.png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  }
  const r = await createMpTempQr(ownerBindScene(user.id, 1800), 1800).catch(() => null);
  if (!r || !r.ok) return NextResponse.json({ error: '二维码生成失败，请稍后再试' }, { status: 502 });
  const png = await QRCode.toBuffer(r.url, { type: 'png', width: 420, margin: 2, errorCorrectionLevel: 'M' });
  cache.set(user.id, { png, expiresAt: Date.now() + 20 * 60 * 1000 });
  if (cache.size > 300) cache.delete(cache.keys().next().value as number);
  return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
}

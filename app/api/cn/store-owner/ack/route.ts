import { NextRequest, NextResponse } from 'next/server';
import { ackOwnerNotice, verifyAck } from '@/lib/local-cn-store-owners';

export const dynamic = 'force-dynamic';

function page(title: string, text: string, status = 200) {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:-apple-system,'PingFang SC',sans-serif;padding:48px 24px;text-align:center;color:#1c1917"><h2>${title}</h2><p style="color:#57534e">${text}</p><p><a href="/cn/member" style="color:#0f766e">返回会员中心</a></p></body></html>`;
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// 店主点通知里的链接确认收到（签名校验，不需登录）
export async function GET(request: NextRequest) {
  const id = String(request.nextUrl.searchParams.get('n') || '').slice(0, 64);
  const sig = String(request.nextUrl.searchParams.get('s') || '').slice(0, 64);
  if (!id || !verifyAck(id, sig)) return page('链接无效', '请在服务号里回复「收到」确认。', 400);
  const row = ackOwnerNotice(id);
  if (!row) return page('找不到这条通知', '请在服务号里回复「收到」确认。', 404);
  return page('已确认收到', '谢谢！请尽快联系客人。');
}

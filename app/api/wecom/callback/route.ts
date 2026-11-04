import { NextRequest, NextResponse } from 'next/server';
import { decryptWecom, verifyWecomSignature, wecomCallbackConfigured } from '@/lib/wecom-crypto';
import { parseMpXml } from '@/lib/wechat-mp-crypto';
import { handleExternalContactChange } from '@/lib/local-cn-wecom';

// 企业微信自建应用「糙米健康助手」接收消息服务器：
// GET  = URL 验证（msg_signature + timestamp + nonce + echostr，解密 echostr 原样返回明文）
// POST = 事件推送（安全模式），处理 change_external_contact；需在 5 秒内回应
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_SKEW_SECONDS = 600;

function text(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  if (!wecomCallbackConfigured()) return text('not configured', 503);
  const q = request.nextUrl.searchParams;
  const echostr = q.get('echostr') || '';
  if (!verifyWecomSignature(q.get('msg_signature') || '', q.get('timestamp') || '', q.get('nonce') || '', echostr)) return text('invalid signature', 403);
  try {
    return text(decryptWecom(echostr));
  } catch {
    return text('bad echostr', 400);
  }
}

export async function POST(request: NextRequest) {
  if (!wecomCallbackConfigured()) return text('not configured', 503);
  const q = request.nextUrl.searchParams;
  const timestamp = q.get('timestamp') || '';
  const nonce = q.get('nonce') || '';
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > MAX_SKEW_SECONDS) return text('stale', 403);
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return text('too large', 413);
  let msg: Record<string, string>;
  try {
    const encrypt = parseMpXml(raw).Encrypt || '';
    if (!verifyWecomSignature(q.get('msg_signature') || '', timestamp, nonce, encrypt)) return text('invalid signature', 403);
    msg = parseMpXml(decryptWecom(encrypt));
  } catch {
    console.warn('[wecom-callback] decode failed');
    return text('bad request', 400);
  }
  if (msg.MsgType === 'event' && msg.Event === 'change_external_contact') {
    // 先回应，再异步拉取客户详情
    handleExternalContactChange(msg).catch(() => console.warn('[wecom-callback] handle failed', msg.ChangeType));
  }
  return text('success');
}

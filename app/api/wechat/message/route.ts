import { NextRequest, NextResponse } from 'next/server';
import {
  buildTextReplyXml,
  decryptMpMessage,
  mpServerConfigured,
  parseMpXml,
  verifyMsgSignature,
  verifyUrlSignature,
  wrapEncryptedReply,
} from '@/lib/wechat-mp-crypto';
import { handleKefuInbound } from '@/lib/wechat-kefu-bot';

// 服务号「糙米量子」服务器配置入口：
// GET  = 微信校验 URL（signature + echostr）
// POST = 用户消息 / 事件推送（支持安全模式 AES）；需在 5 秒内回应
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PASSIVE_BUDGET_MS = 4300;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SKEW_SECONDS = 600;

function text(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  if (!mpServerConfigured()) return text('not configured', 503);
  const q = request.nextUrl.searchParams;
  if (!verifyUrlSignature(q.get('signature') || '', q.get('timestamp') || '', q.get('nonce') || '')) return text('invalid signature', 403);
  return text(q.get('echostr') || '');
}

export async function POST(request: NextRequest) {
  const deadline = Date.now() + PASSIVE_BUDGET_MS;
  if (!mpServerConfigured()) return text('not configured', 503);
  const q = request.nextUrl.searchParams;
  const timestamp = q.get('timestamp') || '';
  const nonce = q.get('nonce') || '';
  if (!verifyUrlSignature(q.get('signature') || '', timestamp, nonce)) return text('invalid signature', 403);
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > MAX_SKEW_SECONDS) return text('stale', 403);

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return text('too large', 413);

  const encrypted = (q.get('encrypt_type') || '').toLowerCase() === 'aes';
  let msg: Record<string, string>;
  try {
    if (encrypted) {
      const outer = parseMpXml(raw);
      const encrypt = outer.Encrypt || '';
      if (!verifyMsgSignature(q.get('msg_signature') || '', timestamp, nonce, encrypt)) return text('invalid msg_signature', 403);
      msg = parseMpXml(decryptMpMessage(encrypt));
    } else {
      msg = parseMpXml(raw);
    }
  } catch {
    console.warn('[wechat-message] decode failed');
    return text('bad request', 400);
  }
  if (!msg.FromUserName || !msg.ToUserName) return text('success');

  let reply: string | null = null;
  try {
    reply = await handleKefuInbound(msg, deadline);
  } catch {
    console.warn('[wechat-message] handler error');
  }
  if (!reply) return text('success');

  const xml = buildTextReplyXml(msg.FromUserName, msg.ToUserName, reply);
  const body = encrypted ? wrapEncryptedReply(xml, nonce) : xml;
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' } });
}

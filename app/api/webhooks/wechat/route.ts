import { db } from '@/lib/db';
import { outboundNotifications } from '@/lib/schema';
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function verifyWeChatSignature(signature: string | null, timestamp: string | null, nonce: string | null) {
  const token = process.env.WECHAT_WEBHOOK_TOKEN;
  if (!token || !signature || !timestamp || !nonce) return false;
  const expected = createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex');
  return expected === signature;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const valid = verifyWeChatSignature(
    searchParams.get('signature'),
    searchParams.get('timestamp'),
    searchParams.get('nonce')
  );

  if (!valid) return new NextResponse('Invalid signature', { status: 401 });
  return new NextResponse(searchParams.get('echostr') || '', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const valid = verifyWeChatSignature(
    searchParams.get('signature'),
    searchParams.get('timestamp'),
    searchParams.get('nonce')
  );

  if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  const body = await request.text();
  await db.insert(outboundNotifications).values({
    provider: 'wechat',
    templateKey: 'wechat_message',
    payload: { rawXml: body },
    status: 'received',
  });

  return new NextResponse('success', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

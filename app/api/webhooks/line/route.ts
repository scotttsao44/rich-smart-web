import { db } from '@/lib/db';
import { outboundNotifications } from '@/lib/schema';
import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function verifyLineSignature(body: string, signature: string | null) {
  const secret = process.env.LINE_MESSAGING_CHANNEL_SECRET || process.env.LINE_CHANNEL_SECRET;
  if (!secret) return false;
  if (!signature) return false;

  const expected = createHmac('sha256', secret).update(body).digest('base64');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function forwardToLegacyLineWebhook(body: string, signature: string | null) {
  const legacyUrl = process.env.LEGACY_LINE_WEBHOOK_URL;
  if (!legacyUrl) return null;

  try {
    const response = await fetch(legacyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'x-line-signature': signature } : {}),
      },
      body,
    });

    return {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    console.error('转发 LINE webhook 到旧客服失败:', error);
    return {
      ok: false,
      status: 0,
    };
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('x-line-signature');
  if (!verifyLineSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length > 0) {
    await db.insert(outboundNotifications).values(
      events.map((event: Record<string, unknown>) => ({
        provider: 'line',
        templateKey: `line_${String(event.type || 'event')}`,
        payload: event,
        status: 'received',
      }))
    );
  }

  const legacyForward = await forwardToLegacyLineWebhook(body, signature);
  return NextResponse.json({ ok: true, legacyForward });
}

import { NextRequest, NextResponse } from 'next/server';
import { runAutoConfirm } from '@/lib/local-cn-commerce';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const expected = process.env.AUTO_CONFIRM_JOB_SECRET || '';
  const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || supplied !== expected) return NextResponse.json({ error: '自动确认任务密钥无效' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const date = String(body.date || new Date().toISOString()).slice(0, 10);
  const idempotencyKey = String(body.idempotencyKey || `auto-confirm:${date}`);
  const result = runAutoConfirm(idempotencyKey, body.now ? new Date(body.now) : new Date());
  return NextResponse.json({ result });
}


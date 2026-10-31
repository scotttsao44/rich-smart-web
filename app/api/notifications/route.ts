import { db } from '@/lib/db';
import { outboundNotifications, users } from '@/lib/schema';
import { desc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supportedProviders = new Set(['line', 'wechat', 'wechat_mini_program', 'email']);

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

export async function GET(req: NextRequest) {
  try {
    const userId = Number(req.nextUrl.searchParams.get('userId'));
    const status = normalizeText(req.nextUrl.searchParams.get('status'));

    let query = db
      .select()
      .from(outboundNotifications)
      .orderBy(desc(outboundNotifications.createdAt))
      .limit(100);

    if (Number.isInteger(userId) && userId > 0) {
      query = query.where(eq(outboundNotifications.userId, userId)) as typeof query;
    } else if (status) {
      query = query.where(eq(outboundNotifications.status, status)) as typeof query;
    }

    const items = await query;
    return NextResponse.json({ notifications: items });
  } catch (error) {
    console.error('读取通知佇列失败:', error);
    return NextResponse.json({ error: '读取通知佇列失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body.userId == null ? null : Number(body.userId);
    const provider = normalizeText(body.provider).toLowerCase();
    const templateKey = normalizeText(body.templateKey);

    if (!supportedProviders.has(provider)) {
      return NextResponse.json({ error: '不支持的通知通道' }, { status: 400 });
    }

    if (!templateKey) {
      return NextResponse.json({ error: '缺少通知模板代码' }, { status: 400 });
    }

    if (userId !== null) {
      if (!Number.isInteger(userId) || userId <= 0) {
        return NextResponse.json({ error: '用户ID格式错误' }, { status: 400 });
      }

      const existingUser = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (existingUser.length === 0) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 });
      }
    }

    const inserted = await db
      .insert(outboundNotifications)
      .values({
        userId,
        provider,
        templateKey,
        payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
        status: 'pending',
      })
      .returning();

    return NextResponse.json({ notification: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('建立通知佇列失败:', error);
    return NextResponse.json({ error: '建立通知佇列失败' }, { status: 500 });
  }
}

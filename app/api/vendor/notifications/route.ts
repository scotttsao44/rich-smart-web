import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getFreshSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { outboundNotifications } from '@/lib/schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getFreshSessionUser(request);
    if (!user) {
      return NextResponse.json({ message: '请先登录厂商中心' }, { status: 401 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ notifications: [] });
    }

    const notifications = await db
      .select()
      .from(outboundNotifications)
      .where(eq(outboundNotifications.userId, user.id))
      .orderBy(desc(outboundNotifications.createdAt))
      .limit(50);

    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('Failed to fetch vendor notifications:', error);
    return NextResponse.json({ message: '读取厂商通知失败' }, { status: 500 });
  }
}

import { db } from '@/lib/db';
import { commissions } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getWallet } from '@/lib/local-cn-commerce';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = getRequestSession(req);
    if (!session) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const requestedId = Number(req.nextUrl.searchParams.get('userId') || session.id);
    if (!hasPlatformAdminAccess(session) && requestedId !== session.id) return NextResponse.json({ error: '无权查看其他会员收益' }, { status: 403 });
    if (!process.env.DATABASE_URL) {
      const wallet = getWallet(requestedId);
      return NextResponse.json({ commissions: wallet.entries.filter((entry) => entry.sourceType !== 'withdrawal'), summary: wallet.summary });
    }

    const userCommissions = await db
      .select()
      .from(commissions)
      .where(eq(commissions.userId, requestedId))
      .orderBy(desc(commissions.createdAt));

    return NextResponse.json({ commissions: userCommissions });
  } catch (error) {
    console.error('读取佣金失败:', error);
    return NextResponse.json({ error: '读取佣金失败' }, { status: 500 });
  }
}

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });
    }

    const downlines = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        agentLevel: users.agentLevel,
        totalSalesVolume: users.totalSalesVolume,
        commissionBalance: users.commissionBalance,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.referrerId, parseInt(userId)));

    return NextResponse.json({ downlines });
  } catch (error) {
    console.error('读取团队失败:', error);
    return NextResponse.json({ error: '读取团队失败' }, { status: 500 });
  }
}

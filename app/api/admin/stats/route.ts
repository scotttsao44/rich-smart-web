import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { products, orders, users } from '@/lib/schema';
import { gt, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const [productResult] = await db.select({ count: sql`count(*)` }).from(products);
    const [orderResult] = await db.select({ count: sql`count(*)` }).from(orders);
    const [userResult] = await db.select({ count: sql`count(*)` }).from(users);
    const [agentResult] = await db.select({ count: sql`count(*)` }).from(users).where(gt(users.agentLevel, 0));

    return NextResponse.json({
      productCount: Number(productResult.count),
      orderCount: Number(orderResult.count),
      userCount: Number(userResult.count),
      agentCount: Number(agentResult.count),
    });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

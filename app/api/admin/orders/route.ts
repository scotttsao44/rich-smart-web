import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { orders, users } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { buildWechatReconciliationSummary, listLocalCnOrders, updateLocalCnOrderStatus } from '@/lib/local-cn-commerce';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    if (!process.env.DATABASE_URL) {
      const localOrders = listLocalCnOrders().map((order) => ({
        orders: order,
        users: order.userId
          ? {
            id: order.userId,
            name: (order as any).buyerName || order.shippingName || '中国站会员',
            phone: (order as any).buyerPhone || order.shippingPhone,
          }
          : null,
      }));
      return NextResponse.json(localOrders);
    }

    const orderList = await db.select().from(orders)
      .leftJoin(users, eq(orders.userId, users.id))
      .orderBy(desc(orders.createdAt));
    return NextResponse.json(orderList);
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const { id, status } = body;
    if (!id || !status) {
      return NextResponse.json({ error: 'Order ID and status are required' }, { status: 400 });
    }

    if (!process.env.DATABASE_URL) {
      const order = updateLocalCnOrderStatus(Number(id), status);
      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, order });
    }

    await db.update(orders).set({ status }).where(eq(orders.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update order:', error);
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
  }
}

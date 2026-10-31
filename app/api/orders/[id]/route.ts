import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { orders, orderItems } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { confirmLocalCnOrder, getLocalCnOrder, updateLocalCnOrderStatus } from '@/lib/local-cn-commerce';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const session = getRequestSession(request);
    if (!session) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    if (!process.env.DATABASE_URL) {
      const order = getLocalCnOrder(id);
      if (!order) {
        return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      }
      if (!hasPlatformAdminAccess(session) && order.userId !== session.id) return NextResponse.json({ error: '无权查看此订单' }, { status: 403 });
      return NextResponse.json(order);
    }

    const orderResult = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (orderResult.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (!hasPlatformAdminAccess(session) && orderResult[0].userId !== session.id) return NextResponse.json({ error: '无权查看此订单' }, { status: 403 });

    const items = await db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, id));

    return NextResponse.json({ ...orderResult[0], items });
  } catch (error) {
    console.error('Failed to fetch order:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = getRequestSession(request);
  if (!session) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: '订单编号不正确' }, { status: 400 });
  const body = await request.json();
  if (process.env.DATABASE_URL) return NextResponse.json({ error: '数据库版确认收货迁移尚未执行' }, { status: 503 });
  try {
    if (body.action === 'mark_delivered') {
      if (!hasPlatformAdminAccess(session)) return NextResponse.json({ error: '仅平台可以记录物流签收' }, { status: 403 });
      const current = getLocalCnOrder(id);
      if (!current) return NextResponse.json({ error: '找不到订单' }, { status: 404 });
      if (current.status !== 'shipped') return NextResponse.json({ error: '订单发货后才能标记送达' }, { status: 400 });
      return NextResponse.json({ order: updateLocalCnOrderStatus(id, 'delivered', session.id) });
    }
    if (body.action !== 'confirm_receipt') return NextResponse.json({ error: '不支持的订单操作' }, { status: 400 });
    const order = confirmLocalCnOrder(id, session.id);
    return order ? NextResponse.json({ order }) : NextResponse.json({ error: '找不到订单' }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '确认收货失败' }, { status: 400 });
  }
}

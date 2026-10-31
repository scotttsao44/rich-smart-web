import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getRequestSession, hasPlatformAdminAccess, type SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { orderItems, orders, products, users } from '@/lib/schema';
import { listLocalBrandMembers, type BrandMemberSummary } from '@/lib/local-cn-brand-members';
import { getApprovedBrandForUser } from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

function selectedBrandId(request: NextRequest, session: SessionUser) {
  if (hasPlatformAdminAccess(session)) {
    return Number(request.nextUrl.searchParams.get('brandId') || getApprovedBrandForUser(session.id)?.id || 0);
  }
  return getApprovedBrandForUser(session.id)?.id || 0;
}

export async function GET(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!hasPlatformAdminAccess(session) && !getApprovedBrandForUser(session.id)) {
    return NextResponse.json({ error: '无权查看品牌会员' }, { status: 403 });
  }

  const brandId = selectedBrandId(request, session);
  if (!brandId) return NextResponse.json({ error: '请选择品牌' }, { status: 400 });

  if (!process.env.DATABASE_URL) {
    const members = listLocalBrandMembers(brandId);
    return NextResponse.json({ brandId, members, total: members.length });
  }

  const rows = await db
    .select({
      orderId: orders.id,
      userId: orders.userId,
      buyerName: users.name,
      shippingName: orders.shippingName,
      createdAt: orders.createdAt,
      quantity: orderItems.quantity,
      subtotal: orderItems.subtotal,
    })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(products.id, orderItems.productId))
    .leftJoin(users, eq(users.id, orders.userId))
    .where(and(eq(orders.marketRegion, 'CN'), eq(products.supplierId, brandId)));

  const grouped = new Map<number, BrandMemberSummary & { orderIds: Set<number> }>();
  for (const row of rows) {
    if (!row.userId || !row.createdAt) continue;
    const date = row.createdAt.toISOString();
    const current = grouped.get(row.userId);
    if (!current) {
      grouped.set(row.userId, {
        userId: row.userId,
        name: row.buyerName || row.shippingName || `会员 ${row.userId}`,
        memberSince: date,
        lastOrderAt: date,
        orderCount: 1,
        totalSpent: Number(row.subtotal || 0),
        productCount: Number(row.quantity || 0),
        orderIds: new Set([row.orderId]),
      });
      continue;
    }
    if (!current.orderIds.has(row.orderId)) {
      current.orderIds.add(row.orderId);
      current.orderCount += 1;
    }
    current.totalSpent += Number(row.subtotal || 0);
    current.productCount += Number(row.quantity || 0);
    if (date < current.memberSince) current.memberSince = date;
    if (date > current.lastOrderAt) current.lastOrderAt = date;
  }

  const members = Array.from(grouped.values())
    .map(({ orderIds: _orderIds, ...member }) => ({ ...member, totalSpent: Number(member.totalSpent.toFixed(2)) }))
    .sort((left, right) => right.lastOrderAt.localeCompare(left.lastOrderAt));

  return NextResponse.json({ brandId, members, total: members.length });
}

import { listLocalCnOrders, type LocalCnOrderItem } from './local-cn-commerce';
import { findLocalCnUserById } from './local-cn-users';

export type BrandMemberSummary = {
  userId: number;
  name: string;
  memberSince: string;
  lastOrderAt: string;
  orderCount: number;
  totalSpent: number;
  productCount: number;
};

function itemBrandId(item: LocalCnOrderItem) {
  if (Number.isFinite(Number(item.brandId))) return Number(item.brandId);
  return null;
}

export function listLocalBrandMembers(brandId: number): BrandMemberSummary[] {
  const members = new Map<number, BrandMemberSummary & { orderIds: Set<number> }>();

  for (const order of listLocalCnOrders()) {
    if (!order.userId) continue;
    const matchingItems = order.items.filter((item) => itemBrandId(item) === brandId);
    if (!matchingItems.length) continue;

    const existing = members.get(order.userId);
    const localUser = findLocalCnUserById(order.userId);
    const brandSpend = matchingItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
    const productCount = matchingItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const orderDate = order.createdAt;

    if (!existing) {
      members.set(order.userId, {
        userId: order.userId,
        name: localUser?.name || order.shippingName || `会员 ${order.userId}`,
        memberSince: orderDate,
        lastOrderAt: orderDate,
        orderCount: 1,
        totalSpent: brandSpend,
        productCount,
        orderIds: new Set([order.id]),
      });
      continue;
    }

    if (!existing.orderIds.has(order.id)) {
      existing.orderIds.add(order.id);
      existing.orderCount += 1;
    }
    existing.totalSpent += brandSpend;
    existing.productCount += productCount;
    if (orderDate < existing.memberSince) existing.memberSince = orderDate;
    if (orderDate > existing.lastOrderAt) existing.lastOrderAt = orderDate;
  }

  return Array.from(members.values())
    .map(({ orderIds: _orderIds, ...member }) => ({
      ...member,
      totalSpent: Number(member.totalSpent.toFixed(2)),
    }))
    .sort((left, right) => right.lastOrderAt.localeCompare(left.lastOrderAt));
}

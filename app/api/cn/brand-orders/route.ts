import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getApprovedBrandForUser } from '@/lib/local-cn-brand-marketplace';
import { listLocalCnOrders, updateLocalCnOrderStatus } from '@/lib/local-cn-commerce';
import { getOrganizationRole } from '@/lib/local-cn-organization-members';

export const dynamic = 'force-dynamic';

function brandContext(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return { user: null, brand: null };
  // Brand workspaces must stay scoped to the signed-in user's own brand. Platform
  // administrators use the platform backend for cross-brand order management.
  return { user, brand: getApprovedBrandForUser(user.id) };
}

function ownsItem(item: ReturnType<typeof listLocalCnOrders>[number]['items'][number], brand: ReturnType<typeof getApprovedBrandForUser>) {
  if (!brand) return false;
  // Explicit ownership wins; names alone cannot prove legacy brand attribution.
  const brandId = item.ownerBrandId ?? item.brandId;
  return typeof brandId === 'number' && Number.isSafeInteger(brandId) && brandId > 0 && brandId === brand.id;
}

function ownsOrder(order: ReturnType<typeof listLocalCnOrders>[number], brand: ReturnType<typeof getApprovedBrandForUser>) {
  if (!brand) return false;
  return order.items.some((item) => ownsItem(item, brand));
}

function maskedShippingAddress(order: ReturnType<typeof listLocalCnOrders>[number]) {
  const region = String(order.addressSnapshot?.region || order.shippingCity || '').trim();
  const address = String(order.addressSnapshot?.address || order.shippingAddress || '').trim();
  const visibleStreet = address ? `${address.slice(0, 6)}${address.length > 6 ? '...' : ''}` : '';
  return [region, visibleStreet].filter(Boolean).join(' ');
}

function shipment(order: ReturnType<typeof listLocalCnOrders>[number], brand: ReturnType<typeof getApprovedBrandForUser>) {
  const items = brand
    ? order.items.filter((item) => ownsItem(item, brand))
    : order.items;
  return {
    internalId: order.id,
    id: order.orderNo,
    buyer: order.shippingName || `会员 ${order.userId || '-'}`,
    product: items.map((item) => item.productName).join('、'),
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    amount: items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0),
    address: maskedShippingAddress(order),
    status: order.paymentStatus !== 'paid'
      ? '待付款'
      : order.status === 'shipped' || order.status === 'delivered' || order.status === 'completed'
        ? '已发货'
        : '待发货',
    carrier: order.shippingCarrier || '',
    trackingNo: order.trackingNumber || '',
    paymentStatus: order.paymentStatus,
    createdAt: order.createdAt,
    items: items.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      amount: Number(item.subtotal || 0),
    })),
  };
}

export async function GET(request: NextRequest) {
  const { user, brand } = brandContext(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!brand) return NextResponse.json({ error: '品牌审核通过后才能查看订单' }, { status: 403 });
  const orders = listLocalCnOrders().filter((order) => ownsOrder(order, brand));
  return NextResponse.json({ shipments: orders.map((order) => shipment(order, brand)) });
}

export async function PATCH(request: NextRequest) {
  const { user, brand } = brandContext(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!brand) return NextResponse.json({ error: '无权处理品牌订单' }, { status: 403 });
  try {
    const body = await request.json();
    const isOwner = brand && (brand.accountUserId === user.id || brand.applicantUserId === user.id);
    if (!hasPlatformAdminAccess(user) && !isOwner && !['admin', 'service'].includes(getOrganizationRole('brand', brand!.id, user.id) || '')) return NextResponse.json({ error: '当前职位无权处理发货' }, { status: 403 });
    const orderId = Number(body.orderId);
    const carrier = String(body.carrier || '').trim();
    const trackingNo = String(body.trackingNo || '').trim();
    const order = listLocalCnOrders().find((item) => item.id === orderId);
    if (!order) return NextResponse.json({ error: '找不到订单' }, { status: 404 });
    if (!ownsOrder(order, brand)) return NextResponse.json({ error: '无权处理其他品牌订单' }, { status: 403 });
    if (order.paymentStatus !== 'paid') return NextResponse.json({ error: '订单付款后才能发货' }, { status: 400 });
    if (!carrier || !trackingNo) return NextResponse.json({ error: '请填写物流公司与物流单号' }, { status: 400 });
    const updated = updateLocalCnOrderStatus(orderId, 'shipped', user.id, trackingNo, carrier);
    return NextResponse.json({ order: updated, shipment: updated ? shipment(updated, brand) : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '发货失败' }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { commerceSnapshot } from '@/lib/local-cn-commerce';
import { getApprovedBrandForUser } from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const ownedBrand = hasPlatformAdminAccess(user) ? null : getApprovedBrandForUser(user.id);
  if (!hasPlatformAdminAccess(user) && !ownedBrand) return NextResponse.json({ error: '无权查看品牌推荐订单' }, { status: 403 });
  const brandId = ownedBrand?.id || Number(request.nextUrl.searchParams.get('brandId') || 0);
  if (!brandId) return NextResponse.json({ error: '请选择品牌' }, { status: 400 });
  const state = commerceSnapshot();
  const orders = state.orders.flatMap((order) => order.items.filter((item) => item.referrerBrandId === brandId).map((item) => ({ orderId: order.id, orderNo: order.orderNo, createdAt: order.createdAt, status: order.status, paymentStatus: order.paymentStatus, productId: item.productId, productName: item.productName, quantity: item.quantity, subtotal: item.subtotal, referralAmount: item.referralAmount || 0, partnershipId: item.partnershipId })));
  const totalReferral = orders.reduce((sum, order) => sum + order.referralAmount, 0);
  return NextResponse.json({ brandId, summary: { attributedOrders: new Set(orders.map((row) => row.orderId)).size, attributedSales: orders.reduce((sum, row) => sum + Number(row.subtotal), 0), referralAmount: Number(totalReferral.toFixed(2)) }, orders });
}

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getChinaPaymentProvider, isBrandPilotPaymentContext } from '@/lib/cn-payments';
import { closeLocalCnOrderPayment, getLocalCnOrder } from '@/lib/local-cn-commerce';
import { closeWechatPayment } from '@/lib/wechat-pay';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const body = await request.json();
    const order = getLocalCnOrder(Number(body.orderId));
    if (!order) return NextResponse.json({ error: '找不到订单' }, { status: 404 });
    if (!hasPlatformAdminAccess(user) && order.userId !== user.id) return NextResponse.json({ error: '无权关闭该订单' }, { status: 403 });
    if (await isBrandPilotPaymentContext({ user, orderUserId: order.userId })) return NextResponse.json({ error: '品牌 Pilot 测试期间支付关闭，不需要调用真实关单', paymentDisabled: true }, { status: 503 });
    if (order.paymentStatus === 'failed' && order.status === 'cancelled') return NextResponse.json({ order, duplicateSafe: true });
    const provider = getChinaPaymentProvider(order.paymentMethod);
    if (provider?.id !== 'wechat_pay') return NextResponse.json({ error: '此付款方式不支持自动关单' }, { status: 400 });
    if (provider.liveConfigured) await closeWechatPayment(order.orderNo);
    const closed = closeLocalCnOrderPayment(order.id, { provider: 'wechat_pay', eventId: String(body.idempotencyKey || randomUUID()), testMode: !provider.liveConfigured, actorId: user.id });
    return NextResponse.json({ order: closed, testMode: !provider.liveConfigured, duplicateSafe: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '关闭订单失败' }, { status: 400 });
  }
}

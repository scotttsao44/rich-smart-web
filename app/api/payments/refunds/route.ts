import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getChinaPaymentProvider, isBrandPilotPaymentContext } from '@/lib/cn-payments';
import { getLocalCnOrder, getRefundByOutRefundNo, recordRefundRequested, recordRefundResult } from '@/lib/local-cn-commerce';
import { createWechatRefund, queryWechatRefund, validateWechatRefund, yuanToFen } from '@/lib/wechat-pay';

export const dynamic = 'force-dynamic';

function admin(request: NextRequest) {
  const user = getRequestSession(request);
  return hasPlatformAdminAccess(user) ? user : null;
}

function refundNo(orderId: number, idempotencyKey: string) {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24).toUpperCase();
  return `RF${orderId}${digest}`.slice(0, 64);
}

export async function POST(request: NextRequest) {
  const user = admin(request);
  if (!user) return NextResponse.json({ error: '仅平台可申请退款' }, { status: 403 });
  try {
    const body = await request.json();
    const order = getLocalCnOrder(Number(body.orderId));
    if (!order) return NextResponse.json({ error: '找不到订单' }, { status: 404 });
    if (await isBrandPilotPaymentContext({ user, orderUserId: order.userId })) return NextResponse.json({ error: '品牌 Pilot 测试期间退款关闭，不会调用真实退款或建立退款流水', paymentDisabled: true }, { status: 503 });
    const provider = getChinaPaymentProvider(order.paymentMethod);
    if (provider?.id !== 'wechat_pay') return NextResponse.json({ error: '此订单不是微信支付订单' }, { status: 400 });
    const amountFen = yuanToFen(body.amount);
    const totalFen = order.paidAmountFen || yuanToFen(order.totalAmount);
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    if (!idempotencyKey) return NextResponse.json({ error: '退款必须提供幂等键' }, { status: 400 });
    const outRefundNo = refundNo(order.id, idempotencyKey);
    const prior = getRefundByOutRefundNo(outRefundNo);
    if (prior) return NextResponse.json({ refund: prior, order: getLocalCnOrder(order.id), duplicateSafe: true });
    const reason = String(body.reason || '平台退款').trim();

    if (!provider.liveConfigured) {
      if (body.simulate !== true) return NextResponse.json({ error: '微信商户资料尚未完成，只能建立未扣款退款记录', testMode: true }, { status: 503 });
      const refund = recordRefundRequested({ orderId: order.id, provider: 'wechat_pay', outRefundNo, amountFen, reason, testMode: true, actorId: user.id });
      return NextResponse.json({ refund, order: getLocalCnOrder(order.id), testMode: true, duplicateSafe: false });
    }

    const result = await createWechatRefund({ orderNo: order.orderNo, outRefundNo, amountFen, totalFen, reason });
    validateWechatRefund(result, { orderNo: order.orderNo, outRefundNo, amountFen, totalFen });
    const refund = recordRefundRequested({ orderId: order.id, provider: 'wechat_pay', outRefundNo, providerRefundId: result.refund_id, amountFen, reason, testMode: false, actorId: user.id });
    if (result.status === 'SUCCESS') {
      recordRefundResult({ orderNo: order.orderNo, provider: 'wechat_pay', outRefundNo, providerRefundId: result.refund_id, amountFen, status: 'success', eventId: `API-${result.refund_id}`, actorId: user.id });
    }
    return NextResponse.json({ refund: getRefundByOutRefundNo(outRefundNo) || refund, order: getLocalCnOrder(order.id), testMode: false, duplicateSafe: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '退款申请失败' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const user = admin(request);
  if (!user) return NextResponse.json({ error: '仅平台可查询退款' }, { status: 403 });
  try {
    const outRefundNo = String(request.nextUrl.searchParams.get('outRefundNo') || '');
    const requested = getRefundByOutRefundNo(outRefundNo);
    if (!requested) return NextResponse.json({ error: '找不到退款申请' }, { status: 404 });
    const localOrder = getLocalCnOrder(requested.orderId);
    if (await isBrandPilotPaymentContext({ user, orderUserId: localOrder?.userId })) return NextResponse.json({ error: '品牌 Pilot 测试期间退款查询关闭', paymentDisabled: true }, { status: 503 });
    if (requested.testMode) return NextResponse.json({ refund: requested, testMode: true });
    const result = await queryWechatRefund(outRefundNo);
    validateWechatRefund(result, { orderNo: requested.orderNo, outRefundNo, amountFen: requested.amountFen, totalFen: requested.totalFen });
    const status = result.status === 'SUCCESS' ? 'success' : result.status === 'CLOSED' ? 'closed' : result.status === 'ABNORMAL' ? 'abnormal' : 'processing';
    const order = recordRefundResult({ orderNo: requested.orderNo, provider: 'wechat_pay', outRefundNo, providerRefundId: result.refund_id, amountFen: requested.amountFen, status, eventId: `QUERY-${result.refund_id}-${status}` });
    return NextResponse.json({ refund: getRefundByOutRefundNo(outRefundNo), order, testMode: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '退款查询失败' }, { status: 502 });
  }
}

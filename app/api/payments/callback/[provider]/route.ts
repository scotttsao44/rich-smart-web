import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { getChinaPaymentProvider, isBrandPilotPaymentContext, verifyPaymentCallback } from '@/lib/cn-payments';
import { getLocalCnOrder, getLocalCnOrderByOrderNo, getRefundByOutRefundNo, recordPayment, recordRefundResult } from '@/lib/local-cn-commerce';
import { isStorePrepayTradeNo, recordStorePrepayPaid } from '@/lib/cn-store-prepay';
import { baseOrderNoFromTradeNo, decryptWechatPayNotification, decryptWechatRefundNotification, validateWechatRefund, validateWechatTransaction, verifyWechatPayNotification, yuanToFen } from '@/lib/wechat-pay';

export async function POST(request: Request, { params }: { params: { provider: string } }) {
  const provider = getChinaPaymentProvider(params.provider);
  if (!provider) return NextResponse.json({ error: '不支持的支付渠道' }, { status: 404 });
  if (provider.id === 'bank_transfer') {
    return NextResponse.json({ error: provider.message }, { status: 503 });
  }
  const rawBody = await request.text();
  if (provider.id === 'wechat_pay' && provider.liveConfigured) {
    try {
      verifyWechatPayNotification(rawBody, request.headers);
      const notification = JSON.parse(rawBody);
      if (!notification.resource) return new NextResponse(null, { status: 204 });
      if (notification.event_type === 'TRANSACTION.SUCCESS') {
        const transaction = decryptWechatPayNotification(notification.resource);
        // 门店申请：预购次数（次卡）订单（SP 开头），与商城订单分开入账
        if (isStorePrepayTradeNo(transaction.out_trade_no)) {
          await recordStorePrepayPaid(transaction, { eventId: String(notification.id || transaction.transaction_id) });
          return new NextResponse(null, { status: 204 });
        }
        const order = getLocalCnOrderByOrderNo(baseOrderNoFromTradeNo(transaction.out_trade_no));
        if (!order) throw new Error('找不到微信支付对应订单');
        if (await isBrandPilotPaymentContext({ orderUserId: order.userId })) {
          return NextResponse.json({ code: 'FAIL', message: '品牌 Pilot 测试订单禁止真实支付回调入账' }, { status: 503 });
        }
        validateWechatTransaction(transaction, { orderNo: order.orderNo, amountFen: yuanToFen(order.totalAmount) });
        recordPayment({
          orderId: order.id,
          provider: 'wechat_pay',
          providerTransactionId: transaction.transaction_id,
          eventId: String(notification.id || transaction.transaction_id),
          verified: true,
          testMode: false,
          amountFen: transaction.amount.total,
          paidAt: transaction.success_time,
          payloadDigest: createHash('sha256').update(rawBody).digest('hex'),
        });
      } else if (notification.event_type === 'REFUND.SUCCESS' || notification.event_type === 'REFUND.ABNORMAL' || notification.event_type === 'REFUND.CLOSED') {
        const refund = decryptWechatRefundNotification(notification.resource);
        const requested = getRefundByOutRefundNo(refund.out_refund_no);
        if (!requested) throw new Error('找不到微信退款申请');
        const order = getLocalCnOrder(requested.orderId);
        if (await isBrandPilotPaymentContext({ orderUserId: order?.userId })) {
          return NextResponse.json({ code: 'FAIL', message: '品牌 Pilot 测试订单禁止真实退款回调入账' }, { status: 503 });
        }
        validateWechatRefund(refund, { orderNo: requested.orderNo, outRefundNo: requested.outRefundNo, amountFen: requested.amountFen, totalFen: requested.totalFen });
        const status = refund.status === 'SUCCESS' ? 'success' : refund.status === 'CLOSED' ? 'closed' : refund.status === 'ABNORMAL' ? 'abnormal' : 'processing';
        recordRefundResult({
          orderNo: refund.out_trade_no,
          provider: 'wechat_pay',
          outRefundNo: refund.out_refund_no,
          providerRefundId: refund.refund_id,
          amountFen: refund.amount.refund,
          status,
          eventId: String(notification.id || refund.refund_id),
          payloadDigest: createHash('sha256').update(rawBody).digest('hex'),
        });
      }
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      return NextResponse.json({ code: 'FAIL', message: error instanceof Error ? error.message : '微信支付回调处理失败' }, { status: 400 });
    }
  }
  const signature = request.headers.get('x-payment-signature') || '';
  if (!verifyPaymentCallback(provider.id, rawBody, signature)) return NextResponse.json({ error: '支付回调签名验证失败' }, { status: 401 });
  try {
    const payload = JSON.parse(rawBody);
    const orderId = Number(payload.orderId || payload.out_trade_no);
    const eventId = String(payload.eventId || payload.id || '');
    const providerTransactionId = String(payload.transactionId || payload.trade_no || '');
    if (!orderId || !eventId || !providerTransactionId) return NextResponse.json({ error: '回调资料不完整' }, { status: 400 });
    const existing = getLocalCnOrder(orderId);
    if (await isBrandPilotPaymentContext({ orderUserId: existing?.userId })) return NextResponse.json({ error: '品牌 Pilot 测试订单禁止真实支付回调入账', paymentDisabled: true }, { status: 503 });
    const order = recordPayment({ orderId, provider: provider.id, providerTransactionId, eventId, verified: true, testMode: false, payloadDigest: createHash('sha256').update(rawBody).digest('hex') });
    return NextResponse.json({ success: true, orderId: order?.id, duplicateSafe: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '支付回调处理失败' }, { status: 400 });
  }
}

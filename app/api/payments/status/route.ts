import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getChinaPaymentProvider, isBrandPilotPaymentContext } from '@/lib/cn-payments';
import {
  buildWechatReconciliationSummary,
  getLocalCnOrder,
  getLocalCnOrderByOrderNo,
  getLocalCnOrderByTransactionId,
  syncWechatTransactionToLocalOrder,
} from '@/lib/local-cn-commerce';
import {
  queryWechatPayment,
  queryWechatPaymentByTransactionId,
  WECHAT_PAY_SETTLEMENT_INFO,
  wechatJsapiTradeNo,
} from '@/lib/wechat-pay';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const query = String(body.query || '').trim();
  const txIdInput = String(body.transactionId || (/^(42|45)\d{18,32}$/.test(query) ? query : '')).trim();
  const orderNoInput = String(body.orderNo || (!txIdInput && query ? query : '')).trim();

  let order = body.orderId
    ? getLocalCnOrder(Number(body.orderId))
    : txIdInput
      ? getLocalCnOrderByTransactionId(txIdInput)
      : orderNoInput
        ? getLocalCnOrderByOrderNo(orderNoInput)
        : null;

  if (order && !hasPlatformAdminAccess(user) && order.userId !== user.id) {
    return NextResponse.json({ error: '无权查看该订单' }, { status: 403 });
  }
  if (order && await isBrandPilotPaymentContext({ user, orderUserId: order.userId })) {
    return NextResponse.json({ paid: false, order, testMode: true, paymentDisabled: true, message: '品牌 Pilot 测试期间支付查询关闭，不会查询真实支付。' });
  }
  if (order && order.paymentStatus === 'paid' && !body.forceLiveQuery) {
    return NextResponse.json({ paid: true, order, reconciliation: buildWechatReconciliationSummary() });
  }

  const provider = getChinaPaymentProvider(order && (order.wechatPayIssuedAt || order.wechatJsapiTradeNo) ? 'wechat_pay' : (order?.paymentMethod || 'wechat_pay'));
  if (provider?.id !== 'wechat_pay' || !provider.liveConfigured) {
    if (!order) return NextResponse.json({ error: '找不到订单' }, { status: 404 });
    return NextResponse.json({ paid: false, order, testMode: Boolean(provider?.testMode) });
  }

  try {
    let transaction;
    if (txIdInput) {
      transaction = await queryWechatPaymentByTransactionId(txIdInput);
    } else {
      const baseNo = orderNoInput || order!.orderNo;
      const candidates = [baseNo, order?.wechatJsapiTradeNo || wechatJsapiTradeNo(baseNo)].filter((v, i, a) => v && a.indexOf(v) === i);
      let lastError: unknown = null;
      for (const tradeNo of candidates) {
        try {
          const tx = await queryWechatPayment(tradeNo);
          if (!transaction || tx.trade_state === 'SUCCESS') transaction = tx;
          if (tx.trade_state === 'SUCCESS') break;
        } catch (error) {
          lastError = error;
          if ((error as { code?: string })?.code !== 'ORDER_NOT_EXIST') throw error;
        }
      }
      if (!transaction) {
        if (order && (lastError as { code?: string })?.code === 'ORDER_NOT_EXIST') {
          return NextResponse.json({ paid: false, tradeState: 'NOT_CREATED', message: '尚未发起微信付款，请点击「去付款」', order });
        }
        throw lastError || new Error('微信支付查单失败');
      }
    }
    const syncedOrder = syncWechatTransactionToLocalOrder(transaction, {
      productName: body.productName,
      actorId: user.id,
    });
    if (transaction.trade_state !== 'SUCCESS') {
      return NextResponse.json({
        paid: false,
        tradeState: transaction.trade_state,
        message: transaction.trade_state_desc || '等待付款确认',
        order: syncedOrder || order,
        transaction,
        settlementInfo: WECHAT_PAY_SETTLEMENT_INFO,
        reconciliation: buildWechatReconciliationSummary(),
      });
    }
    return NextResponse.json({
      paid: true,
      tradeState: transaction.trade_state,
      message: '支付成功（微信支付官方已入账）',
      order: syncedOrder,
      transaction,
      settlementInfo: WECHAT_PAY_SETTLEMENT_INFO,
      reconciliation: buildWechatReconciliationSummary(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '微信支付查单失败', order }, { status: 502 });
  }
}

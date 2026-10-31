import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import {
  buildWechatReconciliationSummary,
  getLocalCnOrder,
  getLocalCnOrderByOrderNo,
  getLocalCnOrderByTransactionId,
  listLocalCnOrders,
  syncWechatTransactionToLocalOrder,
} from '@/lib/local-cn-commerce';
import {
  isWechatPayLiveConfigured,
  queryWechatPayment,
  queryWechatPaymentByTransactionId,
  WECHAT_PAY_SETTLEMENT_INFO,
  type WechatPayTransaction,
} from '@/lib/wechat-pay';

export const dynamic = 'force-dynamic';

function looksLikeWechatTransactionId(input: string) {
  return /^(42|45)\d{18,32}$/.test(input.trim());
}

async function handleSingleLookup(input: {
  query?: string;
  orderNo?: string;
  transactionId?: string;
  orderId?: number | string;
  productName?: string;
  actorId?: number | null;
}) {
  const rawQuery = String(input.query || input.transactionId || input.orderNo || '').trim();
  let targetOrderNo = String(input.orderNo || '').trim();
  let targetTransactionId = String(input.transactionId || '').trim();

  if (input.orderId) {
    const byId = getLocalCnOrder(Number(input.orderId));
    if (byId) {
      targetOrderNo = byId.orderNo;
      if (byId.providerTransactionId && looksLikeWechatTransactionId(byId.providerTransactionId)) {
        targetTransactionId = byId.providerTransactionId;
      }
    }
  }

  if (rawQuery) {
    if (looksLikeWechatTransactionId(rawQuery)) {
      targetTransactionId = rawQuery;
    } else if (!targetOrderNo) {
      targetOrderNo = rawQuery;
    }
  }

  if (!targetOrderNo && !targetTransactionId) {
    return NextResponse.json({ error: '请输入商户订单号（如 CN2026... / LT...）或微信支付单号（420000... / 450000...）' }, { status: 400 });
  }

  if (!isWechatPayLiveConfigured()) {
    const localOrder = targetTransactionId
      ? getLocalCnOrderByTransactionId(targetTransactionId)
      : getLocalCnOrderByOrderNo(targetOrderNo);
    return NextResponse.json({
      ok: false,
      liveConfigured: false,
      error: '当前环境尚未配置微信支付正式商户证书',
      order: localOrder,
      reconciliation: buildWechatReconciliationSummary(),
    }, { status: 400 });
  }

  let transaction: WechatPayTransaction;
  try {
    if (targetTransactionId) {
      transaction = await queryWechatPaymentByTransactionId(targetTransactionId);
    } else {
      transaction = await queryWechatPayment(targetOrderNo);
    }
  } catch (error: any) {
    const localOrder = targetTransactionId
      ? getLocalCnOrderByTransactionId(targetTransactionId)
      : getLocalCnOrderByOrderNo(targetOrderNo);
    return NextResponse.json({
      ok: false,
      code: error?.code || 'WECHAT_QUERY_ERROR',
      error: error instanceof Error ? error.message : '向微信官方查询订单失败',
      order: localOrder,
      reconciliation: buildWechatReconciliationSummary(),
    }, { status: 400 });
  }

  const syncedOrder = syncWechatTransactionToLocalOrder(transaction, {
    productName: input.productName,
    actorId: input.actorId ?? null,
  });

  const amountFen = Number(transaction.amount?.total || 0);
  const amountYuan = (amountFen / 100).toFixed(2);

  return NextResponse.json({
    ok: true,
    synced: transaction.trade_state === 'SUCCESS',
    paid: transaction.trade_state === 'SUCCESS',
    tradeState: transaction.trade_state,
    tradeStateDesc: transaction.trade_state_desc || (transaction.trade_state === 'SUCCESS' ? '支付成功' : '未支付'),
    message:
      transaction.trade_state === 'SUCCESS'
        ? `✅ 微信官方核实已入账 ¥${amountYuan}（微信单号：${transaction.transaction_id}）`
        : `ℹ️ 微信官方返回状态：${transaction.trade_state_desc || transaction.trade_state}`,
    transaction: {
      outTradeNo: transaction.out_trade_no,
      transactionId: transaction.transaction_id || null,
      tradeState: transaction.trade_state,
      tradeStateDesc: transaction.trade_state_desc || '',
      tradeType: transaction.trade_type || 'NATIVE',
      bankType: transaction.bank_type || '',
      amountFen,
      amountYuan,
      successTime: transaction.success_time || null,
      payerOpenId: transaction.payer?.openid || null,
      mchId: transaction.mchid || WECHAT_PAY_SETTLEMENT_INFO.mchId,
      settlementBank: WECHAT_PAY_SETTLEMENT_INFO.bankName,
      settlementTarget: WECHAT_PAY_SETTLEMENT_INFO.settlementTarget,
    },
    order: syncedOrder,
    orders: listLocalCnOrders(),
    reconciliation: buildWechatReconciliationSummary(),
  });
}

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!hasPlatformAdminAccess(user)) {
    return NextResponse.json({ error: '仅限平台运营管理员访问微信支付对账中心' }, { status: 403 });
  }
  const query = request.nextUrl.searchParams.get('query') || '';
  const orderNo = request.nextUrl.searchParams.get('orderNo') || '';
  const transactionId = request.nextUrl.searchParams.get('transactionId') || '';
  const orderId = request.nextUrl.searchParams.get('orderId') || '';

  if (query || orderNo || transactionId || orderId) {
    return handleSingleLookup({
      query,
      orderNo,
      transactionId,
      orderId,
      actorId: user?.id ?? null,
    });
  }

  const orders = listLocalCnOrders();
  return NextResponse.json({
    ok: true,
    liveConfigured: isWechatPayLiveConfigured(),
    settlementInfo: WECHAT_PAY_SETTLEMENT_INFO,
    reconciliation: buildWechatReconciliationSummary(orders),
    orders,
  });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!hasPlatformAdminAccess(user)) {
    return NextResponse.json({ error: '仅限平台运营管理员执行对账核销操作' }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));

  if (body.action === 'sync_all_pending') {
    const allOrders = listLocalCnOrders();
    const pendingWechatOrders = allOrders.filter(
      (order) => order.paymentMethod === 'wechat_pay' && order.paymentStatus === 'pending'
    );
    let checkedCount = 0;
    let newlyPaidCount = 0;
    const results: Array<{ orderNo: string; tradeState: string; synced: boolean }> = [];

    if (isWechatPayLiveConfigured()) {
      for (const order of pendingWechatOrders.slice(0, 20)) {
        try {
          checkedCount += 1;
          const tx = await queryWechatPayment(order.orderNo);
          const updated = syncWechatTransactionToLocalOrder(tx, { actorId: user?.id ?? null });
          const paid = tx.trade_state === 'SUCCESS' && updated?.paymentStatus === 'paid';
          if (paid) newlyPaidCount += 1;
          results.push({ orderNo: order.orderNo, tradeState: tx.trade_state, synced: paid });
        } catch (err: any) {
          results.push({ orderNo: order.orderNo, tradeState: err?.code || 'NOT_FOUND', synced: false });
        }
      }
    }

    const updatedOrders = listLocalCnOrders();
    return NextResponse.json({
      ok: true,
      checkedCount,
      newlyPaidCount,
      results,
      message: newlyPaidCount > 0
        ? `✅ 批量核销完成：共检查 ${checkedCount} 笔待付订单，新同步入账 ${newlyPaidCount} 笔！`
        : `已向微信官方核对 ${checkedCount} 笔待付订单，暂无新增已付款单。`,
      orders: updatedOrders,
      reconciliation: buildWechatReconciliationSummary(updatedOrders),
    });
  }

  return handleSingleLookup({
    query: body.query,
    orderNo: body.orderNo,
    transactionId: body.transactionId,
    orderId: body.orderId,
    productName: body.productName,
    actorId: user?.id ?? null,
  });
}

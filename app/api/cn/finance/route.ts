import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getLocalCnOrder, listFinanceRecords, refundLocalCnOrder, updateLocalCnOrderStatus, updateWithdrawal, type WithdrawalStatus } from '@/lib/local-cn-commerce';

export const dynamic = 'force-dynamic';

function admin(request: NextRequest) {
  const user = getRequestSession(request);
  return hasPlatformAdminAccess(user) ? user : null;
}

export async function GET(request: NextRequest) {
  if (!admin(request)) return NextResponse.json({ error: '仅平台可查看财务记录' }, { status: 403 });
  return NextResponse.json(listFinanceRecords());
}

export async function PATCH(request: NextRequest) {
  const user = admin(request);
  if (!user) return NextResponse.json({ error: '仅平台可操作财务记录' }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === 'withdrawal') {
      const withdrawal = updateWithdrawal(String(body.id), String(body.status) as WithdrawalStatus, { note: String(body.note || ''), providerTransactionId: String(body.providerTransactionId || ''), actorId: user.id });
      return withdrawal ? NextResponse.json({ withdrawal }) : NextResponse.json({ error: '找不到提现申请' }, { status: 404 });
    }
    if (body.action === 'refund') {
      const current = getLocalCnOrder(Number(body.orderId));
      if (!current) return NextResponse.json({ error: '找不到订单' }, { status: 404 });
      if (current.paymentMode === 'live') return NextResponse.json({ error: '正式微信支付退款必须使用微信退款接口' }, { status: 409 });
      const order = refundLocalCnOrder(current.id, Number(body.amount || 0), user.id);
      return order ? NextResponse.json({ order }) : NextResponse.json({ error: '找不到订单' }, { status: 404 });
    }
    if (body.action === 'confirm_bank_payment') {
      const order = getLocalCnOrder(Number(body.orderId));
      if (!order) return NextResponse.json({ error: '找不到订单' }, { status: 404 });
      if (order.paymentMethod !== 'bank_transfer') return NextResponse.json({ error: '此订单不是银行转账' }, { status: 400 });
      if (order.paymentStatus === 'paid') return NextResponse.json({ order, duplicateSafe: true });
      return NextResponse.json({ order: updateLocalCnOrderStatus(order.id, 'paid', user.id), duplicateSafe: false });
    }
    return NextResponse.json({ error: '不支持的财务操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '财务操作失败' }, { status: 400 });
  }
}

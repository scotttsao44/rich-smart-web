import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getChinaPaymentProvider, isBrandPilotPaymentContext, normalizePaymentProvider, paymentCapabilities } from '@/lib/cn-payments';
import { getLocalCnOrder, recordPayment } from '@/lib/local-cn-commerce';
import { findLocalCnUserById } from '@/lib/local-cn-users';
import QRCode from 'qrcode';
import { createWechatMiniProgramPayment, createWechatNativePayment, isAppIdMchIdNotMatch, yuanToFen } from '@/lib/wechat-pay';

export const dynamic = 'force-dynamic';

const APPID_PENDING_MESSAGE = '微信支付证书与密钥已连通，正等待管理员在公众平台/小程序后台点击【确认授权】关联商户号 1118445617';

function wechatErrorResponse(error: unknown, fallbackCode: string, extra: Record<string, unknown>) {
  if (isAppIdMchIdNotMatch(error)) {
    return NextResponse.json({ ...extra, error: APPID_PENDING_MESSAGE, code: 'APPID_MCHID_NOT_MATCH', pendingAuthorization: true, simulated: false, message: APPID_PENDING_MESSAGE + '。本次未扣款，订单已保留，授权完成后可重新发起付款。' }, { status: 503 });
  }
  return NextResponse.json({ ...extra, error: error instanceof Error ? error.message : '微信支付下单失败', code: fallbackCode }, { status: 502 });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const body = await request.json();
  const orderId = Number(body.orderId);
  const order = getLocalCnOrder(orderId);
  if (!order) return NextResponse.json({ error: '找不到订单' }, { status: 404 });
  if (!hasPlatformAdminAccess(user) && order.userId !== user.id) return NextResponse.json({ error: '无权操作该订单' }, { status: 403 });
  const pilotPaymentDisabled = await isBrandPilotPaymentContext({ user, orderUserId: order.userId });
  const providerId = normalizePaymentProvider(String(body.provider || order.paymentMethod));
  const provider = pilotPaymentDisabled
    ? paymentCapabilities({ forceDisabled: true })[providerId]
    : getChinaPaymentProvider(providerId);
  if (!provider || !provider.channels.includes(order.sourceChannel === 'wechat_mini' ? 'wechat_mini' : 'web')) {
    return NextResponse.json({ error: '此渠道不支持该付款方式' }, { status: 400 });
  }
  if (pilotPaymentDisabled) {
    return NextResponse.json({
      provider,
      order,
      testMode: true,
      simulated: false,
      paymentDisabled: true,
      message: '品牌 Pilot 测试期间支付、分润与退款均为关闭状态，不会发生真实扣款。',
    }, { status: 503 });
  }
  if (providerId === 'bank_transfer') return NextResponse.json({ provider, order, requiresManualConfirmation: true });
  if (user.demoAccount) {
    const eventId = String(body.idempotencyKey || `DEMO-${order.id}`);
    const paidOrder = recordPayment({
      orderId: order.id,
      provider: providerId,
      providerTransactionId: `DEMO-${providerId.toUpperCase()}-${randomUUID()}`,
      eventId,
      verified: true,
      testMode: true,
      amountFen: yuanToFen(order.totalAmount),
      payloadDigest: createHash('sha256').update(JSON.stringify({ orderId, providerId, eventId, demo: true })).digest('hex'),
      actorId: user.id,
    });
    return NextResponse.json({ provider, order: paidOrder, testMode: true, simulated: true, demoMode: true, message: 'Demo 不进行实际扣款，订单已写入模拟付款记录。' });
  }

  if (provider.liveConfigured) {
    if (providerId !== 'wechat_pay') {
      return NextResponse.json({ error: '目前正式支付仅开放微信支付' }, { status: 400 });
    }
    if (order.paymentStatus === 'paid') return NextResponse.json({ provider, order, alreadyPaid: true });
    if (order.sourceChannel !== 'wechat_mini') {
      try {
        const { codeUrl } = await createWechatNativePayment({
          orderNo: order.orderNo,
          description: order.items[0]?.productName || '糙米商城订单',
          amountFen: yuanToFen(order.totalAmount),
          attach: String(order.id),
          timeExpire: new Date(Date.now() + 2 * 60 * 60 * 1000),
        });
        const qrDataUrl = await QRCode.toDataURL(codeUrl, { margin: 1, width: 280 });
        return NextResponse.json({ provider, order, codeUrl, qrDataUrl, paymentType: 'native', testMode: false, message: '请使用微信扫一扫完成付款' });
      } catch (error) {
        return wechatErrorResponse(error, 'WECHAT_PAY_NATIVE_FAILED', { provider, order });
      }
    }
    const localUser = findLocalCnUserById(user.id);
    const openId = String(localUser?.wechatMiniOpenId || '');
    if (!openId) return NextResponse.json({ error: '当前会员未绑定微信小程序身份，不能调起微信支付' }, { status: 400 });
    try {
      const paymentParams = await createWechatMiniProgramPayment({
        orderNo: order.orderNo,
        description: order.items[0]?.productName || '糙米商城订单',
        amountFen: yuanToFen(order.totalAmount),
        openId,
        attach: String(order.id),
      });
      return NextResponse.json({ provider, order, paymentParams, testMode: false });
    } catch (error) {
      return wechatErrorResponse(error, 'WECHAT_PAY_PREPAY_FAILED', { provider, order });
    }
  }

  if (!body.simulate) {
    return NextResponse.json({ provider, order, testMode: true, requiresSimulationConfirmation: true, message: provider.message });
  }

  const eventId = String(body.idempotencyKey || `SIM-${order.id}`);
  const providerTransactionId = `PENDING-${providerId.toUpperCase()}-${randomUUID()}`;
  const paidOrder = recordPayment({
    orderId: order.id,
    provider: providerId,
    providerTransactionId,
    eventId,
    verified: true,
    testMode: true,
    amountFen: yuanToFen(order.totalAmount),
    payloadDigest: createHash('sha256').update(JSON.stringify({ orderId, providerId, eventId })).digest('hex'),
    actorId: user.id,
  });
  return NextResponse.json({ provider, order: paidOrder, testMode: true, simulated: true, message: '支付通道尚未开通，订单已记录为待确认付款，没有发生扣款。' });
}

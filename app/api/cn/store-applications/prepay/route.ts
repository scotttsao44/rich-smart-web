import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getStoreApplicationById, setStoreApplicationPrepayPending, type StoreApplication } from '@/lib/local-cn-store-applications';
import {
  STORE_PREPAY_TIERS,
  STORE_PREPAY_VALID_MONTHS,
  ensureStorePrepayOrder,
  listStorePrepayOrdersForApplication,
  noteStorePrepayTradeNo,
  recordStorePrepayPaid,
  storePrepayTier,
  type StorePrepayOrder,
} from '@/lib/cn-store-prepay';
import { findLocalCnUserById } from '@/lib/local-cn-users';
import { readPayOpenId, sanitizeNext } from '@/lib/wechat-pay-openid';
import { closeWechatPayment, createWechatNativePayment, createWechatOfficialJsapiPayment, isAppIdMchIdNotMatch, isWechatPayLiveConfigured, queryWechatPayment } from '@/lib/wechat-pay';

export const dynamic = 'force-dynamic';

const PAYABLE_STATUSES = ['pending_review', 'revision_required', 'pending_deposit'];

function publicOrder(order: StorePrepayOrder | null | undefined) {
  if (!order) return null;
  return { orderNo: order.orderNo, tier: order.tier, amountYuan: order.amountYuan, uses: order.uses, status: order.status, transactionId: order.transactionId || '', paidAt: order.paidAt || '', expiresAt: order.expiresAt || '' };
}

function wechatError(error: unknown) {
  const e = error as { code?: string; message?: string; status?: number } | null;
  const code = String(e?.code || '');
  const message = String(e?.message || '微信支付下单失败');
  if (isAppIdMchIdNotMatch(error)) return { code: 'APPID_MCHID_NOT_MATCH', message: '微信支付商户号与公众号尚未完成关联授权，本次未扣款，请稍后再试或联系客服。' };
  // 单笔限额类错误原样回报，方便排查（例如商户单笔额度不足）
  if (/limit|LIMIT|限额|超过|额度/.test(`${code} ${message}`)) return { code: code || 'AMOUNT_LIMIT', message: `微信支付提示单笔金额受限：${message}` };
  return { code: code || 'WECHAT_PAY_FAILED', message };
}

function isOrderPaidError(error: unknown) {
  const e = error as { code?: string; message?: string } | null;
  return Boolean(e && (e.code === 'ORDERPAID' || String(e.message || '').includes('已支付')));
}

/** 主动向微信查询该申请所有已下单的交易号；查到已付款即入账（回调漏收时的补偿）。 */
async function syncPaid(applicationId: string) {
  const orders = listStorePrepayOrdersForApplication(applicationId);
  const paid = orders.find((row) => row.status === 'paid');
  if (paid) return paid;
  if (!isWechatPayLiveConfigured()) return null;
  for (const order of orders) {
    for (const tradeNo of order.tradeNos) {
      try {
        const transaction = await queryWechatPayment(tradeNo);
        if (transaction.trade_state === 'SUCCESS') {
          const result = await recordStorePrepayPaid(transaction, { eventId: `query:${transaction.transaction_id}` });
          return result.order;
        }
      } catch {
        // 未下单 / 查询失败：忽略，等待回调或下次查询
      }
    }
  }
  return null;
}

function canPay(user: { id: number }, application: StoreApplication) {
  return application.applicantId === user.id;
}

function summary(application: StoreApplication, orders: StorePrepayOrder[]) {
  const current = orders.find((row) => row.status === 'paid') || orders.find((row) => row.status === 'pending') || null;
  return { applicationId: application.id, status: application.status, prepay: application.prepay || null, order: publicOrder(current) };
}

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const applicationId = String(request.nextUrl.searchParams.get('applicationId') || '');
  const base = { tiers: STORE_PREPAY_TIERS, validMonths: STORE_PREPAY_VALID_MONTHS };
  if (!applicationId) return NextResponse.json(base);
  const application = getStoreApplicationById(applicationId);
  if (!application || (!canPay(user, application) && !hasPlatformAdminAccess(user))) return NextResponse.json({ error: '找不到申请' }, { status: 404 });
  const paid = await syncPaid(application.id);
  const fresh = getStoreApplicationById(application.id) || application;
  return NextResponse.json({ ...base, ...summary(fresh, listStorePrepayOrdersForApplication(application.id)), paid: Boolean(paid) || fresh.prepay?.status === 'paid' });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const application = getStoreApplicationById(String(body.applicationId || ''));
  if (!application || !canPay(user, application)) return NextResponse.json({ error: '找不到申请或无权付款' }, { status: 404 });

  const alreadyPaid = await syncPaid(application.id);
  if (alreadyPaid) {
    const fresh = getStoreApplicationById(application.id) || application;
    return NextResponse.json({ alreadyPaid: true, ...summary(fresh, listStorePrepayOrdersForApplication(application.id)), message: '该申请已付款' });
  }
  if (!PAYABLE_STATUSES.includes(application.status)) return NextResponse.json({ error: '该申请目前不可付款，请联系客服' }, { status: 400 });
  const tier = storePrepayTier(body.tier);
  if (!tier) return NextResponse.json({ error: '请选择预购次数（次卡）档位' }, { status: 400 });
  if (!isWechatPayLiveConfigured()) return NextResponse.json({ error: '微信支付暂未开通，请联系客服' }, { status: 503 });

  const { order, superseded } = ensureStorePrepayOrder(application, tier);
  setStoreApplicationPrepayPending(application.id, { tier: tier.id, amountYuan: tier.amountYuan, uses: tier.uses, orderNo: order.orderNo });
  // 改档：关闭旧档位已下单的交易，避免旧二维码仍可付款
  for (const old of superseded) for (const tradeNo of old.tradeNos) await closeWechatPayment(tradeNo).catch(() => undefined);

  const description = `阿富同学预购次数（次卡）${tier.id}档 ${tier.uses}次`;
  const attach = application.id;
  const ua = request.headers.get('user-agent') || '';
  const inWechat = /micromessenger/i.test(ua) && !/miniprogram/i.test(ua);
  const base = { order: publicOrder(order), applicationId: application.id };
  if (inWechat && body.mode !== 'native') {
    const localUser = findLocalCnUserById(user.id);
    const storedOpenId = String(localUser?.wechatOfficialOpenId || '');
    const openId = readPayOpenId(request, user.id) || (/^o[A-Za-z0-9_-]{20,40}$/.test(storedOpenId) ? storedOpenId : '');
    if (!openId) {
      const next = sanitizeNext(String(body.returnTo || `/cn/member/store-application?payApp=${application.id}`));
      return NextResponse.json({ ...base, needsOpenId: true, authUrl: `/api/payments/wechat-openid/start?next=${encodeURIComponent(next)}`, message: '正在获取微信支付授权…' });
    }
    try {
      const params = await createWechatOfficialJsapiPayment({ orderNo: order.orderNo, description, amountFen: order.amountFen, openId, attach });
      noteStorePrepayTradeNo(order.orderNo, params.outTradeNo, openId);
      return NextResponse.json({ ...base, paymentType: 'jsapi', paymentParams: { appId: params.appId, timeStamp: params.timeStamp, nonceStr: params.nonceStr, package: params.package, signType: params.signType, paySign: params.paySign } });
    } catch (error) {
      if (isOrderPaidError(error)) return NextResponse.json({ ...base, alreadyPaid: true, message: '该订单已付款，正在确认到账' });
      const jsapiError = wechatError(error);
      if (jsapiError.code === 'AMOUNT_LIMIT') return NextResponse.json({ ...base, error: jsapiError.message, code: jsapiError.code }, { status: 502 });
      try {
        const { codeUrl } = await createWechatNativePayment({ orderNo: order.orderNo, description, amountFen: order.amountFen, attach });
        noteStorePrepayTradeNo(order.orderNo, order.orderNo);
        const qrDataUrl = await QRCode.toDataURL(codeUrl, { margin: 1, width: 280 });
        return NextResponse.json({ ...base, paymentType: 'native', qrDataUrl, jsapiError: jsapiError.message, message: '公众号支付暂不可用，请长按识别二维码付款' });
      } catch (nativeErr) {
        const e = wechatError(nativeErr);
        console.warn(`[store-prepay] jsapi+native failed order=${order.orderNo} jsapi=${jsapiError.code} native=${e.code}`);
        return NextResponse.json({ ...base, error: e.message, code: e.code }, { status: 502 });
      }
    }
  }
  try {
    const { codeUrl } = await createWechatNativePayment({ orderNo: order.orderNo, description, amountFen: order.amountFen, attach });
    noteStorePrepayTradeNo(order.orderNo, order.orderNo);
    const qrDataUrl = await QRCode.toDataURL(codeUrl, { margin: 1, width: 280 });
    return NextResponse.json({ ...base, paymentType: 'native', qrDataUrl, message: '请使用手机微信扫一扫完成付款' });
  } catch (error) {
    if (isOrderPaidError(error)) return NextResponse.json({ ...base, alreadyPaid: true, message: '该订单已付款，正在确认到账' });
    const e = wechatError(error);
    console.warn(`[store-prepay] native failed order=${order.orderNo} code=${e.code}`);
    return NextResponse.json({ ...base, error: e.message, code: e.code }, { status: 502 });
  }
}

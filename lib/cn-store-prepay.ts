// 门店申请：预购次数（次卡）线上付款（公众号 JSAPI / 电脑 Native 扫码），沿用商城的微信支付商户号与回调地址。
// 订单号 SP + 数字；JSAPI 下单尾缀 J（与商城 CN 订单分开存放：cn-store-prepay-orders.json）。
// 退款一律转人工；本文件不做分润计算。
import { randomInt } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { KEFU_TIERS } from './wechat-kefu-knowledge';
import { findLocalCnUserById, findLocalCnUserByReferralCode, getFrozenReferrerMemberId, normalizeCnReferrerCode, referralOwnerForAttribution } from './local-cn-users';
import { getStoreApplicationById, markStoreApplicationPrepayPaid, type StoreApplication } from './local-cn-store-applications';
import { validateWechatTransaction, yuanToFen, type WechatPayTransaction } from './wechat-pay';
import { sendMpCustomText, sendMpTemplate } from './wechat-mp-api';

export const STORE_PREPAY_VALID_MONTHS = 3;
export type StorePrepayTier = { id: string; amountYuan: number; uses: number };
export const STORE_PREPAY_TIERS: StorePrepayTier[] = KEFU_TIERS.map((t) => ({ id: t.id, amountYuan: t.amountYuan, uses: t.uses }));

export function storePrepayTier(id: unknown) {
  return STORE_PREPAY_TIERS.find((t) => t.id === String(id || '').trim().toUpperCase()) || null;
}

export type StorePrepayOrder = {
  orderNo: string;
  applicationId: string;
  userId: number;
  tier: string;
  amountYuan: number;
  amountFen: number;
  uses: number;
  referrerMemberId: number | null;
  status: 'pending' | 'paid' | 'superseded';
  tradeNos: string[];
  paidTradeNo?: string;
  transactionId?: string;
  paidAt?: string;
  expiresAt?: string;
  payerOpenid?: string;
  eventIds?: string[];
  /** 同一订单被重复付款（如电脑扫码与微信内各付一次）的额外交易号，需人工退款核对 */
  extraTransactionIds?: string[];
  notifyResults?: string[];
  createdAt: string;
  updatedAt: string;
};

function targetFile() {
  const dir = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dir, 'cn-store-prepay-orders.json');
}

function readAll(): StorePrepayOrder[] {
  if (!existsSync(targetFile())) return [];
  try {
    const parsed = JSON.parse(readFileSync(targetFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: StorePrepayOrder[]) {
  mkdirSync(path.dirname(targetFile()), { recursive: true });
  writeFileSync(targetFile(), JSON.stringify(rows, null, 2));
}

function saveOrder(order: StorePrepayOrder) {
  const rows = readAll();
  const index = rows.findIndex((row) => row.orderNo === order.orderNo);
  order.updatedAt = new Date().toISOString();
  if (index < 0) rows.unshift(order);
  else rows[index] = order;
  writeAll(rows);
  return order;
}

export function isStorePrepayTradeNo(tradeNo: string) {
  return /^SP\d+J?$/.test(String(tradeNo || ''));
}

export function storePrepayOrderNoFromTradeNo(tradeNo: string) {
  const value = String(tradeNo || '');
  return /^SP\d+J$/.test(value) ? value.slice(0, -1) : value;
}

export function getStorePrepayOrder(orderNo: string) {
  return readAll().find((row) => row.orderNo === orderNo) || null;
}

export function listStorePrepayOrdersForApplication(applicationId: string) {
  return readAll().filter((row) => row.applicationId === applicationId);
}

/** 门店申请的推荐归属：沿用会员已冻结的首次推荐人；没有时才用申请页 ?ref（只记在申请上，不改会员绑定）。 */
export function storeApplicationAttribution(userId: number, ref?: unknown) {
  const user = findLocalCnUserById(userId);
  const frozen = getFrozenReferrerMemberId(user);
  if (frozen && frozen !== userId) return { referrerMemberId: frozen, referralSource: 'member_first_touch' };
  const code = normalizeCnReferrerCode(String(ref || ''));
  if (code) {
    const owner = findLocalCnUserByReferralCode(code);
    if (owner && owner.id !== userId && referralOwnerForAttribution(owner.id)) return { referrerMemberId: owner.id, referralSource: 'store_application_ref' };
  }
  return { referrerMemberId: null, referralSource: '' };
}

function newOrderNo() {
  const d = new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace(/\D/g, '').slice(0, 14);
  return `SP${d}${String(randomInt(0, 10000)).padStart(4, '0')}`;
}

/** 取得（或建立）该申请当前档位的待付款订单；改档会建新订单，旧订单标记作废。 */
export function ensureStorePrepayOrder(application: StoreApplication, tier: StorePrepayTier) {
  const rows = listStorePrepayOrdersForApplication(application.id);
  const paid = rows.find((row) => row.status === 'paid');
  if (paid) return { order: paid, superseded: [] as StorePrepayOrder[] };
  const current = rows.find((row) => row.status === 'pending' && row.tier === tier.id && row.amountYuan === tier.amountYuan);
  const superseded = rows.filter((row) => row.status === 'pending' && row !== current);
  for (const row of superseded) saveOrder({ ...row, status: 'superseded' });
  if (current) return { order: current, superseded };
  const now = new Date().toISOString();
  const order = saveOrder({
    orderNo: newOrderNo(),
    applicationId: application.id,
    userId: application.applicantId,
    tier: tier.id,
    amountYuan: tier.amountYuan,
    amountFen: yuanToFen(tier.amountYuan),
    uses: tier.uses,
    referrerMemberId: application.referrerMemberId || null,
    status: 'pending',
    tradeNos: [],
    createdAt: now,
    updatedAt: now,
  });
  return { order, superseded };
}

export function noteStorePrepayTradeNo(orderNo: string, tradeNo: string, payerOpenid?: string) {
  const order = getStorePrepayOrder(orderNo);
  if (!order) return null;
  if (!order.tradeNos.includes(tradeNo)) order.tradeNos.push(tradeNo);
  if (payerOpenid) order.payerOpenid = payerOpenid;
  return saveOrder(order);
}

export function storePrepayCandidateTradeNos(order: StorePrepayOrder) {
  return Array.from(new Set([order.orderNo, `${order.orderNo}J`, ...order.tradeNos]));
}

function addMonths(iso: string, months: number) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString();
}

function shanghaiTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function shanghaiDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function short(text: string, max: number) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function notifyStorePrepayPaid(order: StorePrepayOrder, application: StoreApplication) {
  const results: string[] = [];
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://rich-smart.com.cn').replace(/\/$/, '');
  const paidAt = shanghaiTime(order.paidAt || new Date().toISOString());
  const expires = shanghaiDate(order.expiresAt || new Date().toISOString());
  const opsBody = `【糙米量子】门店申请已线上付款\n门店：${application.name}\n申请人：${application.contactName || application.applicantName}${application.contactPhone ? ` ${application.contactPhone}` : ''}\n预购次数（次卡）：${order.tier} 档 ${order.uses} 次，有效期至 ${expires}\n订单号：${order.orderNo}\n微信交易号：${order.transactionId}\n付款时间：${paidAt}\n请到后台审核并安排设备：${appUrl}/cn/ops#store-applications`;
  const templateId = process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_ID || '';
  const templateKeys = String(process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_KEYS || 'thing1,thing2,time3').split(',').map((s) => s.trim());
  const opsOpenids = String(process.env.KEFU_NOTIFY_OPENIDS || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{10,64}$/.test(s));
  for (const openid of opsOpenids) {
    let sent = false;
    if (templateId) {
      const r = await sendMpTemplate(openid, templateId, `${appUrl}/cn/ops#store-applications`, {
        [templateKeys[0] || 'thing1']: short(`门店付款 ${application.name}`, 18),
        [templateKeys[1] || 'thing2']: short(`${order.tier}档 ${order.uses}次 已付款`, 18),
        [templateKeys[2] || 'time3']: paidAt,
      });
      results.push(`ops:template:${r.ok ? 'sent' : `failed:${r.errcode}`}`);
      sent = r.ok;
    }
    if (!sent) {
      const r = await sendMpCustomText(openid, opsBody);
      results.push(`ops:custom:${r.ok ? 'sent' : `failed:${r.errcode}`}`);
    }
  }
  if (!opsOpenids.length) results.push('ops:no_recipients');
  const applicant = findLocalCnUserById(application.applicantId);
  const stored = String(applicant?.wechatOfficialOpenId || '');
  const applicantOpenid = order.payerOpenid || (/^o[A-Za-z0-9_-]{20,40}$/.test(stored) ? stored : '');
  if (applicantOpenid) {
    const r = await sendMpCustomText(applicantOpenid, `您好，您的门店申请「${application.name}」已付款成功。\n预购次数（次卡）：${order.tier} 档 ${order.uses} 次，有效期至 ${expires}\n订单号：${order.orderNo}\n平台审核并安排设备后，所购次数会灌入您的门店机器。申请进度：${appUrl}/cn/member#store-applications\n如需退款或有疑问，请回复「人工」。`);
    results.push(`applicant:custom:${r.ok ? 'sent' : `failed:${r.errcode}`}`);
  } else results.push('applicant:no_openid');
  console.info(`[store-prepay] paid order=${order.orderNo} app=${application.id} notify=${results.join(',')}`);
  return results;
}

/** 微信确认付款成功（回调验签解密后或主动查询结果）后调用；幂等。 */
export async function recordStorePrepayPaid(transaction: WechatPayTransaction, opts: { eventId?: string } = {}) {
  const orderNo = storePrepayOrderNoFromTradeNo(transaction.out_trade_no);
  const order = getStorePrepayOrder(orderNo);
  if (!order) throw new Error('找不到门店预购次数对应订单');
  if (!storePrepayCandidateTradeNos(order).includes(transaction.out_trade_no)) throw new Error('微信支付订单号不符');
  // 复用商城的商户身份、金额、状态校验（SP 订单号不会被去掉尾缀，直接以实际 out_trade_no 比对）
  validateWechatTransaction(transaction, { orderNo: transaction.out_trade_no, amountFen: order.amountFen });
  if (order.status === 'paid') {
    const extra = transaction.transaction_id && transaction.transaction_id !== order.transactionId && !(order.extraTransactionIds || []).includes(transaction.transaction_id);
    if (extra) console.warn(`[store-prepay] order ${order.orderNo} paid twice (${transaction.out_trade_no}); manual refund check needed`);
    if (extra || (opts.eventId && !(order.eventIds || []).includes(opts.eventId))) {
      saveOrder({
        ...order,
        eventIds: opts.eventId && !(order.eventIds || []).includes(opts.eventId) ? [...(order.eventIds || []), opts.eventId] : order.eventIds,
        extraTransactionIds: extra ? [...(order.extraTransactionIds || []), transaction.transaction_id] : order.extraTransactionIds,
      });
    }
    return { order, duplicate: true };
  }
  const paidAt = transaction.success_time ? new Date(transaction.success_time).toISOString() : new Date().toISOString();
  const expiresAt = addMonths(paidAt, STORE_PREPAY_VALID_MONTHS);
  // 若是已作废（改档前）的旧订单被付款，仍以实际付款为准入账，并转人工核对
  const wasSuperseded = order.status === 'superseded';
  const paid = saveOrder({
    ...order,
    status: 'paid',
    paidTradeNo: transaction.out_trade_no,
    transactionId: transaction.transaction_id,
    paidAt,
    expiresAt,
    payerOpenid: transaction.payer?.openid || order.payerOpenid,
    eventIds: opts.eventId ? [...(order.eventIds || []), opts.eventId] : order.eventIds || [],
  });
  const marked = markStoreApplicationPrepayPaid(order.applicationId, {
    tier: order.tier,
    amountYuan: order.amountYuan,
    uses: order.uses,
    orderNo: order.orderNo,
    transactionId: transaction.transaction_id,
    paidAt,
    expiresAt,
  });
  const application = marked?.row || getStoreApplicationById(order.applicationId);
  if (marked && !marked.changed) console.warn(`[store-prepay] application ${order.applicationId} already paid; extra paid order ${order.orderNo} needs manual check`);
  if (wasSuperseded) console.warn(`[store-prepay] superseded order ${order.orderNo} was paid; manual check`);
  if (application) {
    try {
      const results = await notifyStorePrepayPaid(paid, application);
      saveOrder({ ...paid, notifyResults: results });
    } catch (error) {
      console.warn('[store-prepay] notify failed', error instanceof Error ? error.message : error);
    }
  }
  return { order: paid, duplicate: false };
}

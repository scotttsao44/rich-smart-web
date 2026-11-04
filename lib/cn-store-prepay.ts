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
import { sendWecomAppText, wecomConfigured } from './wecom-api';

export const STORE_PREPAY_VALID_MONTHS = 3;
export type StorePrepayTier = { id: string; amountYuan: number; uses: number; testOnly?: boolean };
/** 正式档位（客服文案同源）；金额只在登录后付款步骤显示。 */
export const STORE_PREPAY_TIERS: StorePrepayTier[] = KEFU_TIERS.map((t) => ({ id: t.id, amountYuan: t.amountYuan, uses: t.uses }));
/** 仅供自测小额付款（不进客服正式档、不对外宣传）。测完可人工退。 */
export const STORE_PREPAY_TEST_TIER: StorePrepayTier = { id: 'T', amountYuan: 5, uses: 1, testOnly: true };
/** 默认可见测试档的会员（曹总自测）；也可用 env STORE_PREPAY_TEST_MEMBER_IDS=逗号分隔覆盖/追加。 */
const DEFAULT_TEST_MEMBER_IDS = [513117808227];

export function storePrepayTestAllowed(userId: number, isAdmin = false) {
  if (isAdmin) return true;
  const fromEnv = String(process.env.STORE_PREPAY_TEST_MEMBER_IDS || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const allow = fromEnv.length ? fromEnv : DEFAULT_TEST_MEMBER_IDS;
  return allow.includes(userId);
}

export function storePrepayTiersForViewer(userId: number, isAdmin = false): StorePrepayTier[] {
  return storePrepayTestAllowed(userId, isAdmin) ? [...STORE_PREPAY_TIERS, STORE_PREPAY_TEST_TIER] : STORE_PREPAY_TIERS;
}

export function storePrepayTier(id: unknown) {
  const key = String(id || '').trim().toUpperCase();
  if (key === STORE_PREPAY_TEST_TIER.id) return STORE_PREPAY_TEST_TIER;
  return STORE_PREPAY_TIERS.find((t) => t.id === key) || null;
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
  /** 付款成功通知结果（每道通道一行）；申请人未送达时 applicantPending=true，等其下次与服务号互动时补发 */
  notify?: StorePrepayNotify;
  createdAt: string;
  updatedAt: string;
};

export type StorePrepayNotifyEntry = { at: string; to: 'ops' | 'applicant'; channel: string; result: string };
export type StorePrepayNotify = {
  entries: StorePrepayNotifyEntry[];
  opsDelivered: boolean;
  applicantDelivered: boolean;
  applicantPending: boolean;
  applicantPendingSince?: string;
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

function tierLabel(order: StorePrepayOrder) {
  return order.tier === STORE_PREPAY_TEST_TIER.id ? `${order.tier} 档（付款测试）` : `${order.tier} 档`;
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://rich-smart.com.cn').replace(/\/$/, '');
}

/** 服务号客服消息失败时的典型错误：45015 超过 48 小时未互动、45047 超出一次互动可回复次数上限 */
function mpWindowError(errcode: unknown) {
  return [45015, 45047, 45011, 43004].includes(Number(errcode));
}

/** 管理方企业微信接收人（成员 userid），默认曹总 CaoZheKui；env WECOM_NOTIFY_USERIDS 逗号分隔覆盖 */
export function storePrepayOpsWecomUserIds() {
  const list = String(process.env.WECOM_NOTIFY_USERIDS || 'CaoZheKui').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_.@-]{1,64}$/.test(s));
  return Array.from(new Set(list));
}

/** 会员 → 企业微信成员 userid（申请人本人是企业成员时可用应用消息）；env WECOM_MEMBER_USERIDS=会员id:userid,…，默认曹总 */
function wecomUserIdForMember(memberId: number) {
  const raw = String(process.env.WECOM_MEMBER_USERIDS || '513117808227:CaoZheKui');
  for (const pair of raw.split(',')) {
    const [id, userid] = pair.split(':').map((s) => s.trim());
    if (Number(id) === memberId && /^[A-Za-z0-9_.@-]{1,64}$/.test(userid || '')) return userid;
  }
  return '';
}

export function storePrepayOpsWecomText(order: StorePrepayOrder, application: Pick<StoreApplication, 'name'>) {
  const tail = order.transactionId ? order.transactionId.slice(-6) : '—';
  return [
    '【糙米量子】门店预购次数（次卡）已付款',
    `门店：${application.name}`,
    `档位：${tierLabel(order)}`,
    `金额：¥${order.amountYuan}`,
    `次数：${order.uses} 次`,
    `订单号：${order.orderNo}`,
    `微信交易号尾号：${tail}`,
    `付款时间：${shanghaiTime(order.paidAt || new Date().toISOString())}（北京时间）`,
    `到期日：${shanghaiDate(order.expiresAt || new Date().toISOString())}`,
    `审核与安排设备：${appUrl()}/cn/ops#store-applications`,
  ].join('\n');
}

export function storePrepayApplicantText(order: StorePrepayOrder, application: Pick<StoreApplication, 'name'>) {
  return `您好，您的门店申请「${application.name}」已付款成功。\n预购次数（次卡）：${tierLabel(order)} ${order.uses} 次，金额 ¥${order.amountYuan}，有效期至 ${shanghaiDate(order.expiresAt || new Date().toISOString())}\n订单号：${order.orderNo}\n付款时间：${shanghaiTime(order.paidAt || new Date().toISOString())}\n平台审核并安排设备后，所购次数会灌入您的门店机器。申请进度：${appUrl()}/cn/member#store-applications\n如需退款或有疑问，请回复「人工」。`;
}

function applicantOpenidFor(order: StorePrepayOrder, application: StoreApplication) {
  const applicant = findLocalCnUserById(application.applicantId);
  const stored = String(applicant?.wechatOfficialOpenId || '');
  return order.payerOpenid || (/^o[A-Za-z0-9_-]{20,40}$/.test(stored) ? stored : '');
}

async function notifyStorePrepayPaid(order: StorePrepayOrder, application: StoreApplication) {
  const entries: StorePrepayNotifyEntry[] = [];
  const push = (to: 'ops' | 'applicant', channel: string, result: string) => entries.push({ at: new Date().toISOString(), to, channel, result });
  const url = appUrl();
  const paidAt = shanghaiTime(order.paidAt || new Date().toISOString());
  const expires = shanghaiDate(order.expiresAt || new Date().toISOString());
  const opsBody = `【糙米量子】门店申请已线上付款\n门店：${application.name}\n申请人：${application.contactName || application.applicantName}${application.contactPhone ? ` ${application.contactPhone}` : ''}\n预购次数（次卡）：${tierLabel(order)} ${order.uses} 次，金额 ¥${order.amountYuan}，有效期至 ${expires}\n订单号：${order.orderNo}\n微信交易号：${order.transactionId}\n付款时间：${paidAt}\n请到后台审核并安排设备：${url}/cn/ops#store-applications`;
  const templateId = process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_ID || '';
  const templateKeys = String(process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_KEYS || 'thing1,thing2,time3').split(',').map((s) => s.trim());
  const opsOpenids = String(process.env.KEFU_NOTIFY_OPENIDS || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{10,64}$/.test(s));
  let opsDelivered = false;
  for (const openid of opsOpenids) {
    let sent = false;
    if (templateId) {
      const r = await sendMpTemplate(openid, templateId, `${url}/cn/ops#store-applications`, {
        [templateKeys[0] || 'thing1']: short(`门店付款 ${application.name}`, 18),
        [templateKeys[1] || 'thing2']: short(`${order.tier}档 ${order.uses}次 已付款`, 18),
        [templateKeys[2] || 'time3']: paidAt,
      });
      push('ops', 'mp_template', r.ok ? 'sent' : `failed:${r.errcode}`);
      sent = r.ok;
    }
    if (!sent) {
      const r = await sendMpCustomText(openid, opsBody);
      push('ops', 'mp_custom', r.ok ? 'sent' : `failed:${r.errcode}`);
      sent = r.ok;
    }
    opsDelivered = opsDelivered || sent;
  }
  if (!opsOpenids.length) push('ops', 'mp', 'no_recipients');
  // 服务号送不到（45015/45047 等）或没有接收人：改走企业微信应用消息给管理方
  const wecomOps: string[] = [];
  if (!opsDelivered) {
    const userids = storePrepayOpsWecomUserIds();
    if (!wecomConfigured() || !userids.length) push('ops', 'wecom_app', 'not_configured');
    else {
      const r = await sendWecomAppText(userids, storePrepayOpsWecomText(order, application));
      const invalid = String((r.data as Record<string, unknown>)?.invaliduser || '');
      push('ops', `wecom_app:${userids.join('|')}`, r.ok ? `sent${invalid ? `:invalid=${invalid}` : ''}` : `failed:${r.errcode}`);
      if (r.ok) {
        opsDelivered = true;
        wecomOps.push(...userids.filter((u) => !invalid.split('|').includes(u)));
      }
    }
  }

  // 申请人：服务号客服消息 → 付款成功模板（若已配置）→ 企业微信（申请人本人是企业成员）→ 待补发
  let applicantDelivered = false;
  const applicantOpenid = applicantOpenidFor(order, application);
  const applicantText = storePrepayApplicantText(order, application);
  if (applicantOpenid) {
    const r = await sendMpCustomText(applicantOpenid, applicantText);
    push('applicant', 'mp_custom', r.ok ? 'sent' : `failed:${r.errcode}`);
    applicantDelivered = r.ok;
    const paidTpl = process.env.WECHAT_TPL_STORE_PREPAY_PAID || '';
    if (!applicantDelivered && paidTpl) {
      const keys = String(process.env.WECHAT_TPL_STORE_PREPAY_PAID_KEYS || 'thing1,amount2,time3').split(',').map((s) => s.trim());
      const t = await sendMpTemplate(applicantOpenid, paidTpl, `${url}/cn/member#store-applications`, {
        [keys[0] || 'thing1']: short(`${application.name} 预购次数（次卡）`, 20),
        [keys[1] || 'amount2']: `${order.amountYuan}元`,
        [keys[2] || 'time3']: paidAt,
      });
      push('applicant', 'mp_template', t.ok ? 'sent' : `failed:${t.errcode}`);
      applicantDelivered = t.ok;
    } else if (!applicantDelivered) push('applicant', 'mp_template', 'no_payment_template');
  } else push('applicant', 'mp', 'no_openid');
  if (!applicantDelivered) {
    const memberUserId = wecomUserIdForMember(application.applicantId);
    if (memberUserId && wecomOps.includes(memberUserId)) {
      // 申请人即管理方本人：企业微信已收到管理方通知，不重复发；对客文案仍待其下次互动时由服务号补发
      push('applicant', `wecom_app:${memberUserId}`, 'same_as_ops');
    } else if (memberUserId && wecomConfigured()) {
      const r = await sendWecomAppText([memberUserId], applicantText);
      push('applicant', `wecom_app:${memberUserId}`, r.ok ? 'sent' : `failed:${r.errcode}`);
      applicantDelivered = r.ok;
    }
  }
  const applicantPending = !applicantDelivered && Boolean(applicantOpenid);
  if (applicantPending) push('applicant', 'pending_resend', 'on_next_interaction');
  const notify: StorePrepayNotify = {
    entries,
    opsDelivered,
    applicantDelivered,
    applicantPending,
    applicantPendingSince: applicantPending ? new Date().toISOString() : undefined,
  };
  const results = entries.map((e) => `${e.to}:${e.channel}:${e.result}`);
  console.info(`[store-prepay] paid order=${order.orderNo} app=${application.id} notify=${results.join(',')}`);
  if (mpWindowError(entries.find((e) => e.channel === 'mp_custom')?.result.split(':')[1])) console.info(`[store-prepay] order=${order.orderNo} mp window closed; fallback used`);
  return { results, notify };
}

const resendInFlight = new Set<string>();

/** 用户与服务号互动（发消息 / 点菜单 / 关注 / 扫码）后调用：补发其待补发的门店付款成功通知。不抛错。 */
export async function deliverPendingStorePrepayNotices(openid: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(String(openid || ''))) return 0;
  let sent = 0;
  try {
    const rows = readAll().filter((row) => row.status === 'paid' && row.notify?.applicantPending);
    for (const row of rows) {
      const application = getStoreApplicationById(row.applicationId);
      if (!application || applicantOpenidFor(row, application) !== openid) continue;
      if (resendInFlight.has(row.orderNo)) continue;
      resendInFlight.add(row.orderNo);
      try {
        const r = await sendMpCustomText(openid, storePrepayApplicantText(row, application));
        const fresh = getStorePrepayOrder(row.orderNo) || row;
        const notify: StorePrepayNotify = fresh.notify || { entries: [], opsDelivered: false, applicantDelivered: false, applicantPending: true };
        const entry: StorePrepayNotifyEntry = { at: new Date().toISOString(), to: 'applicant', channel: 'mp_custom_resend', result: r.ok ? 'sent' : `failed:${r.errcode}` };
        const next: StorePrepayNotify = { ...notify, entries: [...notify.entries, entry].slice(-30), applicantDelivered: r.ok || notify.applicantDelivered, applicantPending: !r.ok };
        saveOrder({ ...fresh, notify: next, notifyResults: next.entries.map((e) => `${e.to}:${e.channel}:${e.result}`) });
        console.info(`[store-prepay] resend order=${row.orderNo} to=…${openid.slice(-4)} ${entry.result}`);
        if (r.ok) sent += 1;
      } finally {
        resendInFlight.delete(row.orderNo);
      }
    }
  } catch (error) {
    console.warn('[store-prepay] resend error', error instanceof Error ? error.message : error);
  }
  return sent;
}

/** 后台/会员「我的订单」展示用：次卡预购订单（不含已作废）。 */
export type StorePrepayOrderView = {
  kind: 'store_prepay';
  typeLabel: string;
  orderNo: string;
  applicationId: string;
  storeName: string;
  userId: number;
  applicantName: string;
  tier: string;
  isTest: boolean;
  amountYuan: number;
  uses: number;
  status: 'pending' | 'paid';
  statusLabel: string;
  paidAt: string;
  expiresAt: string;
  transactionTail: string;
  createdAt: string;
};

export function storePrepayOrderView(order: StorePrepayOrder, application?: StoreApplication | null): StorePrepayOrderView {
  const app = application === undefined ? getStoreApplicationById(order.applicationId) : application;
  const status = order.status === 'paid' ? 'paid' : 'pending';
  return {
    kind: 'store_prepay',
    typeLabel: '预购次数（次卡）',
    orderNo: order.orderNo,
    applicationId: order.applicationId,
    storeName: app?.name || '门店申请',
    userId: order.userId,
    applicantName: app ? app.contactName || app.applicantName || '' : '',
    tier: order.tier,
    isTest: order.tier === STORE_PREPAY_TEST_TIER.id,
    amountYuan: order.amountYuan,
    uses: order.uses,
    status,
    statusLabel: status === 'paid' ? '已付款' : '待付款',
    paidAt: order.paidAt || '',
    expiresAt: order.expiresAt || '',
    transactionTail: order.transactionId ? order.transactionId.slice(-6) : '',
    createdAt: order.createdAt,
  };
}

/** 会员本人的次卡预购订单（按 userId；不含已作废的改档旧单） */
export function listStorePrepayOrderViewsForUser(userId: number) {
  return readAll().filter((row) => row.userId === userId && row.status !== 'superseded').map((row) => storePrepayOrderView(row));
}

/** 后台：全部次卡预购订单（不含已作废），新到旧 */
export function listAllStorePrepayOrderViews() {
  return readAll()
    .filter((row) => row.status !== 'superseded')
    .map((row) => storePrepayOrderView(row))
    .sort((a, b) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime());
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
      const { results, notify } = await notifyStorePrepayPaid(paid, application);
      saveOrder({ ...(getStorePrepayOrder(paid.orderNo) || paid), notifyResults: results, notify });
    } catch (error) {
      console.warn('[store-prepay] notify failed', error instanceof Error ? error.message : error);
    }
  }
  return { order: paid, duplicate: false };
}

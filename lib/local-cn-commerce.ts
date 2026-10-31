import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import { getCnyPrice } from './cn-market';
import {
  CAOMI_OFFICIAL_REFERRAL_CODE,
  findLocalCnUserById,
  findLocalCnUserByReferralCode,
  getFrozenReferrerCode,
  getFrozenReferrerMemberId,
  normalizeCnReferrerCode,
} from './local-cn-users';
import { getPublicBrandProduct } from './local-cn-brand-marketplace';
import { getCnPaymentSettings } from './cn-payment-settings';
import { isWechatPayLiveConfigured, WECHAT_PAY_SETTLEMENT_INFO, type WechatPayTransaction } from './wechat-pay';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
export type WalletEntryStatus = 'pending' | 'frozen' | 'available' | 'cancelled' | 'reversal' | 'paid';
export type WithdrawalStatus = 'requested' | 'reviewing' | 'processing' | 'paid' | 'failed' | 'rejected';
export type PartnershipStatus = 'pending' | 'active' | 'rejected' | 'paused';

export type AddressSnapshot = {
  addressId: string | null;
  name: string;
  phone: string;
  region: string;
  address: string;
  postalCode: string;
  snapshotAt: string;
};

export type BrandPartnership = {
  id: string;
  referrerBrandId: number;
  referrerBrandName: string;
  ownerBrandId: number;
  ownerBrandName: string;
  status: PartnershipStatus;
  terms: string;
  rewardType: 'rate' | 'fixed';
  rewardRate: number;
  rewardFixedAmount: number;
  startsAt: string;
  endsAt: string | null;
  referrerAcceptedAt?: string | null;
  ownerAcceptedAt?: string | null;
  platformReviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BrandCuratedProduct = {
  id: string;
  partnershipId: string;
  productId: number;
  referrerBrandId: number;
  displayName: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalCnOrderItem = {
  id: number;
  productId: number;
  productName: string;
  brandId?: number | null;
  brandName?: string | null;
  ownerBrandId?: number | null;
  ownerBrandName?: string | null;
  referrerBrandId?: number | null;
  referrerBrandName?: string | null;
  partnershipId?: string | null;
  referralRuleSnapshot?: Record<string, number | string> | null;
  referralAmount?: number;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  settlementSnapshot?: Record<string, number | string>;
  activeRankSnapshot?: {
    brandId: number;
    capturedAt: string;
    windowDays: number;
    metric?: 'paid_quantity';
    brandSalesQuantity?: number;
    pointsPerPaidReferral: number;
    totalPoints: number;
    recipients: Array<{
      userId: number;
      name: string;
      referredSalesQuantity?: number;
      contributionRate?: number;
      points: number;
      shareRate: number;
    }>;
  };
};

export type LocalCnOrder = {
  id: number;
  orderNo: string;
  userId: number | null;
  totalAmount: string;
  currency: 'CNY';
  marketRegion: 'CN';
  sourceChannel: string;
  referralCode?: string | null;
  paymentMethod: string;
  paymentMode: 'live' | 'test' | 'manual';
  status: string;
  paymentStatus: PaymentStatus;
  providerTransactionId?: string | null;
  paidAmountFen?: number;
  refundedAmountFen?: number;
  paymentSnapshot?: {
    paidAmountFen: number;
    platformFeeRate: number;
    platformFeeFen: number;
    paymentChannelFeeRate: number;
    paymentChannelFeeFen: number;
    riskReserveRate: number;
    riskReserveFen: number;
    capturedAt: string;
  };
  shippingName: string | null;
  shippingPhone: string | null;
  shippingCity: string | null;
  shippingAddress: string | null;
  shippingZip?: string | null;
  shippingCarrier?: string | null;
  addressSnapshot: AddressSnapshot;
  trackingNumber: string | null;
  paidAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  confirmedAt?: string | null;
  autoConfirmAt?: string | null;
  refundedAt?: string | null;
  settlementStatus: 'none' | 'frozen' | 'available' | 'cancelled' | 'reversed';
  createdAt: string;
  updatedAt: string;
  items: LocalCnOrderItem[];
};

export type WalletEntry = {
  id: string;
  idempotencyKey: string;
  userId: number;
  orderId: number;
  orderNo: string;
  orderItemId: number;
  productId: number;
  productName: string;
  sourceType: 'sale' | 'referral' | 'brand_referral' | 'active_rank' | 'other' | 'withdrawal';
  ruleSnapshot: Record<string, number | string>;
  amount: number;
  status: WalletEntryStatus;
  expectedReleaseAt: string | null;
  availableAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WithdrawalRequest = {
  id: string;
  userId: number;
  method: 'wechat_wallet' | 'alipay';
  realName: string;
  account: string;
  amount: number;
  fee: number;
  netAmount: number;
  status: WithdrawalStatus;
  note: string;
  providerTransactionId: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentEvent = {
  id: string;
  idempotencyKey: string;
  orderId: number;
  provider: string;
  providerTransactionId: string;
  eventType: string;
  verified: boolean;
  testMode: boolean;
  payloadDigest: string;
  amountFen?: number;
  createdAt: string;
};

export type RefundRecord = {
  id: string;
  idempotencyKey: string;
  orderId: number;
  orderNo: string;
  provider: string;
  outRefundNo: string;
  providerRefundId: string;
  amountFen: number;
  totalFen: number;
  status: 'processing' | 'success' | 'closed' | 'abnormal';
  reason: string;
  testMode: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CommerceAuditEvent = {
  id: string;
  type: string;
  actorId: number | null;
  entityType: string;
  entityId: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type AutoConfirmJobRun = {
  id: string;
  idempotencyKey: string;
  startedAt: string;
  completedAt: string;
  confirmedOrderIds: number[];
};

export type CommerceState = {
  schemaVersion: number;
  revision: number;
  orders: LocalCnOrder[];
  partnerships: BrandPartnership[];
  curatedProducts: BrandCuratedProduct[];
  walletEntries: WalletEntry[];
  withdrawals: WithdrawalRequest[];
  paymentEvents: PaymentEvent[];
  refunds: RefundRecord[];
  auditEvents: CommerceAuditEvent[];
  jobRuns: AutoConfirmJobRun[];
  idempotency: Record<string, string>;
};

const RELEASE_DAYS = 7;
const CAOMI_OFFICIAL_USER_ID = -106;
const ACTIVE_RANK_WINDOW_DAYS = Math.max(1, Number(process.env.CN_ACTIVE_RANK_WINDOW_DAYS || 30));

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function statePath() {
  return path.join(dataDir(), 'cn-commerce.json');
}

function legacyOrdersPath() {
  return path.join(dataDir(), 'cn-orders.json');
}

function lockPath() {
  return path.join(dataDir(), '.cn-commerce.lock');
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function defaultOrders(): LocalCnOrder[] {
  return [];
}

function normalizeOrder(order: Partial<LocalCnOrder>): LocalCnOrder {
  const now = order.createdAt || new Date().toISOString();
  return {
    ...order,
    id: Number(order.id),
    orderNo: String(order.orderNo || `CN${order.id}`),
    userId: order.userId == null ? null : Number(order.userId),
    totalAmount: String(order.totalAmount || '0.00'),
    currency: 'CNY',
    marketRegion: 'CN',
    sourceChannel: String(order.sourceChannel || 'wechat_h5'),
    paymentMethod: String(order.paymentMethod || 'bank_transfer'),
    paymentMode: order.paymentMode || (order.paymentMethod === 'bank_transfer' ? 'manual' : 'test'),
    status: String(order.status || 'pending_payment'),
    paymentStatus: order.paymentStatus || 'pending',
    paidAmountFen: Number(order.paidAmountFen || 0),
    refundedAmountFen: Number(order.refundedAmountFen || 0),
    shippingName: order.shippingName || null,
    shippingPhone: order.shippingPhone || null,
    shippingCity: order.shippingCity || null,
    shippingAddress: order.shippingAddress || null,
    shippingCarrier: order.shippingCarrier || null,
    addressSnapshot: order.addressSnapshot || {
      addressId: null,
      name: String(order.shippingName || ''),
      phone: String(order.shippingPhone || ''),
      region: String(order.shippingCity || ''),
      address: String(order.shippingAddress || ''),
      postalCode: String(order.shippingZip || ''),
      snapshotAt: now,
    },
    trackingNumber: order.trackingNumber || null,
    settlementStatus: order.settlementStatus || 'none',
    createdAt: now,
    updatedAt: order.updatedAt || now,
    items: Array.isArray(order.items) ? order.items : [],
  } as LocalCnOrder;
}

function defaultState(): CommerceState {
  let orders = defaultOrders();
  if (existsSync(legacyOrdersPath())) {
    try {
      const parsed = JSON.parse(readFileSync(legacyOrdersPath(), 'utf8'));
      if (Array.isArray(parsed)) orders = parsed.map(normalizeOrder);
    } catch {
      // Keep an empty order list if the legacy file is unreadable.
    }
  }
  return ensureSettlementClosure({
    schemaVersion: 2,
    revision: 0,
    orders,
    partnerships: [],
    curatedProducts: [],
    walletEntries: [],
    withdrawals: [],
    paymentEvents: [],
    refunds: [],
    auditEvents: [],
    jobRuns: [],
    idempotency: {},
  });
}

function readState(): CommerceState {
  if (!existsSync(statePath())) return defaultState();
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<CommerceState>;
    return ensureSettlementClosure({
      ...defaultState(),
      ...parsed,
      orders: Array.isArray(parsed.orders) ? parsed.orders.map(normalizeOrder) : defaultOrders(),
      partnerships: Array.isArray(parsed.partnerships) ? parsed.partnerships : [],
      curatedProducts: Array.isArray(parsed.curatedProducts) ? parsed.curatedProducts : [],
      walletEntries: Array.isArray(parsed.walletEntries) ? parsed.walletEntries : [],
      withdrawals: Array.isArray(parsed.withdrawals) ? parsed.withdrawals : [],
      paymentEvents: Array.isArray(parsed.paymentEvents) ? parsed.paymentEvents : [],
      refunds: Array.isArray(parsed.refunds) ? parsed.refunds : [],
      auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
      jobRuns: Array.isArray(parsed.jobRuns) ? parsed.jobRuns : [],
      idempotency: parsed.idempotency && typeof parsed.idempotency === 'object' ? parsed.idempotency : {},
    });
  } catch {
    return defaultState();
  }
}

function acquireLock() {
  mkdirSync(dataDir(), { recursive: true });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      mkdirSync(lockPath());
      return;
    } catch {
      try {
        if (Date.now() - statSync(lockPath()).mtimeMs > 30_000) rmSync(lockPath(), { recursive: true, force: true });
      } catch {
        // The lock may have been released between checks.
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  throw new Error('交易资料正忙，请稍后重试');
}

function releaseLock() {
  rmSync(lockPath(), { recursive: true, force: true });
}

function atomicWrite(state: CommerceState) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${statePath()}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = openSync(temporary, 'w');
  try {
    writeFileSync(descriptor, JSON.stringify(state, null, 2), 'utf8');
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, statePath());
}

function mutate<T>(fn: (state: CommerceState) => T): T {
  acquireLock();
  try {
    const state = readState();
    const result = fn(state);
    state.revision += 1;
    atomicWrite(state);
    return result;
  } finally {
    releaseLock();
  }
}

function appendAudit(state: CommerceState, input: Omit<CommerceAuditEvent, 'id' | 'createdAt'>) {
  state.auditEvents.push({ ...input, id: `AUD-${Date.now()}-${state.auditEvents.length + 1}`, createdAt: new Date().toISOString() });
}

function productById(productId: number) {
  const marketplaceProduct = getPublicBrandProduct(productId);
  if (marketplaceProduct) return { ...marketplaceProduct, supplierId: marketplaceProduct.brandId, supplierName: marketplaceProduct.brandName };
  return null;
}

function isPartnershipActive(partnership: BrandPartnership, now = Date.now()) {
  if (partnership.status !== 'active') return false;
  if (new Date(partnership.startsAt).getTime() > now) return false;
  if (partnership.endsAt && new Date(partnership.endsAt).getTime() < now) return false;
  return true;
}

function settlementForProduct(productId: number, unitPrice: number, referralAmount: number) {
  const product = productById(productId);
  const productRates = product && 'directRate' in product ? product : null;
  const paymentSettings = getCnPaymentSettings();
  const platformFeeRate = paymentSettings.platformFeeRate;
  const paymentFeeRate = paymentSettings.paymentChannelFeeRate;
  const riskReserveRate = paymentSettings.riskReserveRate;
  const brandSettlement = Number(product?.supplyPriceCny ?? 0);
  const otherCost = 0;
  const distributablePool = Math.max(0, unitPrice - brandSettlement - otherCost - referralAmount - unitPrice * (platformFeeRate + paymentFeeRate + riskReserveRate) / 100);
  return {
    brandSettlement,
    platformFeeRate,
    platformFee: roundMoney(unitPrice * platformFeeRate / 100),
    paymentFeeRate,
    paymentFee: roundMoney(unitPrice * paymentFeeRate / 100),
    riskReserveRate,
    riskReserve: roundMoney(unitPrice * riskReserveRate / 100),
    otherCost,
    brandReferral: referralAmount,
    distributablePool: roundMoney(distributablePool),
    directRate: Number(productRates?.directRate ?? 30),
    upperRate: Number(productRates?.upperRate ?? 5),
    activeRate: Number(productRates?.activeRate ?? 65),
  };
}

function brandReferralBasis(productId: number, unitPrice: number) {
  const product = productById(productId);
  const brandSettlement = Number(product?.supplyPriceCny ?? 0);
  const otherCost = 0;
  return roundMoney(Math.max(0, unitPrice - brandSettlement - otherCost));
}

function resolveReferralUserId(referralCode?: string | null) {
  const normalized = normalizeCnReferrerCode(referralCode);
  if (normalized === CAOMI_OFFICIAL_REFERRAL_CODE) return CAOMI_OFFICIAL_USER_ID;
  return findLocalCnUserByReferralCode(normalized)?.id || CAOMI_OFFICIAL_USER_ID;
}

function resolveUpperReferralUserId(directUserId: number | null) {
  if (!directUserId || directUserId === CAOMI_OFFICIAL_USER_ID) return CAOMI_OFFICIAL_USER_ID;
  const directUser = findLocalCnUserById(directUserId);
  const frozenUpperId = getFrozenReferrerMemberId(directUser);
  return frozenUpperId || resolveReferralUserId(directUser?.referrerCode);
}

function settlementRecipientName(userId: number) {
  if (userId === CAOMI_OFFICIAL_USER_ID) return '糙米官方';
  return findLocalCnUserById(userId)?.name || `会员 ${userId}`;
}

function captureActiveRank(state: CommerceState, item: LocalCnOrderItem, capturedAt: string) {
  const capturedAtTime = new Date(capturedAt).getTime();
  const cutoff = capturedAtTime - ACTIVE_RANK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const brandId = Number(item.ownerBrandId ?? item.brandId ?? 0);
  const referredSalesByUser = new Map<number, number>();

  for (const paidOrder of state.orders) {
    if (paidOrder.paymentStatus !== 'paid') continue;
    const paidAt = new Date(paidOrder.paidAt || paidOrder.updatedAt || paidOrder.createdAt).getTime();
    if (!Number.isFinite(paidAt) || paidAt < cutoff || paidAt > capturedAtTime) continue;
    const quantity = paidOrder.items
      .filter((candidate) => Number(candidate.ownerBrandId ?? candidate.brandId ?? 0) === brandId)
      .reduce((sum, candidate) => sum + Number(candidate.quantity || 0), 0);
    if (quantity <= 0) continue;
    const referrerId = resolveReferralUserId(paidOrder.referralCode);
    referredSalesByUser.set(referrerId, (referredSalesByUser.get(referrerId) || 0) + quantity);
  }

  if (!referredSalesByUser.size) referredSalesByUser.set(CAOMI_OFFICIAL_USER_ID, 1);
  const brandSalesQuantity = Array.from(referredSalesByUser.values()).reduce((sum, value) => sum + value, 0);
  const recipients = Array.from(referredSalesByUser.entries())
    .map(([userId, referredSalesQuantity]) => {
      const contributionRate = Number((referredSalesQuantity / brandSalesQuantity * 100).toFixed(6));
      return {
      userId,
      name: settlementRecipientName(userId),
      referredSalesQuantity: Number(referredSalesQuantity.toFixed(4)),
      contributionRate,
      // Legacy aliases keep already-generated clients compatible with the new snapshot.
      points: Number(referredSalesQuantity.toFixed(4)),
      shareRate: contributionRate,
      };
    })
    .sort((left, right) => right.referredSalesQuantity - left.referredSalesQuantity || left.userId - right.userId);

  return {
    brandId,
    capturedAt,
    windowDays: ACTIVE_RANK_WINDOW_DAYS,
    metric: 'paid_quantity' as const,
    brandSalesQuantity: Number(brandSalesQuantity.toFixed(4)),
    pointsPerPaidReferral: 1,
    totalPoints: Number(brandSalesQuantity.toFixed(4)),
    recipients,
  };
}

function ensureSettlementClosure(state: CommerceState) {
  for (const paidOrder of state.orders.filter((entry) => entry.paymentStatus === 'paid')) {
    const resolved = resolveReferralUserId(paidOrder.referralCode);
    if (resolved) {
      state.walletEntries = state.walletEntries.filter((entry) => !(entry.orderId === paidOrder.id && entry.sourceType === 'sale' && entry.userId === -102));
    }
    createSettlementEntries(state, paidOrder);
  }
  return state;
}

export function commerceSnapshot() {
  return readState();
}

export function enrichOrderReconciliation<T extends Partial<LocalCnOrder>>(order: T) {
  const isWechat = order.paymentMethod === 'wechat_pay';
  const hasRealTx = Boolean(order.providerTransactionId && /^(42|45)\d{18,}/.test(String(order.providerTransactionId)));
  const effectiveMode: 'live' | 'test' | 'manual' =
    order.paymentMethod === 'bank_transfer'
      ? 'manual'
      : hasRealTx || order.paymentMode === 'live' || (isWechat && isWechatPayLiveConfigured() && order.paymentStatus === 'pending')
        ? 'live'
        : (order.paymentMode || 'test');
  const testMode = effectiveMode === 'test';
  const buyer = order.userId ? findLocalCnUserById(Number(order.userId)) : null;
  return {
    ...order,
    orderNo: order.orderNo || `CN-${order.id}`,
    providerTransactionId: order.providerTransactionId || null,
    paymentMethod: order.paymentMethod || 'wechat_pay',
    paymentStatus: order.paymentStatus || 'pending',
    paymentMode: effectiveMode,
    testMode,
    paidAt: order.paidAt || null,
    buyerName: (order as any).buyerName || buyer?.name || order.shippingName || (order.userId ? `会员 ${order.userId}` : '访客'),
    buyerPhone: (order as any).buyerPhone || buyer?.phone || order.shippingPhone || '',
    merchantId: isWechat && !testMode ? WECHAT_PAY_SETTLEMENT_INFO.mchId : null,
    settlementBank: isWechat && !testMode ? WECHAT_PAY_SETTLEMENT_INFO.bankName : null,
    settlementTarget: isWechat && !testMode
      ? WECHAT_PAY_SETTLEMENT_INFO.settlementTarget
      : order.paymentMethod === 'bank_transfer'
        ? '银行转账对公核销 → 农业银行对公账户（尾号 8694）'
        : '测试模拟通道（未入真实商户号）',
  };
}

export function buildWechatReconciliationSummary(inputOrders?: LocalCnOrder[]) {
  const orders = (inputOrders || readState().orders).map((o) => enrichOrderReconciliation(o));
  const livePaidOrders = orders.filter((o) => o.paymentMethod === 'wechat_pay' && o.paymentStatus === 'paid' && !o.testMode);
  const pendingOrders = orders.filter((o) => o.paymentStatus === 'pending');
  const testPaidOrders = orders.filter((o) => o.paymentStatus === 'paid' && o.testMode);
  const livePaidTotalYuan = roundMoney(livePaidOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0));
  const pendingTotalYuan = roundMoney(pendingOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0));
  return {
    livePaidTotalYuan,
    livePaidCount: livePaidOrders.length,
    pendingCount: pendingOrders.length,
    pendingTotalYuan,
    testPaidCount: testPaidOrders.length,
    totalOrdersCount: orders.length,
    merchantId: WECHAT_PAY_SETTLEMENT_INFO.mchId,
    merchantName: WECHAT_PAY_SETTLEMENT_INFO.merchantName,
    settlementBank: WECHAT_PAY_SETTLEMENT_INFO.bankName,
    settlementTarget: WECHAT_PAY_SETTLEMENT_INFO.settlementTarget,
  };
}

export function listLocalCnOrders(userId?: number | null): LocalCnOrder[] {
  const orders = readState().orders.map((order) => enrichOrderReconciliation(order));
  return userId ? orders.filter((order) => order.userId === userId) : orders;
}

export function getLocalCnOrder(id: number): LocalCnOrder | null {
  const found = readState().orders.find((order) => order.id === id);
  return found ? enrichOrderReconciliation(found) : null;
}

export function getLocalCnOrderByOrderNo(orderNo: string): LocalCnOrder | null {
  const found = readState().orders.find((order) => order.orderNo === orderNo);
  return found ? enrichOrderReconciliation(found) : null;
}

export function getLocalCnOrderByTransactionId(transactionId: string): LocalCnOrder | null {
  const found = readState().orders.find((order) => order.providerTransactionId === transactionId);
  return found ? enrichOrderReconciliation(found) : null;
}

export function syncWechatTransactionToLocalOrder(
  transaction: WechatPayTransaction,
  options?: { productName?: string; userId?: number | null; actorId?: number | null }
) {
  const synced = mutate((state) => {
    let order = state.orders.find(
      (entry) =>
        entry.orderNo === transaction.out_trade_no ||
        (Boolean(transaction.transaction_id) && entry.providerTransactionId === transaction.transaction_id)
    );
    const paidAmountFen = Number(transaction.amount?.total || 0);
    const totalYuan = (paidAmountFen / 100).toFixed(2);
    const paidAt = transaction.success_time || new Date().toISOString();
    const paymentSettings = getCnPaymentSettings();

    if (!order && transaction.trade_state === 'SUCCESS') {
      const numericTs = Number(String(transaction.out_trade_no || '').replace(/\D/g, '').slice(0, 13));
      const id = Number.isFinite(numericTs) && numericTs > 1700000000000 ? numericTs : Date.now();
      const productName =
        options?.productName ||
        (String(transaction.out_trade_no || '').startsWith('LT')
          ? '微信支付正式通道 ¥1.00 实测验证单'
          : `微信支付实收订单 (${transaction.out_trade_no})`);
      const settlement = settlementForProduct(1000, Number(totalYuan), 0);
      const createdIso = Number.isFinite(numericTs) && numericTs > 1700000000000 ? new Date(numericTs).toISOString() : paidAt;
      order = {
        id,
        orderNo: transaction.out_trade_no,
        userId: options?.userId ?? 990000000001,
        totalAmount: totalYuan,
        currency: 'CNY',
        marketRegion: 'CN',
        sourceChannel: 'wechat_native',
        referralCode: CAOMI_OFFICIAL_REFERRAL_CODE,
        paymentMethod: 'wechat_pay',
        paymentMode: 'live',
        status: 'paid',
        paymentStatus: 'paid',
        providerTransactionId: transaction.transaction_id,
        paidAmountFen,
        refundedAmountFen: 0,
        paymentSnapshot: {
          paidAmountFen,
          platformFeeRate: paymentSettings.platformFeeRate,
          platformFeeFen: Math.round((paidAmountFen * paymentSettings.platformFeeRate) / 100),
          paymentChannelFeeRate: paymentSettings.paymentChannelFeeRate,
          paymentChannelFeeFen: Math.round((paidAmountFen * paymentSettings.paymentChannelFeeRate) / 100),
          riskReserveRate: paymentSettings.riskReserveRate,
          riskReserveFen: Math.round((paidAmountFen * paymentSettings.riskReserveRate) / 100),
          capturedAt: paidAt,
        },
        shippingName: '曹总 (Scott) · 微信扫码实测',
        shippingPhone: '-',
        shippingCity: '苏州',
        shippingAddress: '微信支付正式通道扫码核销',
        shippingZip: '',
        addressSnapshot: {
          addressId: null,
          name: '曹总 (Scott) · 微信扫码实测',
          phone: '-',
          region: '苏州',
          address: '微信支付正式通道扫码核销',
          postalCode: '',
          snapshotAt: createdIso,
        },
        trackingNumber: null,
        paidAt,
        settlementStatus: 'frozen',
        createdAt: createdIso,
        updatedAt: new Date().toISOString(),
        items: [
          {
            id,
            productId: 1000,
            productName,
            brandId: 101,
            brandName: '糙米量子',
            ownerBrandId: 101,
            ownerBrandName: '糙米量子',
            referrerBrandId: null,
            referrerBrandName: null,
            partnershipId: null,
            referralRuleSnapshot: null,
            referralAmount: 0,
            quantity: 1,
            unitPrice: totalYuan,
            subtotal: totalYuan,
            settlementSnapshot: settlement,
          },
        ],
      };
      state.orders.unshift(order);
    }

    if (!order) return null;

    order.paymentMethod = 'wechat_pay';
    order.paymentMode = 'live';

    if (transaction.trade_state === 'SUCCESS') {
      const wasPaid = order.paymentStatus === 'paid';
      order.paymentStatus = 'paid';
      if (order.status === 'pending_payment' || order.status === 'cancelled') {
        order.status = 'paid';
      }
      order.providerTransactionId = transaction.transaction_id;
      order.paidAmountFen = paidAmountFen || Math.round(Number(order.totalAmount) * 100);
      order.paidAt = transaction.success_time || order.paidAt || paidAt;
      if (order.settlementStatus === 'none') {
        order.settlementStatus = 'frozen';
      }
      if (!order.paymentSnapshot) {
        order.paymentSnapshot = {
          paidAmountFen: order.paidAmountFen,
          platformFeeRate: paymentSettings.platformFeeRate,
          platformFeeFen: Math.round((order.paidAmountFen * paymentSettings.platformFeeRate) / 100),
          paymentChannelFeeRate: paymentSettings.paymentChannelFeeRate,
          paymentChannelFeeFen: Math.round((order.paidAmountFen * paymentSettings.paymentChannelFeeRate) / 100),
          riskReserveRate: paymentSettings.riskReserveRate,
          riskReserveFen: Math.round((order.paidAmountFen * paymentSettings.riskReserveRate) / 100),
          capturedAt: order.paidAt,
        };
      }
      order.updatedAt = new Date().toISOString();
      const key = `payment:wechat_pay:${transaction.transaction_id}`;
      if (!state.paymentEvents.some((event) => event.idempotencyKey === key)) {
        state.paymentEvents.push({
          id: `PE-${Date.now()}-${state.paymentEvents.length + 1}`,
          idempotencyKey: key,
          orderId: order.id,
          provider: 'wechat_pay',
          providerTransactionId: transaction.transaction_id,
          eventType: 'payment.succeeded',
          verified: true,
          testMode: false,
          payloadDigest: `reconcile:${transaction.out_trade_no}:${transaction.transaction_id}`,
          amountFen: order.paidAmountFen,
          createdAt: order.paidAt,
        });
      }
      createSettlementEntries(state, order);
      if (!wasPaid) {
        appendAudit(state, {
          type: 'payment.reconciled',
          actorId: options?.actorId ?? order.userId,
          entityType: 'order',
          entityId: String(order.id),
          detail: {
            orderNo: order.orderNo,
            provider: 'wechat_pay',
            providerTransactionId: transaction.transaction_id,
            amountFen: order.paidAmountFen,
            paidAt: order.paidAt,
            testMode: false,
          },
        });
      }
    }
    return order;
  });
  return synced ? enrichOrderReconciliation(synced) : null;
}

export function getRefundByOutRefundNo(outRefundNo: string) {
  return readState().refunds.find((refund) => refund.outRefundNo === outRefundNo) || null;
}

export function createLocalCnOrder(body: any) {
  return mutate((state) => {
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    if (idempotencyKey && state.idempotency[`order:${idempotencyKey}`]) {
      const existingId = Number(state.idempotency[`order:${idempotencyKey}`]);
      const existing = state.orders.find((order) => order.id === existingId);
      if (existing) return existing;
    }

    const now = new Date();
    let totalAmount = 0;
    const items = (Array.isArray(body.items) ? body.items : []).map((input: any, index: number) => {
      const productId = Number(input.productId);
      const product = productById(productId);
      if (!product) throw new Error(`商品 ${productId} 不存在`);
      const unitPrice = getCnyPrice(product);
      const quantity = Math.max(1, Number(input.quantity || 1));
      const requestedReferrerBrandId = Number(input.referrerBrandId || body.referrerBrandId || 0);
      const partnership = requestedReferrerBrandId
        ? state.partnerships.find((entry) => entry.referrerBrandId === requestedReferrerBrandId && entry.ownerBrandId === product.supplierId && isPartnershipActive(entry))
        : null;
      const curated = partnership
        ? state.curatedProducts.find((entry) => entry.partnershipId === partnership.id && entry.productId === productId && entry.referrerBrandId === requestedReferrerBrandId && entry.enabled)
        : null;
      const referralBasis = brandReferralBasis(productId, unitPrice);
      const referralPerUnit = partnership && curated
        ? partnership.rewardType === 'fixed'
          ? partnership.rewardFixedAmount
          : referralBasis * partnership.rewardRate / 100
        : 0;
      const referralAmount = roundMoney(referralPerUnit * quantity);
      const settlement = settlementForProduct(productId, unitPrice, roundMoney(referralPerUnit));
      totalAmount += unitPrice * quantity;
      return {
        id: now.getTime() + index,
        productId,
        productName: product.name,
        brandId: product.supplierId ?? null,
        brandName: product.supplierName ?? null,
        ownerBrandId: product.supplierId ?? null,
        ownerBrandName: product.supplierName ?? null,
        referrerBrandId: partnership && curated ? partnership.referrerBrandId : null,
        referrerBrandName: partnership && curated ? partnership.referrerBrandName : null,
        partnershipId: partnership && curated ? partnership.id : null,
        referralRuleSnapshot: partnership && curated ? {
          rewardType: partnership.rewardType,
          rewardRate: partnership.rewardRate,
          rewardFixedAmount: partnership.rewardFixedAmount,
          basis: 'gross_profit',
          basisAmount: referralBasis,
          startsAt: partnership.startsAt,
          endsAt: partnership.endsAt || '',
        } : null,
        referralAmount,
        quantity,
        unitPrice: unitPrice.toFixed(2),
        subtotal: (unitPrice * quantity).toFixed(2),
        settlementSnapshot: settlement,
      } satisfies LocalCnOrderItem;
    });
    if (!items.length) throw new Error('购物车为空');
    const id = now.getTime();
    const snapshot: AddressSnapshot = {
      addressId: body.addressId ? String(body.addressId) : null,
      name: String(body.shippingName || '').trim(),
      phone: String(body.shippingPhone || '').trim(),
      region: String(body.shippingCity || '').trim(),
      address: String(body.shippingAddress || '').trim(),
      postalCode: String(body.shippingZip || '').trim(),
      snapshotAt: now.toISOString(),
    };
    const method = String(body.paymentMethod || 'bank_transfer');
    const buyerUserId = body.userId ? Number(body.userId) : null;
    const boundReferralCode = buyerUserId ? getFrozenReferrerCode(findLocalCnUserById(buyerUserId)) : null;
    const order: LocalCnOrder = {
      id,
      orderNo: `CN${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getTime()).slice(-5)}`,
      userId: buyerUserId,
      totalAmount: totalAmount.toFixed(2),
      currency: 'CNY',
      marketRegion: 'CN',
      sourceChannel: body.sourceChannel || 'wechat_h5',
      referralCode: normalizeCnReferrerCode(buyerUserId ? boundReferralCode : body.referralCode ? String(body.referralCode) : null),
      paymentMethod: method,
      paymentMode: method === 'bank_transfer' ? 'manual' : (method === 'wechat_pay' && isWechatPayLiveConfigured() ? 'live' : 'test'),
      status: 'pending_payment',
      paymentStatus: 'pending',
      shippingName: snapshot.name,
      shippingPhone: snapshot.phone,
      shippingCity: snapshot.region,
      shippingAddress: snapshot.address,
      shippingZip: snapshot.postalCode,
      addressSnapshot: snapshot,
      trackingNumber: null,
      settlementStatus: 'none',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      items,
    };
    state.orders.unshift(order);
    if (idempotencyKey) state.idempotency[`order:${idempotencyKey}`] = String(order.id);
    appendAudit(state, { type: 'order.created', actorId: order.userId, entityType: 'order', entityId: String(order.id), detail: { orderNo: order.orderNo, totalAmount: order.totalAmount, addressSnapshot: snapshot } });
    return order;
  });
}

function createSettlementEntries(state: CommerceState, order: LocalCnOrder) {
  const now = new Date().toISOString();
  const referralUserId = resolveReferralUserId(order.referralCode);
  const upperReferralUserId = resolveUpperReferralUserId(referralUserId);
  order.referralCode = normalizeCnReferrerCode(order.referralCode);
  for (const item of order.items) {
    const hasCurrentEntries = state.walletEntries.some((entry) => entry.orderId === order.id && entry.orderItemId === item.id);
    if (!hasCurrentEntries) {
      item.settlementSnapshot = {
        ...settlementForProduct(item.productId, Number(item.unitPrice), Number(item.referralAmount || 0) / Math.max(1, item.quantity)),
        capturedAt: order.paidAt || now,
      };
    }
    const snapshot = item.settlementSnapshot || {};
    const pool = Number(snapshot.distributablePool || 0) * item.quantity;
    item.activeRankSnapshot = item.activeRankSnapshot || captureActiveRank(state, item, order.paidAt || now);
    state.walletEntries = state.walletEntries.filter((entry) => !(
      entry.orderId === order.id
      && entry.orderItemId === item.id
      && entry.sourceType === 'active_rank'
      && !entry.ruleSnapshot.activeRankCapturedAt
    ));
    const rows: Array<{
      userId: number;
      sourceType: WalletEntry['sourceType'];
      entryKey: string;
      rate: number;
      amount: number;
      rankMeta?: { referredSalesQuantity: number; brandSalesQuantity: number; contributionRate: number; position: number };
    }> = [];
    if (upperReferralUserId) rows.push({ userId: upperReferralUserId, sourceType: 'referral', entryKey: 'upper', rate: Number(snapshot.upperRate || 0), amount: pool * Number(snapshot.upperRate || 0) / 100 });
    rows.push({ userId: referralUserId, sourceType: 'referral', entryKey: 'direct', rate: Number(snapshot.directRate || 0), amount: pool * Number(snapshot.directRate || 0) / 100 });

    const activeTotal = roundMoney(pool * Number(snapshot.activeRate || 0) / 100);
    let allocatedActive = 0;
    item.activeRankSnapshot.recipients.forEach((recipient, index, recipients) => {
      const referredSalesQuantity = Number(recipient.referredSalesQuantity ?? recipient.points ?? 0);
      const brandSalesQuantity = Number(item.activeRankSnapshot!.brandSalesQuantity ?? item.activeRankSnapshot!.totalPoints ?? 0);
      const contributionRate = Number(recipient.contributionRate ?? recipient.shareRate ?? 0);
      const amount = index === recipients.length - 1
        ? roundMoney(activeTotal - allocatedActive)
        : roundMoney(activeTotal * contributionRate / 100);
      allocatedActive = roundMoney(allocatedActive + amount);
      rows.push({
        userId: recipient.userId,
        sourceType: 'active_rank',
        entryKey: `active-${index + 1}`,
        rate: contributionRate,
        amount,
        rankMeta: { referredSalesQuantity, brandSalesQuantity, contributionRate, position: index + 1 },
      });
    });
    if (item.referrerBrandId && item.referralAmount) rows.push({ userId: item.referrerBrandId, sourceType: 'brand_referral', entryKey: 'brand-referral', rate: Number(item.referralRuleSnapshot?.rewardRate || 0), amount: item.referralAmount });
    for (const row of rows) {
      const amount = roundMoney(row.amount);
      if (amount <= 0) continue;
      const key = `wallet:${order.id}:${item.id}:${row.sourceType}:${row.entryKey}:${row.userId}`;
      if (state.walletEntries.some((entry) => entry.idempotencyKey === key)) continue;
      state.walletEntries.push({
        id: `WE-${Date.now()}-${state.walletEntries.length + 1}`,
        idempotencyKey: key,
        userId: row.userId,
        orderId: order.id,
        orderNo: order.orderNo,
        orderItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        sourceType: row.sourceType,
        ruleSnapshot: {
          rate: row.rate,
          partnershipId: item.partnershipId || '',
          ownerBrandId: item.ownerBrandId || 0,
          referrerBrandId: item.referrerBrandId || 0,
          platformFeeRate: Number(snapshot.platformFeeRate || 0),
          settlementCapturedAt: String(snapshot.capturedAt || order.paidAt || now),
          activeRankCapturedAt: row.rankMeta ? item.activeRankSnapshot.capturedAt : '',
          activeRankWindowDays: row.rankMeta ? item.activeRankSnapshot.windowDays : 0,
          activeMetric: row.rankMeta ? 'paid_quantity' : '',
          activePersonalSalesQuantity: row.rankMeta?.referredSalesQuantity || 0,
          activeBrandSalesQuantity: row.rankMeta?.brandSalesQuantity || 0,
          activeContributionRate: row.rankMeta?.contributionRate || 0,
          activePosition: row.rankMeta?.position || 0,
          referralLevel: row.entryKey === 'direct' ? 1 : row.entryKey === 'upper' ? 2 : 0,
        },
        amount,
        status: 'frozen',
        expectedReleaseAt: order.autoConfirmAt || null,
        availableAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

export function recordPayment(input: { orderId: number; provider: string; providerTransactionId: string; eventId: string; verified: boolean; testMode: boolean; amountFen?: number; paidAt?: string; payloadDigest?: string; actorId?: number | null }) {
  return mutate((state) => {
    const key = `payment:${input.provider}:${input.eventId}`;
    const prior = state.paymentEvents.find((event) => event.idempotencyKey === key);
    if (prior) return state.orders.find((order) => order.id === prior.orderId) || null;
    const order = state.orders.find((entry) => entry.id === input.orderId);
    if (!order) throw new Error('找不到订单');
    if (!input.verified) throw new Error('支付事件签名验证失败');
    if (order.paymentStatus === 'refunded') throw new Error('已退款订单不可重复付款');
    const expectedAmountFen = Math.round(Number(order.totalAmount) * 100);
    const paidAmountFen = Number(input.amountFen || expectedAmountFen);
    if (paidAmountFen !== expectedAmountFen) throw new Error('实付金额与订单金额不符');
    if (order.providerTransactionId && order.providerTransactionId !== input.providerTransactionId) throw new Error('订单已有不同的支付交易号');
    const now = input.paidAt || new Date().toISOString();
    state.paymentEvents.push({ id: `PE-${Date.now()}-${state.paymentEvents.length + 1}`, idempotencyKey: key, orderId: order.id, provider: input.provider, providerTransactionId: input.providerTransactionId, eventType: 'payment.succeeded', verified: true, testMode: input.testMode, payloadDigest: input.payloadDigest || '', amountFen: paidAmountFen, createdAt: now });
    order.paymentStatus = 'paid';
    order.status = 'paid';
    order.paymentMode = input.testMode ? 'test' : 'live';
    order.providerTransactionId = input.providerTransactionId;
    order.paidAmountFen = paidAmountFen;
    const paymentSettings = getCnPaymentSettings();
    order.paymentSnapshot = {
      paidAmountFen,
      platformFeeRate: paymentSettings.platformFeeRate,
      platformFeeFen: Math.round(paidAmountFen * paymentSettings.platformFeeRate / 100),
      paymentChannelFeeRate: paymentSettings.paymentChannelFeeRate,
      paymentChannelFeeFen: Math.round(paidAmountFen * paymentSettings.paymentChannelFeeRate / 100),
      riskReserveRate: paymentSettings.riskReserveRate,
      riskReserveFen: Math.round(paidAmountFen * paymentSettings.riskReserveRate / 100),
      capturedAt: now,
    };
    order.paidAt = now;
    order.settlementStatus = 'frozen';
    order.updatedAt = now;
    createSettlementEntries(state, order);
    appendAudit(state, { type: 'payment.succeeded', actorId: input.actorId ?? order.userId, entityType: 'order', entityId: String(order.id), detail: { provider: input.provider, providerTransactionId: input.providerTransactionId, testMode: input.testMode } });
    return order;
  });
}

function makeEntriesAvailable(state: CommerceState, order: LocalCnOrder, confirmedAt: string, actorId: number | null, reason: string) {
  for (const entry of state.walletEntries) {
    if (entry.orderId !== order.id || !['pending', 'frozen'].includes(entry.status)) continue;
    entry.status = 'available';
    entry.availableAt = confirmedAt;
    entry.expectedReleaseAt = confirmedAt;
    entry.updatedAt = confirmedAt;
  }
  order.status = 'completed';
  order.confirmedAt = confirmedAt;
  order.settlementStatus = 'available';
  order.updatedAt = confirmedAt;
  appendAudit(state, { type: 'order.confirmed', actorId, entityType: 'order', entityId: String(order.id), detail: { reason } });
}

export function updateLocalCnOrderStatus(id: number, status: string, actorId: number | null = null, trackingNumber?: string, shippingCarrier?: string) {
  return mutate((state) => {
    const order = state.orders.find((entry) => entry.id === id);
    if (!order) return null;
    const now = new Date();
    order.status = status;
    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (shippingCarrier) order.shippingCarrier = shippingCarrier;
    if (status === 'paid' && order.paymentStatus !== 'paid') {
      order.paymentStatus = 'paid';
      order.paymentMode = order.paymentMethod === 'bank_transfer' ? 'manual' : order.paymentMode;
      order.paidAt = now.toISOString();
      order.settlementStatus = 'frozen';
      createSettlementEntries(state, order);
    }
    if (status === 'shipped') order.shippedAt = now.toISOString();
    if (status === 'delivered') {
      order.deliveredAt = now.toISOString();
      order.autoConfirmAt = new Date(now.getTime() + RELEASE_DAYS * 24 * 60 * 60 * 1000).toISOString();
      for (const entry of state.walletEntries) if (entry.orderId === order.id && entry.status === 'frozen') entry.expectedReleaseAt = order.autoConfirmAt;
    }
    if (status === 'completed') makeEntriesAvailable(state, order, now.toISOString(), actorId, 'admin');
    order.updatedAt = now.toISOString();
    appendAudit(state, { type: 'order.status_changed', actorId, entityType: 'order', entityId: String(order.id), detail: { status, trackingNumber: trackingNumber || '', shippingCarrier: shippingCarrier || '' } });
    return order;
  });
}

export function confirmLocalCnOrder(id: number, userId: number) {
  return mutate((state) => {
    const order = state.orders.find((entry) => entry.id === id);
    if (!order) return null;
    if (order.userId !== userId) throw new Error('无权确认该订单');
    if (order.confirmedAt) return order;
    if (order.status !== 'delivered') throw new Error('物流送达后才能确认收货');
    makeEntriesAvailable(state, order, new Date().toISOString(), userId, 'member');
    return order;
  });
}

export function closeLocalCnOrderPayment(id: number, input: { provider: string; eventId: string; testMode: boolean; actorId?: number | null }) {
  return mutate((state) => {
    const order = state.orders.find((entry) => entry.id === id);
    if (!order) return null;
    if (['paid', 'partially_refunded', 'refunded'].includes(order.paymentStatus)) throw new Error('已付款订单不可关闭');
    const key = `payment-close:${input.provider}:${input.eventId}`;
    if (state.paymentEvents.some((event) => event.idempotencyKey === key)) return order;
    const now = new Date().toISOString();
    state.paymentEvents.push({ id: `PE-${Date.now()}-${state.paymentEvents.length + 1}`, idempotencyKey: key, orderId: order.id, provider: input.provider, providerTransactionId: '', eventType: 'payment.closed', verified: true, testMode: input.testMode, payloadDigest: '', createdAt: now });
    order.paymentStatus = 'failed';
    order.status = 'cancelled';
    order.updatedAt = now;
    appendAudit(state, { type: 'payment.closed', actorId: input.actorId ?? order.userId, entityType: 'order', entityId: String(order.id), detail: { provider: input.provider, testMode: input.testMode } });
    return order;
  });
}

function applyRefund(state: CommerceState, order: LocalCnOrder, refundAmountFen: number, actorId: number | null, eventKey: string) {
  const totalFen = order.paidAmountFen || Math.round(Number(order.totalAmount) * 100);
  const previousRefundedFen = Number(order.refundedAmountFen || 0);
  if (!Number.isInteger(refundAmountFen) || refundAmountFen <= 0 || previousRefundedFen + refundAmountFen > totalFen) throw new Error('退款金额不正确或超过可退金额');
  const refundAmount = refundAmountFen / 100;
  const now = new Date().toISOString();
  const cumulativeRefundedFen = previousRefundedFen + refundAmountFen;
  const fullRefund = cumulativeRefundedFen >= totalFen;
  order.refundedAmountFen = cumulativeRefundedFen;
  order.paymentStatus = fullRefund ? 'refunded' : 'partially_refunded';
  order.status = fullRefund ? 'refunded' : order.status;
  order.refundedAt = now;
  if (!order.confirmedAt) {
    if (fullRefund) {
      for (const entry of state.walletEntries) if (entry.orderId === order.id && ['pending', 'frozen'].includes(entry.status)) { entry.status = 'cancelled'; entry.updatedAt = now; }
      order.settlementStatus = 'cancelled';
    }
  } else {
    const ratio = refundAmountFen / totalFen;
    const original = state.walletEntries.filter((entry) => entry.orderId === order.id && entry.amount > 0 && ['available', 'paid'].includes(entry.status));
    for (const entry of original) {
      const key = `reversal:${eventKey}:${entry.id}`;
      if (state.walletEntries.some((row) => row.idempotencyKey === key)) continue;
      state.walletEntries.push({ ...entry, id: `WE-${Date.now()}-${state.walletEntries.length + 1}`, idempotencyKey: key, amount: -roundMoney(entry.amount * ratio), status: 'reversal', expectedReleaseAt: null, availableAt: now, createdAt: now, updatedAt: now });
    }
    order.settlementStatus = 'reversed';
  }
  order.updatedAt = now;
  appendAudit(state, { type: 'order.refunded', actorId, entityType: 'order', entityId: String(order.id), detail: { amount: refundAmount, refundedAmountFen: cumulativeRefundedFen, paymentStatus: order.paymentStatus, eventKey } });
  return order;
}

export function recordRefundRequested(input: { orderId: number; provider: string; outRefundNo: string; providerRefundId?: string; amountFen: number; reason: string; testMode: boolean; actorId?: number | null }) {
  return mutate((state) => {
    const order = state.orders.find((entry) => entry.id === input.orderId);
    if (!order) throw new Error('找不到订单');
    if (!['paid', 'partially_refunded'].includes(order.paymentStatus)) throw new Error('订单尚未付款或已全额退款');
    const key = `refund-request:${input.provider}:${input.outRefundNo}`;
    const prior = state.refunds.find((refund) => refund.idempotencyKey === key);
    if (prior) return prior;
    const totalFen = order.paidAmountFen || Math.round(Number(order.totalAmount) * 100);
    const processingFen = state.refunds.filter((refund) => refund.orderId === order.id && refund.status === 'processing').reduce((sum, refund) => sum + refund.amountFen, 0);
    const remainingFen = totalFen - Number(order.refundedAmountFen || 0) - processingFen;
    if (!Number.isInteger(input.amountFen) || input.amountFen <= 0 || input.amountFen > remainingFen) throw new Error('退款金额不正确或超过可退金额');
    const now = new Date().toISOString();
    const refund: RefundRecord = { id: `RF-${Date.now()}-${state.refunds.length + 1}`, idempotencyKey: key, orderId: order.id, orderNo: order.orderNo, provider: input.provider, outRefundNo: input.outRefundNo, providerRefundId: input.providerRefundId || '', amountFen: input.amountFen, totalFen, status: input.testMode ? 'success' : 'processing', reason: input.reason, testMode: input.testMode, createdAt: now, updatedAt: now };
    state.refunds.push(refund);
    if (input.testMode) applyRefund(state, order, input.amountFen, input.actorId ?? null, key);
    appendAudit(state, { type: 'refund.requested', actorId: input.actorId ?? null, entityType: 'order', entityId: String(order.id), detail: { outRefundNo: input.outRefundNo, amountFen: input.amountFen, testMode: input.testMode } });
    return refund;
  });
}

export function recordRefundResult(input: { orderNo: string; provider: string; outRefundNo: string; providerRefundId: string; amountFen: number; status: RefundRecord['status']; eventId: string; payloadDigest?: string; actorId?: number | null }) {
  return mutate((state) => {
    const order = state.orders.find((entry) => entry.orderNo === input.orderNo);
    if (!order) throw new Error('找不到退款对应订单');
    const eventKey = `refund-result:${input.provider}:${input.eventId}`;
    if (state.paymentEvents.some((event) => event.idempotencyKey === eventKey)) return order;
    const refund = state.refunds.find((entry) => entry.outRefundNo === input.outRefundNo);
    if (!refund) throw new Error('找不到退款申请');
    if (refund.orderId !== order.id || refund.amountFen !== input.amountFen) throw new Error('退款通知与申请资料不符');
    const now = new Date().toISOString();
    refund.providerRefundId = input.providerRefundId || refund.providerRefundId;
    refund.status = input.status;
    refund.updatedAt = now;
    state.paymentEvents.push({ id: `PE-${Date.now()}-${state.paymentEvents.length + 1}`, idempotencyKey: eventKey, orderId: order.id, provider: input.provider, providerTransactionId: input.providerRefundId, eventType: `refund.${input.status}`, verified: true, testMode: false, payloadDigest: input.payloadDigest || '', amountFen: input.amountFen, createdAt: now });
    if (input.status === 'success') applyRefund(state, order, input.amountFen, input.actorId ?? null, eventKey);
    appendAudit(state, { type: `refund.${input.status}`, actorId: input.actorId ?? null, entityType: 'order', entityId: String(order.id), detail: { outRefundNo: input.outRefundNo, providerRefundId: input.providerRefundId, amountFen: input.amountFen } });
    return order;
  });
}

export function refundLocalCnOrder(id: number, amount: number, actorId: number | null = null) {
  const amountFen = Math.round(Number(amount) * 100);
  const refund = recordRefundRequested({ orderId: id, provider: 'test', outRefundNo: `PENDING-RF-${id}-${Date.now()}`, amountFen, reason: '未扣款退款记录', testMode: true, actorId });
  return getLocalCnOrder(refund.orderId);
}

export function runAutoConfirm(idempotencyKey: string, now = new Date()) {
  return mutate((state) => {
    const prior = state.jobRuns.find((run) => run.idempotencyKey === idempotencyKey);
    if (prior) return prior;
    const startedAt = new Date().toISOString();
    const confirmedOrderIds: number[] = [];
    for (const order of state.orders) {
      if (order.status !== 'delivered' || order.confirmedAt || !order.autoConfirmAt || order.paymentStatus !== 'paid') continue;
      if (new Date(order.autoConfirmAt).getTime() > now.getTime()) continue;
      makeEntriesAvailable(state, order, now.toISOString(), null, 'auto_7_days');
      confirmedOrderIds.push(order.id);
    }
    const run = { id: `JOB-${Date.now()}`, idempotencyKey, startedAt, completedAt: new Date().toISOString(), confirmedOrderIds };
    state.jobRuns.push(run);
    appendAudit(state, { type: 'job.auto_confirm', actorId: null, entityType: 'job', entityId: run.id, detail: { confirmedOrderIds } });
    return run;
  });
}

function walletSummary(state: CommerceState, userId: number) {
  const entries = state.walletEntries.filter((entry) => entry.userId === userId);
  const sum = (statuses: WalletEntryStatus[]) => roundMoney(entries.filter((entry) => statuses.includes(entry.status)).reduce((total, entry) => total + entry.amount, 0));
  const pendingWithdrawals = state.withdrawals.filter((entry) => entry.userId === userId && ['requested', 'reviewing', 'processing'].includes(entry.status)).reduce((total, entry) => total + entry.amount, 0);
  return {
    frozen: sum(['pending', 'frozen']),
    available: roundMoney(sum(['available', 'reversal', 'paid']) - pendingWithdrawals),
    withdrawing: roundMoney(pendingWithdrawals),
    paid: roundMoney(state.withdrawals.filter((entry) => entry.userId === userId && entry.status === 'paid').reduce((total, entry) => total + entry.netAmount, 0)),
    reversed: Math.abs(sum(['reversal'])),
  };
}

export function getWallet(userId: number) {
  const state = readState();
  return {
    summary: walletSummary(state, userId),
    entries: state.walletEntries.filter((entry) => entry.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    withdrawals: state.withdrawals.filter((entry) => entry.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    settings: {
      minimumAmount: 100,
      feeRate: 1,
      liveTransferEnabled: process.env.WECHAT_MERCHANT_TRANSFER_ENABLED === 'true',
      wechatTransferEnabled: process.env.WECHAT_MERCHANT_TRANSFER_ENABLED === 'true',
    },
  };
}

export function getWalletEntryDetail(userId: number, entryId: string) {
  const state = readState();
  const entry = state.walletEntries.find((item) => item.id === entryId && item.userId === userId);
  if (!entry) return null;
  const order = state.orders.find((item) => item.id === entry.orderId);
  const item = order?.items.find((row) => row.id === entry.orderItemId);
  return {
    entry,
    order: order ? {
      id: order.id,
      orderNo: order.orderNo,
      createdAt: order.createdAt,
      paymentStatus: order.paymentStatus,
      status: order.status,
      referralCode: order.referralCode || '',
      confirmedAt: order.confirmedAt || null,
      autoConfirmAt: order.autoConfirmAt || null,
    } : null,
    item: item ? {
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      ownerBrandName: item.ownerBrandName || item.brandName || '',
      referrerBrandName: item.referrerBrandName || '',
      settlementSnapshot: item.settlementSnapshot || {},
      referralRuleSnapshot: item.referralRuleSnapshot || null,
    } : null,
  };
}

export function requestWithdrawal(userId: number, input: { method: string; realName: string; account: string; amount: number }) {
  return mutate((state) => {
    if (input.method && input.method !== 'wechat_wallet') throw new Error('目前仅支持提现至微信钱包');
    const method = 'wechat_wallet' as const;
    const amount = roundMoney(Number(input.amount));
    if (!input.realName.trim()) throw new Error('请填写实名姓名');
    if (!Number.isFinite(amount) || amount < 100) throw new Error('最低提现金额为 ¥100');
    const summary = walletSummary(state, userId);
    if (amount > summary.available) throw new Error('可提现余额不足');
    const now = new Date().toISOString();
    const fee = roundMoney(amount * 0.01);
    const account = '当前微信帐号';
    const note = '待平台审核；商家转账启用后，由当前微信帐号确认收款';
    const withdrawal: WithdrawalRequest = { id: `WD-${Date.now()}`, userId, method, realName: input.realName.trim(), account, amount, fee, netAmount: roundMoney(amount - fee), status: 'requested', note, providerTransactionId: '', createdAt: now, updatedAt: now };
    state.withdrawals.unshift(withdrawal);
    appendAudit(state, { type: 'withdrawal.requested', actorId: userId, entityType: 'withdrawal', entityId: withdrawal.id, detail: { method, amount, fee } });
    return withdrawal;
  });
}

export function listFinanceRecords() {
  const state = readState();
  const enrichedOrders = state.orders.map((o) => enrichOrderReconciliation(o));
  return { orders: enrichedOrders, reconciliation: buildWechatReconciliationSummary(enrichedOrders), withdrawals: state.withdrawals, refunds: state.refunds.slice().reverse(), walletEntries: state.walletEntries, paymentEvents: state.paymentEvents, auditEvents: state.auditEvents.slice(-200).reverse(), jobRuns: state.jobRuns.slice(-50).reverse() };
}

export function updateWithdrawal(id: string, status: WithdrawalStatus, input: { note?: string; providerTransactionId?: string; actorId?: number | null }) {
  return mutate((state) => {
    const withdrawal = state.withdrawals.find((entry) => entry.id === id);
    if (!withdrawal) return null;
    const allowed: Record<WithdrawalStatus, WithdrawalStatus[]> = { requested: ['reviewing', 'rejected'], reviewing: ['processing', 'rejected'], processing: ['paid', 'failed'], paid: [], failed: ['processing', 'rejected'], rejected: [] };
    if (!allowed[withdrawal.status].includes(status)) throw new Error(`不可从 ${withdrawal.status} 变更为 ${status}`);
    if (status === 'paid' && !String(input.providerTransactionId || '').trim()) throw new Error('标记已支付前必须填写第三方交易号');
    withdrawal.status = status;
    withdrawal.note = String(input.note || withdrawal.note || '');
    withdrawal.providerTransactionId = String(input.providerTransactionId || withdrawal.providerTransactionId || '');
    withdrawal.updatedAt = new Date().toISOString();
    if (status === 'paid') {
      const key = `withdrawal:${withdrawal.id}`;
      if (!state.walletEntries.some((entry) => entry.idempotencyKey === key)) state.walletEntries.push({ id: `WE-${Date.now()}-${state.walletEntries.length + 1}`, idempotencyKey: key, userId: withdrawal.userId, orderId: 0, orderNo: withdrawal.id, orderItemId: 0, productId: 0, productName: '会员提现', sourceType: 'withdrawal', ruleSnapshot: { fee: withdrawal.fee, method: withdrawal.method }, amount: -withdrawal.amount, status: 'paid', expectedReleaseAt: null, availableAt: withdrawal.updatedAt, createdAt: withdrawal.updatedAt, updatedAt: withdrawal.updatedAt });
    }
    appendAudit(state, { type: `withdrawal.${status}`, actorId: input.actorId ?? null, entityType: 'withdrawal', entityId: withdrawal.id, detail: { providerTransactionId: withdrawal.providerTransactionId, note: withdrawal.note } });
    return withdrawal;
  });
}

export function listPartnerships(brandId?: number) {
  const state = readState();
  return state.partnerships.filter((entry) => !brandId || entry.referrerBrandId === brandId || entry.ownerBrandId === brandId);
}

export function updatePartnership(id: string, updates: Partial<BrandPartnership>, actorId: number | null) {
  return mutate((state) => {
    const partnership = state.partnerships.find((entry) => entry.id === id);
    if (!partnership) return null;
    Object.assign(partnership, updates, { id: partnership.id, updatedAt: new Date().toISOString() });
    appendAudit(state, { type: 'partnership.updated', actorId, entityType: 'partnership', entityId: id, detail: updates as Record<string, unknown> });
    return partnership;
  });
}

export function createPartnership(input: Omit<BrandPartnership, 'id' | 'createdAt' | 'updatedAt'>, actorId: number | null) {
  return mutate((state) => {
    if (!input.referrerBrandId || !input.ownerBrandId) throw new Error('请确认推荐品牌与商品品牌');
    if (input.referrerBrandId === input.ownerBrandId) throw new Error('推荐品牌与商品品牌不可相同');
    if (input.rewardType === 'rate' && (!Number.isFinite(input.rewardRate) || input.rewardRate < 0 || input.rewardRate > 100)) throw new Error('品牌推荐分润比例必须介于 0% 至 100%');
    if (input.rewardType === 'fixed' && (!Number.isFinite(input.rewardFixedAmount) || input.rewardFixedAmount < 0)) throw new Error('固定分润金额不可小于 0');
    const duplicate = state.partnerships.find((entry) => entry.referrerBrandId === input.referrerBrandId && entry.ownerBrandId === input.ownerBrandId && ['pending', 'active'].includes(entry.status));
    if (duplicate) throw new Error('这两个品牌已有待审核或生效中的合作');
    const now = new Date().toISOString();
    const partnership: BrandPartnership = { ...input, id: `BP-${Date.now()}`, createdAt: now, updatedAt: now };
    state.partnerships.unshift(partnership);
    appendAudit(state, { type: 'partnership.created', actorId, entityType: 'partnership', entityId: partnership.id, detail: { referrerBrandId: partnership.referrerBrandId, ownerBrandId: partnership.ownerBrandId } });
    return partnership;
  });
}

export function acceptPartnership(id: string, brandId: number) {
  return mutate((state) => {
    const partnership = state.partnerships.find((entry) => entry.id === id);
    if (!partnership) return null;
    const now = new Date().toISOString();
    if (partnership.referrerBrandId === brandId) partnership.referrerAcceptedAt = now;
    else if (partnership.ownerBrandId === brandId) partnership.ownerAcceptedAt = now;
    else throw new Error('该品牌不是合作参与方');
    if (partnership.referrerAcceptedAt && partnership.ownerAcceptedAt && partnership.platformReviewedAt && partnership.status === 'pending') partnership.status = 'active';
    partnership.updatedAt = now;
    appendAudit(state, { type: 'partnership.accepted', actorId: brandId, entityType: 'partnership', entityId: id, detail: { brandId } });
    return partnership;
  });
}

export function listCuratedProducts(referrerBrandId: number) {
  const state = readState();
  const now = Date.now();
  return state.curatedProducts
    .filter((entry) => entry.referrerBrandId === referrerBrandId && entry.enabled)
    .map((entry) => ({ entry, partnership: state.partnerships.find((row) => row.id === entry.partnershipId), product: productById(entry.productId) }))
    .filter((row) => row.partnership && isPartnershipActive(row.partnership, now) && row.product)
    .sort((a, b) => a.entry.sortOrder - b.entry.sortOrder);
}

export function saveCuratedProduct(input: Omit<BrandCuratedProduct, 'id' | 'createdAt' | 'updatedAt'>, actorId: number | null) {
  return mutate((state) => {
    const partnership = state.partnerships.find((entry) => entry.id === input.partnershipId);
    if (!partnership || !isPartnershipActive(partnership) || partnership.referrerBrandId !== input.referrerBrandId || partnership.ownerBrandId !== productById(input.productId)?.supplierId) throw new Error('合作尚未生效或商品未获授权');
    const now = new Date().toISOString();
    const existing = state.curatedProducts.find((entry) => entry.partnershipId === input.partnershipId && entry.productId === input.productId && entry.referrerBrandId === input.referrerBrandId);
    const result = existing ? Object.assign(existing, input, { updatedAt: now }) : { ...input, id: `BCP-${Date.now()}`, createdAt: now, updatedAt: now };
    if (!existing) state.curatedProducts.push(result);
    appendAudit(state, { type: 'curated_product.saved', actorId, entityType: 'curated_product', entityId: result.id, detail: { partnershipId: result.partnershipId, productId: result.productId } });
    return result;
  });
}

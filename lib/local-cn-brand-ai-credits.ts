import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import type { SessionUser } from './auth';

export type BrandAiServiceCode = 'ai_brand_page_full' | 'ai_copy_regenerate' | 'ai_image_generate';
export type BrandAiUsageStatus = 'reserved' | 'succeeded' | 'refunded' | 'failed';
export type BrandAiProviderUsage = {
  providerRequestId: string;
  provider: string;
  region: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  pricingTier: string;
  rawUsage?: unknown;
};

export type BrandAiImageUsage = {
  providerRequestId: string;
  provider: string;
  region: string;
  model: string;
  successCount: number;
  failedCount: number;
  rawUsage?: unknown;
};

export type BrandAiPriceSnapshot = {
  provider: string;
  region: string;
  model: string;
  billingMetric: 'token' | 'image';
  effectiveAt: string;
  officialCurrency: string;
  officialUnitCostMicros: number;
  unitSize: number;
  pricingTier: string;
};

export type BrandAiExchangeRateSnapshot = {
  source: string;
  baseCurrency: string;
  quoteCurrency: 'CNY';
  rateMicros: number;
  capturedAt: string;
};

export type BrandAiBillingAdjustment = {
  id: string;
  officialBillId: string;
  period: string;
  amountMicrosCny: number;
  reason: string;
  createdAt: string;
};

export type BrandAiService = {
  code: BrandAiServiceCode;
  name: string;
  billingUnit: string;
  officialCurrency: string;
  officialUnitCost: number | null;
  exchangeRateToCny: number | null;
  exchangeRateUpdatedAt: string | null;
  exchangeRateSource: string | null;
  priceEffectiveAt: string | null;
  provider: string;
  region: string;
  model: string;
  billingMetric: 'token' | 'image';
  unitSize: number;
  pricingTier: string;
  platformServiceFeeCny: 0;
  enabled: boolean;
  description: string;
  updatedAt: string;
};

export type BrandAiAccount = {
  brandId: number;
  balanceCny: number;
  reservedCny: number;
  balanceMicrosCny: number;
  reservedMicrosCny: number;
  updatedAt: string;
};

export type BrandAiUsage = {
  id: string;
  brandId: number;
  userId: number;
  serviceCode: BrandAiServiceCode;
  serviceName: string;
  billingUnit: string;
  officialCurrency: string;
  officialUnitCost: number;
  exchangeRateToCny: number;
  exchangeRateUpdatedAt: string;
  exchangeRateSnapshot: BrandAiExchangeRateSnapshot;
  priceSnapshot: BrandAiPriceSnapshot;
  providerUsage: BrandAiProviderUsage | null;
  imageUsage: BrandAiImageUsage | null;
  officialCostCny: number;
  officialCostMicrosCny: number;
  platformServiceFeeCny: 0;
  quantity: number;
  estimatedDebitCny: number;
  estimatedDebitMicrosCny: number;
  actualDebitCny: number;
  actualDebitMicrosCny: number;
  reservedRefundMicrosCny: number;
  reconciliationStatus: 'pending' | 'matched' | 'adjusted';
  officialBillId: string;
  billingAdjustments: BrandAiBillingAdjustment[];
  status: BrandAiUsageStatus;
  operationLabel: string;
  idempotencyKey: string;
  requestedAt: string;
  confirmedAt: string;
  completedAt: string | null;
  refundReason: string;
};

export type BrandAiTopUp = {
  id: string;
  brandId: number;
  amountCny: number;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  provider: string;
  createdAt: string;
  completedAt: string | null;
};

type BrandAiCreditState = {
  schemaVersion: 1;
  revision: number;
  services: BrandAiService[];
  accounts: BrandAiAccount[];
  usages: BrandAiUsage[];
  topUps: BrandAiTopUp[];
};

const DEFAULT_SERVICES: BrandAiService[] = [
  {
    code: 'ai_brand_page_full',
    name: 'AI 生成整页',
    billingUnit: '千 Token',
    officialCurrency: 'CNY',
    officialUnitCost: 0.004,
    exchangeRateToCny: 1,
    exchangeRateUpdatedAt: '2026-10-25T00:00:00.000Z',
    exchangeRateSource: 'CNY_OFFICIAL',
    priceEffectiveAt: '2026-10-25T00:00:00.000Z',
    provider: 'aliyun-bailian',
    region: 'cn-mainland',
    model: 'qwen-plus',
    billingMetric: 'token',
    unitSize: 1000,
    pricingTier: 'standard',
    platformServiceFeeCny: 0,
    enabled: true,
    description: '根据品牌资料生成完整品牌前页草稿；正式结算按文字实际 token 与成功图片张数汇总官方成本。',
    updatedAt: '2026-10-25T00:00:00.000Z',
  },
  {
    code: 'ai_copy_regenerate',
    name: 'AI 重新生成文案',
    billingUnit: '千 Token',
    officialCurrency: 'CNY',
    officialUnitCost: 0.004,
    exchangeRateToCny: 1,
    exchangeRateUpdatedAt: '2026-10-25T00:00:00.000Z',
    exchangeRateSource: 'CNY_OFFICIAL',
    priceEffectiveAt: '2026-10-25T00:00:00.000Z',
    provider: 'aliyun-bailian',
    region: 'cn-mainland',
    model: 'qwen-plus',
    billingMetric: 'token',
    unitSize: 1000,
    pricingTier: 'standard',
    platformServiceFeeCny: 0,
    enabled: true,
    description: '重新生成指定区块或页面文案；按阿里云文字模型实际 token 官方成本结算。',
    updatedAt: '2026-10-25T00:00:00.000Z',
  },
  {
    code: 'ai_image_generate',
    name: 'AI 生成图片',
    billingUnit: '成功生成张数',
    officialCurrency: 'CNY',
    officialUnitCost: 0.08,
    exchangeRateToCny: 1,
    exchangeRateUpdatedAt: '2026-10-25T00:00:00.000Z',
    exchangeRateSource: 'CNY_OFFICIAL',
    priceEffectiveAt: '2026-10-25T00:00:00.000Z',
    provider: 'aliyun-bailian',
    region: 'cn-mainland',
    model: 'qwen-image-3.0',
    billingMetric: 'image',
    unitSize: 1,
    pricingTier: 'standard',
    platformServiceFeeCny: 0,
    enabled: true,
    description: '生成品牌前页或商品内容可使用的图片；仅按成功生成张数结算官方成本。',
    updatedAt: '2026-10-25T00:00:00.000Z',
  },
];

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function dataFile() {
  return path.join(dataDir(), 'cn-brand-ai-credits.json');
}

function lockFile() {
  return `${dataFile()}.lock`;
}

function nowIso() {
  return new Date().toISOString();
}

function nextId(prefix: string) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

const CNY_MICROS = 1_000_000;

function toMicros(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('AI 官方成本与汇率必须是大于或等于 0 的数字');
  return Math.round(amount * CNY_MICROS);
}

function fromMicros(value: number) {
  return Math.round(value) / CNY_MICROS;
}

function money(value: unknown): number;
function money(value: unknown, allowNull: true): number | null;
function money(value: unknown, allowNull = false) {
  if (allowNull && (value === null || value === '')) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('AI 官方成本与汇率必须是大于或等于 0 的数字');
  return Math.round(amount * 10000) / 10000;
}

function normalizeService(value: unknown, fallback: BrandAiService): BrandAiService {
  const row = value && typeof value === 'object' ? value as Partial<BrandAiService> : {};
  const parsedCost = row.officialUnitCost == null ? null : money(row.officialUnitCost, true);
  const officialUnitCost = (parsedCost != null && parsedCost > 0) ? parsedCost : fallback.officialUnitCost;
  const parsedRate = row.exchangeRateToCny == null ? null : money(row.exchangeRateToCny, true);
  const exchangeRateToCny = (parsedRate != null && parsedRate > 0) ? parsedRate : (fallback.exchangeRateToCny || 7.12);
  return {
    code: fallback.code,
    name: String(row.name || fallback.name).slice(0, 60),
    billingUnit: String(row.billingUnit || fallback.billingUnit).slice(0, 20),
    officialCurrency: String(row.officialCurrency || fallback.officialCurrency || 'CNY').slice(0, 12),
    officialUnitCost,
    exchangeRateToCny,
    exchangeRateUpdatedAt: String(row.exchangeRateUpdatedAt || fallback.exchangeRateUpdatedAt || '2026-10-29T00:00:00.000Z').slice(0, 40),
    exchangeRateSource: String(row.exchangeRateSource || fallback.exchangeRateSource || 'CNY_OFFICIAL').slice(0, 80),
    priceEffectiveAt: String(row.priceEffectiveAt || fallback.priceEffectiveAt || '2026-10-29T00:00:00.000Z').slice(0, 40),
    provider: String(row.provider || fallback.provider || 'aliyun-bailian').slice(0, 80),
    region: String(row.region || fallback.region || 'cn-mainland').slice(0, 80),
    model: String(row.model || fallback.model || 'qwen-plus').slice(0, 120),
    billingMetric: row.billingMetric === 'image' ? 'image' : 'token',
    unitSize: Math.max(1, Math.round(Number(row.unitSize || fallback.unitSize || 1))),
    pricingTier: String(row.pricingTier || fallback.pricingTier || 'standard').slice(0, 80),
    platformServiceFeeCny: 0,
    enabled: true,
    description: String(row.description || fallback.description).slice(0, 240),
    updatedAt: String(row.updatedAt || fallback.updatedAt || nowIso()),
  };
}

function normalizeState(value: unknown): BrandAiCreditState {
  const parsed = value && typeof value === 'object' ? value as Partial<BrandAiCreditState> : {};
  const savedServices = Array.isArray(parsed.services) ? parsed.services : [];
  return {
    schemaVersion: 1,
    revision: Number(parsed.revision || 1),
    services: DEFAULT_SERVICES.map((fallback) => normalizeService(savedServices.find((service) => (service as BrandAiService)?.code === fallback.code), fallback)),
    accounts: (Array.isArray(parsed.accounts) ? parsed.accounts.map((account) => {
      const row = account as BrandAiAccount;
      const rawMicros = Number(row.balanceMicrosCny ?? toMicros(row.balanceCny ?? 0));
      const balanceMicrosCny = rawMicros < 10_000_000 ? 500_000_000 : rawMicros;
      const reservedMicrosCny = Math.max(0, Number(row.reservedMicrosCny ?? toMicros(row.reservedCny ?? 0)));
      return {
        brandId: Number(row.brandId),
        balanceMicrosCny,
        reservedMicrosCny,
        balanceCny: fromMicros(balanceMicrosCny),
        reservedCny: fromMicros(reservedMicrosCny),
        updatedAt: String(row.updatedAt || nowIso()),
      };
    }) : []).filter((account) => Number.isFinite(account.brandId)),
    usages: Array.isArray(parsed.usages) ? parsed.usages as BrandAiUsage[] : [],
    topUps: Array.isArray(parsed.topUps) ? parsed.topUps as BrandAiTopUp[] : [],
  };
}

function readState(): BrandAiCreditState {
  if (!existsSync(dataFile())) return normalizeState({});
  try {
    return normalizeState(JSON.parse(readFileSync(dataFile(), 'utf8')));
  } catch {
    return normalizeState({});
  }
}

function writeState(state: BrandAiCreditState) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${dataFile()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...state, revision: state.revision + 1 }, null, 2));
  renameSync(temporary, dataFile());
}

function withWrite<T>(operation: (state: BrandAiCreditState) => T): T {
  mkdirSync(dataDir(), { recursive: true });
  let descriptor: number | null = null;
  const deadline = Date.now() + 3000;
  while (descriptor === null) {
    try {
      descriptor = openSync(lockFile(), 'wx');
    } catch (error: any) {
      if (error?.code !== 'EEXIST' || Date.now() > deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try {
    const state = readState();
    const result = operation(state);
    writeState(state);
    return result;
  } finally {
    closeSync(descriptor);
    rmSync(lockFile(), { force: true });
  }
}

function accountFor(state: BrandAiCreditState, brandId: number) {
  let account = state.accounts.find((row) => row.brandId === brandId);
  if (!account) {
    account = { brandId, balanceCny: 500, reservedCny: 0, balanceMicrosCny: 500_000_000, reservedMicrosCny: 0, updatedAt: nowIso() };
    state.accounts.push(account);
  } else if (account.balanceMicrosCny < 10_000_000) {
    account.balanceMicrosCny = 500_000_000;
    account.balanceCny = 500;
  }
  return account;
}

function publicAccount(account: BrandAiAccount) {
  return {
    ...account,
    balanceCny: fromMicros(account.balanceMicrosCny),
    reservedCny: fromMicros(account.reservedMicrosCny),
    availableCny: fromMicros(Math.max(0, account.balanceMicrosCny - account.reservedMicrosCny)),
  };
}

function priceSnapshot(service: BrandAiService): BrandAiPriceSnapshot {
  return {
    provider: service.provider,
    region: service.region,
    model: service.model,
    billingMetric: service.billingMetric,
    effectiveAt: service.priceEffectiveAt || service.updatedAt || nowIso(),
    officialCurrency: service.officialCurrency,
    officialUnitCostMicros: toMicros(service.officialUnitCost || 0),
    unitSize: service.unitSize || 1,
    pricingTier: service.pricingTier || 'standard',
  };
}

function exchangeSnapshot(service: BrandAiService): BrandAiExchangeRateSnapshot {
  return {
    source: service.exchangeRateSource || 'platform-config',
    baseCurrency: service.officialCurrency,
    quoteCurrency: 'CNY',
    rateMicros: toMicros(service.officialCurrency === 'CNY' ? 1 : service.exchangeRateToCny || 0),
    capturedAt: service.exchangeRateUpdatedAt || nowIso(),
  };
}

export function getBrandAiCreditSummary(brandId: number) {
  const state = readState();
  const account = state.accounts.find((row) => row.brandId === brandId) || { brandId, balanceCny: 500, reservedCny: 0, balanceMicrosCny: 500_000_000, reservedMicrosCny: 0, updatedAt: nowIso() };
  return {
    account: publicAccount(account),
    services: state.services,
    topUps: state.topUps.filter((row) => row.brandId === brandId).slice(0, 50),
    usages: state.usages.filter((row) => row.brandId === brandId).slice(0, 80),
    recharge: {
      enabled: true,
      status: 'subsidized_ready',
      message: '✅ 系统已就绪（平台推广期已为您赠送 ¥500.00 品牌 AI 视觉与页面生成体验额度，平台服务费 ¥0）。',
    },
    policy: {
      platformMarkup: false,
      platformServiceFeeCny: 0,
      formalBillingEnabled: false,
      message: '平台不以 AI 功能获利；按阿里云 AI 实际成功用量官方成本原价代收代付，平台服务费 ¥0。',
    },
  };
}

export function configureBrandAiService(user: SessionUser, input: Record<string, unknown>) {
  const serviceCode = String(input.serviceCode || input.code || '') as BrandAiServiceCode;
  if (!DEFAULT_SERVICES.some((service) => service.code === serviceCode)) throw new Error('AI 服务项目不存在');
  return withWrite((state) => {
    const service = state.services.find((row) => row.code === serviceCode);
    if (!service) throw new Error('AI 服务项目不存在');
    service.officialUnitCost = money(input.officialUnitCost, true);
    service.officialCurrency = String(input.officialCurrency || service.officialCurrency || 'CNY').slice(0, 12);
    service.exchangeRateToCny = money(input.exchangeRateToCny, true);
    service.exchangeRateUpdatedAt = input.exchangeRateUpdatedAt ? String(input.exchangeRateUpdatedAt).slice(0, 40) : nowIso();
    service.exchangeRateSource = input.exchangeRateSource ? String(input.exchangeRateSource).slice(0, 80) : 'platform-config';
    service.priceEffectiveAt = input.effectiveAt ? String(input.effectiveAt).slice(0, 40) : input.priceEffectiveAt ? String(input.priceEffectiveAt).slice(0, 40) : nowIso();
    service.provider = String(input.provider || service.provider || 'aliyun-bailian').slice(0, 80);
    service.region = String(input.region || service.region || 'cn-mainland').slice(0, 80);
    service.model = String(input.model || service.model || '').slice(0, 120);
    service.billingMetric = input.billingMetric === 'image' ? 'image' : 'token';
    service.unitSize = Math.max(1, Math.round(Number(input.unitSize || service.unitSize || 1)));
    service.pricingTier = String(input.pricingTier || service.pricingTier || 'standard').slice(0, 80);
    service.platformServiceFeeCny = 0;
    service.enabled = input.enabled === true;
    service.updatedAt = nowIso();
    state.usages.unshift({
      id: nextId('AI-AUDIT-'),
      brandId: 0,
      userId: user.id,
      serviceCode,
      serviceName: service.name,
      billingUnit: service.billingUnit,
      officialCurrency: service.officialCurrency,
      officialUnitCost: service.officialUnitCost || 0,
      exchangeRateToCny: service.exchangeRateToCny || 0,
      exchangeRateUpdatedAt: service.exchangeRateUpdatedAt || service.updatedAt,
      exchangeRateSnapshot: exchangeSnapshot(service),
      priceSnapshot: priceSnapshot(service),
      providerUsage: null,
      imageUsage: null,
      officialCostCny: 0,
      officialCostMicrosCny: 0,
      platformServiceFeeCny: 0,
      quantity: 0,
      estimatedDebitCny: 0,
      estimatedDebitMicrosCny: 0,
      actualDebitCny: 0,
      actualDebitMicrosCny: 0,
      reservedRefundMicrosCny: 0,
      reconciliationStatus: 'pending',
      officialBillId: '',
      billingAdjustments: [],
      status: 'succeeded',
      operationLabel: `平台配置 AI 官方成本代收参数：${service.name}`,
      idempotencyKey: nextId('service-config-'),
      requestedAt: service.updatedAt,
      confirmedAt: service.updatedAt,
      completedAt: service.updatedAt,
      refundReason: '',
    });
    return service;
  });
}

export function quoteBrandAiService(brandId: number, serviceCode: BrandAiServiceCode, quantity = 1) {
  const state = readState();
  const service = state.services.find((row) => row.code === serviceCode);
  const account = state.accounts.find((row) => row.brandId === brandId) || { brandId, balanceCny: 500, reservedCny: 0, balanceMicrosCny: 500_000_000, reservedMicrosCny: 0, updatedAt: nowIso() };
  const normalizedQuantity = Math.max(1, Math.round(Number(quantity) || 1));
  const availableMicrosCny = Math.max(0, account.balanceMicrosCny - account.reservedMicrosCny);
  const exchangeRate = service?.officialCurrency === 'CNY' ? 1 : service?.exchangeRateToCny;
  const estimatedDebitMicrosCny = service?.officialUnitCost == null || exchangeRate == null ? null : Math.ceil(toMicros(service.officialUnitCost) * toMicros(exchangeRate) / CNY_MICROS * normalizedQuantity / Math.max(1, service.unitSize || 1));
  const estimatedOfficialCostCny = estimatedDebitMicrosCny == null ? null : fromMicros(estimatedDebitMicrosCny);
  const estimatedDebitCny = estimatedDebitMicrosCny == null ? null : fromMicros(estimatedDebitMicrosCny);
  const unavailableReason = !service
    ? 'AI 服务项目不存在'
    : !service.enabled || service.officialUnitCost == null || exchangeRate == null
      ? '阿里云官方成本、结算币别或汇率尚未确认，暂不能启用正式扣款。'
      : estimatedDebitMicrosCny != null && availableMicrosCny < estimatedDebitMicrosCny
        ? 'AI 余额不足；储值功能尚未开通，请联系平台处理。'
        : '';
  return {
    service,
    quantity: normalizedQuantity,
    estimatedOfficialCostCny,
    platformServiceFeeCny: 0,
    estimatedDebitMicrosCny,
    estimatedDebitCny,
    availableCny: fromMicros(availableMicrosCny),
    canConfirm: !unavailableReason,
    unavailableReason,
  };
}

export function reserveBrandAiUsage(input: {
  brandId: number;
  userId: number;
  serviceCode: BrandAiServiceCode;
  quantity?: number;
  operationLabel: string;
  idempotencyKey?: string;
  allowInternalTest?: boolean;
}) {
  return withWrite((state) => {
    const quote = quoteFromState(state, input.brandId, input.serviceCode, input.quantity || 1);
    const internallyAllowed = input.allowInternalTest === true && quote.service?.enabled && quote.service.officialUnitCost != null && quote.estimatedDebitMicrosCny != null;
    if ((!quote.canConfirm && !internallyAllowed) || !quote.service || quote.estimatedDebitMicrosCny == null || quote.service.officialUnitCost == null) {
      throw new Error(quote.unavailableReason || 'AI 余额无法扣款');
    }
    const duplicateKey = input.idempotencyKey || nextId('ai-op-');
    const existing = state.usages.find((row) => row.brandId === input.brandId && row.idempotencyKey === duplicateKey && row.status === 'reserved');
    if (existing) return existing;
    const account = accountFor(state, input.brandId);
    account.reservedMicrosCny += quote.estimatedDebitMicrosCny;
    account.reservedCny = fromMicros(account.reservedMicrosCny);
    account.updatedAt = nowIso();
    const usage: BrandAiUsage = {
      id: nextId('AIU-'),
      brandId: input.brandId,
      userId: input.userId,
      serviceCode: input.serviceCode,
      serviceName: quote.service.name,
      billingUnit: quote.service.billingUnit,
      officialCurrency: quote.service.officialCurrency,
      officialUnitCost: quote.service.officialUnitCost,
      exchangeRateToCny: quote.service.officialCurrency === 'CNY' ? 1 : quote.service.exchangeRateToCny || 0,
      exchangeRateUpdatedAt: quote.service.exchangeRateUpdatedAt || nowIso(),
      exchangeRateSnapshot: exchangeSnapshot(quote.service),
      priceSnapshot: priceSnapshot(quote.service),
      providerUsage: null,
      imageUsage: null,
      officialCostCny: 0,
      officialCostMicrosCny: 0,
      platformServiceFeeCny: 0,
      quantity: quote.quantity,
      estimatedDebitCny: quote.estimatedDebitCny!,
      estimatedDebitMicrosCny: quote.estimatedDebitMicrosCny,
      actualDebitCny: 0,
      actualDebitMicrosCny: 0,
      reservedRefundMicrosCny: 0,
      reconciliationStatus: 'pending',
      officialBillId: '',
      billingAdjustments: [],
      status: 'reserved',
      operationLabel: input.operationLabel,
      idempotencyKey: duplicateKey,
      requestedAt: nowIso(),
      confirmedAt: nowIso(),
      completedAt: null,
      refundReason: '',
    };
    state.usages.unshift(usage);
    return usage;
  });
}

export function completeBrandAiUsage(usageId: string, actual?: { providerUsage?: BrandAiProviderUsage; imageUsage?: BrandAiImageUsage }) {
  return settleUsage(usageId, 'succeeded', '', actual);
}

export function refundBrandAiUsage(usageId: string, reason: string) {
  return settleUsage(usageId, 'refunded', reason || 'AI 操作未完成，预扣金额已退回。');
}

export function adjustBrandAiUsageForOfficialBill(usageId: string, input: { officialBillId: string; period: string; amountCny: number; reason: string }) {
  return withWrite((state) => {
    const usage = state.usages.find((row) => row.id === usageId);
    if (!usage) throw new Error('找不到 AI 使用明细');
    const amountMicrosCny = toMicros(input.amountCny);
    const adjustment: BrandAiBillingAdjustment = {
      id: nextId('AIA-'),
      officialBillId: String(input.officialBillId || '').slice(0, 120),
      period: String(input.period || '').slice(0, 40),
      amountMicrosCny,
      reason: String(input.reason || '官方账单差额调整').slice(0, 240),
      createdAt: nowIso(),
    };
    usage.billingAdjustments = [...(usage.billingAdjustments || []), adjustment];
    usage.officialBillId = adjustment.officialBillId;
    usage.reconciliationStatus = 'adjusted';
    return usage;
  });
}

function actualUsageQuantity(usage: BrandAiUsage, actual?: { providerUsage?: BrandAiProviderUsage; imageUsage?: BrandAiImageUsage }) {
  if (actual?.imageUsage) return Math.max(0, Math.round(actual.imageUsage.successCount || 0));
  if (actual?.providerUsage) return Math.max(0, Math.round(actual.providerUsage.totalTokens || 0));
  return 0;
}

function actualCostMicros(usage: BrandAiUsage, actual?: { providerUsage?: BrandAiProviderUsage; imageUsage?: BrandAiImageUsage }) {
  const quantity = actualUsageQuantity(usage, actual);
  if (quantity <= 0) return 0;
  return Math.ceil(usage.priceSnapshot.officialUnitCostMicros * usage.exchangeRateSnapshot.rateMicros / CNY_MICROS * quantity / Math.max(1, usage.priceSnapshot.unitSize));
}

function settleUsage(usageId: string, status: 'succeeded' | 'refunded', reason: string, actual?: { providerUsage?: BrandAiProviderUsage; imageUsage?: BrandAiImageUsage }) {
  return withWrite((state) => {
    const usage = state.usages.find((row) => row.id === usageId);
    if (!usage) throw new Error('找不到 AI 使用明细');
    if (usage.status !== 'reserved') return usage;
    const account = accountFor(state, usage.brandId);
    account.reservedMicrosCny = Math.max(0, account.reservedMicrosCny - usage.estimatedDebitMicrosCny);
    if (status === 'succeeded') {
      usage.providerUsage = actual?.providerUsage || null;
      usage.imageUsage = actual?.imageUsage || null;
      usage.quantity = actualUsageQuantity(usage, actual);
      usage.officialCostMicrosCny = actualCostMicros(usage, actual);
      usage.officialCostCny = fromMicros(usage.officialCostMicrosCny);
      usage.actualDebitMicrosCny = usage.officialCostMicrosCny;
      usage.actualDebitCny = fromMicros(usage.actualDebitMicrosCny);
      usage.reservedRefundMicrosCny = Math.max(0, usage.estimatedDebitMicrosCny - usage.actualDebitMicrosCny);
      account.balanceMicrosCny = Math.max(0, account.balanceMicrosCny - usage.actualDebitMicrosCny);
    }
    if (status === 'refunded') usage.reservedRefundMicrosCny = usage.estimatedDebitMicrosCny;
    account.balanceCny = fromMicros(account.balanceMicrosCny);
    account.reservedCny = fromMicros(account.reservedMicrosCny);
    account.updatedAt = nowIso();
    usage.status = status;
    usage.completedAt = nowIso();
    usage.refundReason = status === 'refunded' ? reason : '';
    return usage;
  });
}

function quoteFromState(state: BrandAiCreditState, brandId: number, serviceCode: BrandAiServiceCode, quantity = 1) {
  const service = state.services.find((row) => row.code === serviceCode);
  const account = state.accounts.find((row) => row.brandId === brandId) || { brandId, balanceCny: 50, reservedCny: 0, balanceMicrosCny: 50_000_000, reservedMicrosCny: 0, updatedAt: nowIso() };
  const normalizedQuantity = Math.max(1, Math.round(Number(quantity) || 1));
  const availableMicrosCny = Math.max(0, account.balanceMicrosCny - account.reservedMicrosCny);
  const exchangeRate = service?.officialCurrency === 'CNY' ? 1 : service?.exchangeRateToCny;
  const estimatedDebitMicrosCny = service?.officialUnitCost == null || exchangeRate == null ? null : Math.ceil(toMicros(service.officialUnitCost) * toMicros(exchangeRate) / CNY_MICROS * normalizedQuantity / Math.max(1, service.unitSize || 1));
  const estimatedOfficialCostCny = estimatedDebitMicrosCny == null ? null : fromMicros(estimatedDebitMicrosCny);
  const estimatedDebitCny = estimatedDebitMicrosCny == null ? null : fromMicros(estimatedDebitMicrosCny);
  const unavailableReason = !service
    ? 'AI 服务项目不存在'
    : !service.enabled || service.officialUnitCost == null || exchangeRate == null
      ? '阿里云官方成本、结算币别或汇率尚未确认，暂不能启用正式扣款。'
      : estimatedDebitMicrosCny != null && availableMicrosCny < estimatedDebitMicrosCny
        ? 'AI 余额不足；储值功能尚未开通，请联系平台处理。'
        : '';
  return {
    service,
    quantity: normalizedQuantity,
    estimatedOfficialCostCny,
    platformServiceFeeCny: 0,
    estimatedDebitMicrosCny,
    estimatedDebitCny,
    availableCny: fromMicros(availableMicrosCny),
    canConfirm: !unavailableReason,
    unavailableReason,
  };
}

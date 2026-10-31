import { createHmac, timingSafeEqual } from 'crypto';
import type { SessionUser } from './auth';
import { isDbBrandPilotMemberId } from './brand-pilot-db';
import { isLocalBrandPilotMemberId } from './local-cn-brand-demo-access';
import { findLocalCnUserById } from './local-cn-users';
import { isWechatPayLiveConfigured } from './wechat-pay';

export type ChinaPaymentProvider = 'bank_transfer' | 'wechat_pay' | 'alipay';

export type PaymentProviderCapability = {
  id: ChinaPaymentProvider;
  name: string;
  channels: Array<'web' | 'h5' | 'wechat_mini'>;
  enabled: boolean;
  liveConfigured: boolean;
  testMode: boolean;
  paymentDisabled?: boolean;
  message: string;
};

function hasAll(names: string[]) {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

export function brandPilotPaymentsDisabled() {
  return process.env.CN_PILOT_PAYMENT_DISABLED === 'true' || process.env.CN_BRAND_PILOT_MODE === 'true';
}

function isPilotLikeEmail(value: unknown) {
  return /^brand-(pilot|demo)-.+@/i.test(String(value || '').trim());
}

function isPilotLikeReferralCode(value: unknown) {
  return /^RS-CN-(PILOT|DEMO)-/i.test(String(value || '').trim());
}

export function isBrandPilotSessionUser(user: SessionUser | null | undefined) {
  return Boolean(
    user?.demoAccount
    || isPilotLikeEmail(user?.email)
    || isPilotLikeReferralCode(user?.referralCode),
  );
}

export async function isBrandPilotPaymentContext(input: {
  user?: SessionUser | null;
  orderUserId?: number | null;
} = {}) {
  if (!brandPilotPaymentsDisabled()) return false;
  if (isBrandPilotSessionUser(input.user)) return true;
  const ids = new Set<number>();
  if (input.user?.id) ids.add(Number(input.user.id));
  if (input.orderUserId) ids.add(Number(input.orderUserId));
  for (const id of Array.from(ids)) {
    if (!Number.isFinite(id)) continue;
    if (process.env.DATABASE_URL) {
      if (await isDbBrandPilotMemberId(id)) return true;
      continue;
    }
    const user = findLocalCnUserById(id);
    if (isPilotLikeEmail(user?.email) || isPilotLikeReferralCode(user?.referralCode) || isLocalBrandPilotMemberId(id)) return true;
  }
  return false;
}

export function paymentCapabilities(options: { forceDisabled?: boolean } = {}): Record<ChinaPaymentProvider, PaymentProviderCapability> {
  const pilotDisabled = Boolean(options.forceDisabled);
  const wechatReady = !pilotDisabled && isWechatPayLiveConfigured();
  const alipayReady = !pilotDisabled && hasAll(['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY']);
  const disabledMessage = '品牌 Pilot 测试期间支付、分润与退款均为关闭状态，不会发生真实扣款。';
  return {
    bank_transfer: {
      id: 'bank_transfer',
      name: '银行转账',
      channels: ['web', 'h5'],
      enabled: !pilotDisabled,
      liveConfigured: !pilotDisabled,
      testMode: pilotDisabled,
      paymentDisabled: pilotDisabled,
      message: pilotDisabled ? disabledMessage : '订单建立后等待平台人工确认到账。',
    },
    wechat_pay: {
      id: 'wechat_pay',
      name: '微信支付',
      channels: ['web', 'h5', 'wechat_mini'],
      enabled: !pilotDisabled,
      liveConfigured: wechatReady,
      testMode: !wechatReady,
      paymentDisabled: pilotDisabled,
      message: pilotDisabled ? disabledMessage : wechatReady ? '微信商户参数已配置。' : '微信支付通道尚未开通，本次不会扣款。',
    },
    alipay: {
      id: 'alipay',
      name: '支付宝',
      channels: ['web', 'h5'],
      enabled: !pilotDisabled,
      liveConfigured: alipayReady,
      testMode: !alipayReady,
      paymentDisabled: pilotDisabled,
      message: pilotDisabled ? disabledMessage : alipayReady ? '支付宝商户参数已配置。' : '支付宝通道尚未开通，本次不会扣款。',
    },
  };
}

export const chinaPaymentProviders = paymentCapabilities();

export function normalizePaymentProvider(id: string) {
  if (id === 'wechat_merchant') return 'wechat_pay';
  if (id === 'alipay_merchant') return 'alipay';
  return id as ChinaPaymentProvider;
}

export function getChinaPaymentProvider(id: string) {
  return paymentCapabilities()[normalizePaymentProvider(id)] || null;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signPaymentCallback(provider: string, rawBody: string) {
  const secret = process.env[`PAYMENT_CALLBACK_SECRET_${provider.toUpperCase()}`] || process.env.PAYMENT_CALLBACK_SECRET || '';
  if (!secret) return '';
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyPaymentCallback(provider: string, rawBody: string, signature: string) {
  const expected = signPaymentCallback(provider, rawBody);
  return Boolean(expected && signature && safeEqual(expected, signature));
}

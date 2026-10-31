import {
  constants,
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
} from 'crypto';
import { readFileSync } from 'fs';

const API_HOST = 'https://api.mch.weixin.qq.com';

export const WECHAT_PAY_SETTLEMENT_INFO = {
  mchId: "1118445617",
  merchantName: "苏州糙米量子科技有限公司",
  bankName: "农业银行对公账户（尾号 8694）",
  settlementTarget: "商户号 1118445617（苏州糙米量子）→ 农业银行对公账户（尾号 8694）",
} as const;

export type WechatPayTransaction = {
  appid: string;
  mchid: string;
  out_trade_no: string;
  transaction_id: string;
  trade_state: string;
  trade_state_desc?: string;
  trade_type?: string;
  bank_type?: string;
  success_time?: string;
  amount: { total: number; payer_total?: number; currency: string; payer_currency?: string };
  payer?: { openid?: string };
  attach?: string;
};

export type WechatPayRefund = {
  refund_id: string;
  out_refund_no: string;
  transaction_id?: string;
  out_trade_no: string;
  channel?: string;
  user_received_account?: string;
  success_time?: string;
  create_time?: string;
  status: 'SUCCESS' | 'CLOSED' | 'PROCESSING' | 'ABNORMAL';
  amount: { total: number; refund: number; payer_total?: number; payer_refund?: number; currency: string };
};

type WechatPayConfig = {
  appId: string;
  mchId: string;
  apiV3Key: string;
  merchantSerial: string;
  merchantPrivateKey: string;
  notifyUrl: string;
  refundNotifyUrl: string;
  publicKeyId: string;
  publicKey: string;
};

function envText(name: string) {
  const file = String(process.env[`${name}_FILE`] || '').trim();
  if (file) return readFileSync(file, 'utf8').trim().replace(/^["']|["']$/g, '');
  return String(process.env[name] || '').trim().replace(/^["']|["']$/g, '');
}

function pem(name: string) {
  return envText(name).replace(/\\n/g, '\n');
}

export function wechatPayConfig(): WechatPayConfig {
  const config = {
    appId: envText('WECHAT_MINI_APP_ID'),
    mchId: envText('WECHAT_PAY_MCH_ID'),
    apiV3Key: envText('WECHAT_PAY_API_V3_KEY'),
    merchantSerial: envText('WECHAT_PAY_CERT_SERIAL_NO') || envText('WECHAT_PAY_CERT_SERIAL'),
    merchantPrivateKey: pem('WECHAT_PAY_PRIVATE_KEY'),
    notifyUrl: envText('WECHAT_PAY_NOTIFY_URL'),
    refundNotifyUrl: envText('WECHAT_PAY_REFUND_NOTIFY_URL') || envText('WECHAT_PAY_NOTIFY_URL'),
    publicKeyId: envText('WECHAT_PAY_PUBLIC_KEY_ID'),
    publicKey: pem('WECHAT_PAY_PUBLIC_KEY'),
  };
  const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`微信支付尚缺正式配置：${missing.join(', ')}`);
  if (Buffer.byteLength(config.apiV3Key, 'utf8') !== 32) throw new Error('WECHAT_PAY_API_V3_KEY 必须是 32 字节');
  return config;
}

export function isWechatPayLiveConfigured() {
  try { wechatPayConfig(); return true; } catch { return false; }
}

function nonce() {
  return randomBytes(16).toString('hex');
}

function rsaSign(message: string, privateKey: string) {
  const signer = createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  return signer.sign({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, 'base64');
}

function rsaVerify(message: string, signature: string, publicKey: string) {
  const verifier = createVerify('RSA-SHA256');
  verifier.update(message);
  verifier.end();
  return verifier.verify({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, signature, 'base64');
}

function canonicalPath(url: URL) {
  return `${url.pathname}${url.search}`;
}

function authorization(method: string, url: URL, body: string, config: WechatPayConfig) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = nonce();
  const message = `${method}\n${canonicalPath(url)}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signature = rsaSign(message, config.merchantPrivateKey);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.merchantSerial}"`;
}

function verifyWechatResponse(response: Response, rawBody: string, config: WechatPayConfig) {
  const timestamp = response.headers.get('wechatpay-timestamp') || '';
  const nonceStr = response.headers.get('wechatpay-nonce') || '';
  const signature = response.headers.get('wechatpay-signature') || '';
  const serial = response.headers.get('wechatpay-serial') || '';
  if (!timestamp || !nonceStr || !signature || !serial) throw new Error('微信支付响应缺少验签资料');
  if (serial !== config.publicKeyId) throw new Error('微信支付响应公钥 ID 与服务器配置不一致');
  if (!rsaVerify(`${timestamp}\n${nonceStr}\n${rawBody}\n`, signature, config.publicKey)) throw new Error('微信支付响应验签失败');
}

async function callWechatPay<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
  const config = wechatPayConfig();
  const url = new URL(path, API_HOST);
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'zh-CN',
      'Content-Type': 'application/json',
      'User-Agent': 'rich-smart-cn/1.0',
      Authorization: authorization(method, url, body, config),
    },
    body: method === 'POST' ? body : undefined,
  });
  const rawBody = await response.text();
  verifyWechatResponse(response, rawBody, config);
  let result: any = {};
  try { result = rawBody ? JSON.parse(rawBody) : {}; } catch { throw new Error('微信支付返回了无法识别的资料'); }
  if (!response.ok) {
    const err = new Error(result.message || result.code || `微信支付请求失败 (${response.status})`) as Error & { code?: string; status?: number };
    err.code = String(result.code || '');
    err.status = response.status;
    throw err;
  }
  return result as T;
}

export function yuanToFen(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('订单金额不正确');
  return Math.round(amount * 100);
}

export async function createWechatMiniProgramPayment(input: {
  orderNo: string;
  description: string;
  amountFen: number;
  openId: string;
  attach?: string;
}) {
  const config = wechatPayConfig();
  const result = await callWechatPay<{ prepay_id: string }>('POST', '/v3/pay/transactions/jsapi', {
    appid: config.appId,
    mchid: config.mchId,
    description: input.description.slice(0, 127),
    out_trade_no: input.orderNo.slice(0, 32),
    notify_url: config.notifyUrl,
    attach: String(input.attach || '').slice(0, 128),
    amount: { total: input.amountFen, currency: 'CNY' },
    payer: { openid: input.openId },
  });
  if (!result.prepay_id) throw new Error('微信支付未返回 prepay_id');
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = nonce();
  const packageValue = `prepay_id=${result.prepay_id}`;
  const paySign = rsaSign(`${config.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`, config.merchantPrivateKey);
  return { timeStamp, nonceStr, package: packageValue, signType: 'RSA' as const, paySign };
}

/** Native 支付 (扫码)：返回 code_url，用于 Web / H5 生成二维码。appid 可用 WECHAT_PAY_NATIVE_APP_ID 覆盖，默认使用小程序 appid。 */
export function wechatNativeAppIds() {
  const ids = [envText('WECHAT_PAY_NATIVE_APP_ID'), wechatPayConfig().appId, envText('WECHAT_OFFICIAL_APP_ID')].filter(Boolean);
  return Array.from(new Set(ids));
}

export function isAppIdMchIdNotMatch(error: unknown) {
  const e = error as { code?: string; message?: string } | null;
  return Boolean(e && (e.code === 'APPID_MCHID_NOT_MATCH' || String(e.message || '').includes('APPID_MCHID_NOT_MATCH') || String(e.message || '').includes('appid和mch_id不匹配')));
}

export async function createWechatNativePayment(input: {
  orderNo: string;
  description: string;
  amountFen: number;
  attach?: string;
  timeExpire?: Date;
}) {
  const config = wechatPayConfig();
  const payload: Record<string, unknown> = {
    appid: '',
    mchid: config.mchId,
    description: input.description.slice(0, 127),
    out_trade_no: input.orderNo.slice(0, 32),
    notify_url: config.notifyUrl,
    attach: String(input.attach || '').slice(0, 128),
    amount: { total: input.amountFen, currency: 'CNY' },
  };
  if (input.timeExpire) payload.time_expire = input.timeExpire.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  let lastError: unknown;
  // 依次尝试 WECHAT_PAY_NATIVE_APP_ID → WECHAT_MINI_APP_ID → WECHAT_OFFICIAL_APP_ID，哪个先完成商户号授权就用哪个
  for (const appid of wechatNativeAppIds()) {
    try {
      const result = await callWechatPay<{ code_url: string }>('POST', '/v3/pay/transactions/native', { ...payload, appid });
      if (!result.code_url) throw new Error('微信支付未返回 code_url');
      return { codeUrl: result.code_url, appId: appid };
    } catch (error) {
      lastError = error;
      if (!isAppIdMchIdNotMatch(error)) throw error;
    }
  }
  throw lastError;
}

export async function queryWechatPayment(orderNo: string) {
  const config = wechatPayConfig();
  return callWechatPay<WechatPayTransaction>('GET', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(config.mchId)}`);
}

export async function queryWechatPaymentByTransactionId(transactionId: string) {
  const config = wechatPayConfig();
  return callWechatPay<WechatPayTransaction>('GET', `/v3/pay/transactions/id/${encodeURIComponent(transactionId)}?mchid=${encodeURIComponent(config.mchId)}`);
}

export async function closeWechatPayment(orderNo: string) {
  const config = wechatPayConfig();
  await callWechatPay<Record<string, never>>('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}/close`, { mchid: config.mchId });
}

export async function createWechatRefund(input: { orderNo: string; outRefundNo: string; amountFen: number; totalFen: number; reason: string }) {
  const config = wechatPayConfig();
  return callWechatPay<WechatPayRefund>('POST', '/v3/refund/domestic/refunds', {
    out_trade_no: input.orderNo,
    out_refund_no: input.outRefundNo.slice(0, 64),
    reason: input.reason.slice(0, 80),
    notify_url: config.refundNotifyUrl,
    amount: { refund: input.amountFen, total: input.totalFen, currency: 'CNY' },
  });
}

export async function queryWechatRefund(outRefundNo: string) {
  return callWechatPay<WechatPayRefund>('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`);
}

export function verifyWechatPayNotification(rawBody: string, headers: Headers) {
  const config = wechatPayConfig();
  const timestamp = headers.get('wechatpay-timestamp') || '';
  const nonceStr = headers.get('wechatpay-nonce') || '';
  const signature = headers.get('wechatpay-signature') || '';
  const serial = headers.get('wechatpay-serial') || '';
  if (!timestamp || !nonceStr || !signature || !serial) throw new Error('微信支付回调缺少验签资料');
  if (serial !== config.publicKeyId) throw new Error('微信支付回调公钥 ID 不符');
  const time = Number(timestamp);
  if (!Number.isFinite(time) || Math.abs(Date.now() / 1000 - time) > 300) throw new Error('微信支付回调时间已失效');
  if (!rsaVerify(`${timestamp}\n${nonceStr}\n${rawBody}\n`, signature, config.publicKey)) throw new Error('微信支付回调验签失败');
}

export function decryptWechatPayNotification(resource: {
  algorithm: string;
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}) {
  const config = wechatPayConfig();
  if (resource.algorithm !== 'AEAD_AES_256_GCM') throw new Error('不支持的微信支付回调加密算法');
  const encrypted = Buffer.from(resource.ciphertext, 'base64');
  if (encrypted.length <= 16) throw new Error('微信支付回调密文不完整');
  const data = encrypted.subarray(0, -16);
  const authTag = encrypted.subarray(-16);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as WechatPayTransaction;
}

export function decryptWechatRefundNotification(resource: {
  algorithm: string;
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}) {
  const config = wechatPayConfig();
  if (resource.algorithm !== 'AEAD_AES_256_GCM') throw new Error('不支持的微信支付回调加密算法');
  const encrypted = Buffer.from(resource.ciphertext, 'base64');
  if (encrypted.length <= 16) throw new Error('微信退款回调密文不完整');
  const data = encrypted.subarray(0, -16);
  const authTag = encrypted.subarray(-16);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as WechatPayRefund;
}

export function validateWechatTransaction(transaction: WechatPayTransaction, expected: { orderNo: string; amountFen: number }) {
  const config = wechatPayConfig();
  if (!wechatNativeAppIds().includes(transaction.appid) || transaction.mchid !== config.mchId) throw new Error('微信支付回调商户身份不符');
  if (transaction.out_trade_no !== expected.orderNo) throw new Error('微信支付订单号不符');
  if (transaction.amount?.currency !== 'CNY' || Number(transaction.amount?.total) !== expected.amountFen) throw new Error('微信支付金额不符');
  if (transaction.trade_state !== 'SUCCESS') throw new Error(transaction.trade_state_desc || '微信支付尚未成功');
  if (!transaction.transaction_id) throw new Error('微信支付交易号缺失');
}

export function validateWechatRefund(refund: WechatPayRefund, expected: { orderNo: string; outRefundNo: string; amountFen: number; totalFen: number }) {
  if (refund.out_trade_no !== expected.orderNo || refund.out_refund_no !== expected.outRefundNo) throw new Error('微信退款订单号不符');
  if (refund.amount?.currency !== 'CNY' || Number(refund.amount?.refund) !== expected.amountFen || Number(refund.amount?.total) !== expected.totalFen) throw new Error('微信退款金额不符');
  if (!refund.refund_id) throw new Error('微信退款交易号缺失');
}

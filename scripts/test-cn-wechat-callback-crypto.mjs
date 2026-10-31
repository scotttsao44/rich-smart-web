import assert from 'node:assert/strict';
import { createCipheriv, createSign, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const baseUrl = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3026').replace(/\/$/, '');
const dataFile = process.env.LOCAL_CN_DATA_FILE || '/tmp/caomi-wechat-crypto-test/cn-commerce.json';
const platformPrivateKey = readFileSync(process.env.WECHAT_TEST_PLATFORM_PRIVATE_KEY || '/tmp/caomi-wechat-platform-private.pem', 'utf8');
const apiV3Key = Buffer.from('12345678901234567890123456789012');

async function request(path, { method = 'GET', token = '', body, rawBody, headers = {}, expected = 200 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined && rawBody === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function login(identifier) {
  return (await request('/api/auth/login', { method: 'POST', body: { identifier, password: '0' } })).token;
}

function encryptedResource(value) {
  const nonce = randomBytes(12).toString('base64url').slice(0, 12);
  const associatedData = 'transaction';
  const cipher = createCipheriv('aes-256-gcm', apiV3Key, Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64');
  return { algorithm: 'AEAD_AES_256_GCM', ciphertext, nonce, associated_data: associatedData };
}

function signedNotification(id, eventType, value) {
  const rawBody = JSON.stringify({ id, create_time: new Date().toISOString(), event_type: eventType, resource_type: 'encrypt-resource', summary: eventType, resource: encryptedResource(value) });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(12).toString('hex');
  const signer = createSign('RSA-SHA256');
  signer.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
  signer.end();
  return {
    rawBody,
    headers: {
      'wechatpay-timestamp': timestamp,
      'wechatpay-nonce': nonce,
      'wechatpay-signature': signer.sign(platformPrivateKey, 'base64'),
      'wechatpay-serial': 'TESTPUB',
    },
  };
}

const memberToken = await login('王小明');
const adminToken = await login('糙米平台');
const created = await request('/api/orders', {
  method: 'POST', token: memberToken,
  body: {
    marketRegion: 'CN', currency: 'CNY', sourceChannel: 'wechat_mini', paymentMethod: 'wechat_pay', idempotencyKey: 'crypto-callback-order',
    shippingName: '回调测试会员', shippingPhone: '13800000000', shippingCity: '上海市浦东新区', shippingAddress: '回调路 1 号',
    items: [{ productId: 9302, quantity: 1 }],
  },
});
const totalFen = Math.round(Number(created.order.totalAmount) * 100);
const transaction = {
  appid: 'wx-test-app', mchid: '1900000109', out_trade_no: created.order.orderNo, transaction_id: 'WXTXN-CRYPTO-001',
  trade_state: 'SUCCESS', success_time: new Date().toISOString(), amount: { total: totalFen, payer_total: totalFen, currency: 'CNY', payer_currency: 'CNY' }, payer: { openid: 'openid-test' },
};
const paymentNotice = signedNotification('NOTICE-PAY-001', 'TRANSACTION.SUCCESS', transaction);
await request('/api/payments/callback/wechat_pay', { method: 'POST', rawBody: paymentNotice.rawBody, headers: paymentNotice.headers, expected: 204 });
await request('/api/payments/callback/wechat_pay', { method: 'POST', rawBody: paymentNotice.rawBody, headers: paymentNotice.headers, expected: 204 });
let order = await request(`/api/orders/${created.orderId}`, { token: memberToken });
assert.equal(order.paymentStatus, 'paid');
assert.equal(order.providerTransactionId, 'WXTXN-CRYPTO-001');

const state = JSON.parse(readFileSync(dataFile, 'utf8'));
state.refunds.push({
  id: 'RF-CRYPTO-001', idempotencyKey: 'refund-request:wechat_pay:RF-CRYPTO-001', orderId: order.id, orderNo: order.orderNo,
  provider: 'wechat_pay', outRefundNo: 'RF-CRYPTO-001', providerRefundId: '', amountFen: totalFen, totalFen,
  status: 'processing', reason: '回调解密测试', testMode: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
writeFileSync(dataFile, JSON.stringify(state, null, 2));

const refundValue = {
  refund_id: 'WXREFUND-CRYPTO-001', out_refund_no: 'RF-CRYPTO-001', transaction_id: 'WXTXN-CRYPTO-001', out_trade_no: order.orderNo,
  refund_status: 'SUCCESS', status: 'SUCCESS', success_time: new Date().toISOString(), amount: { total: totalFen, refund: totalFen, payer_total: totalFen, payer_refund: totalFen, currency: 'CNY' },
};
const refundNotice = signedNotification('NOTICE-REFUND-001', 'REFUND.SUCCESS', refundValue);
await request('/api/payments/callback/wechat_pay', { method: 'POST', rawBody: refundNotice.rawBody, headers: refundNotice.headers, expected: 204 });
await request('/api/payments/callback/wechat_pay', { method: 'POST', rawBody: refundNotice.rawBody, headers: refundNotice.headers, expected: 204 });
order = await request(`/api/orders/${created.orderId}`, { token: memberToken });
assert.equal(order.paymentStatus, 'refunded');
assert.equal(order.refundedAmountFen, totalFen);

const finance = await request('/api/cn/finance', { token: adminToken });
assert.equal(finance.paymentEvents.filter((event) => event.eventType === 'payment.succeeded' && event.orderId === order.id).length, 1);
assert.equal(finance.paymentEvents.filter((event) => event.eventType === 'refund.success' && event.orderId === order.id).length, 1);

console.log(JSON.stringify({ ok: true, checks: ['支付通知 RSA 验签', 'API v3 AES-GCM 解密', '重复支付通知幂等', '退款通知验签解密', '重复退款通知幂等'] }, null, 2));

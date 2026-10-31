import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const nodeBin = process.env.NODE_BIN || '/Users/maccc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node';
const nextBin = path.resolve('node_modules/.bin/next');
const callbackSecret = 'pilot-hard-disable-callback-secret';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tempDataDir() {
  return mkdtempSync(path.join(tmpdir(), 'caomi-payment-pilot-disable-'));
}

function seedMarketplace(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(path.join(dataDir, 'cn-brand-marketplace.json'), JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    brands: [{
      id: 91001,
      slug: 'pilot-disable-seed-brand',
      brandName: '支付硬闸门测试品牌',
      companyName: '支付硬闸门测试有限公司',
      contactName: '测试联系人',
      phone: '13800000000',
      wechat: 'pilot_disable',
      introduction: '隔离测试商品品牌',
      applicantUserId: 990000000002,
      accountUserId: 990000000002,
      status: 'approved',
      reviewNote: '',
      submittedAt: now,
      reviewedAt: now,
      reviewedBy: 990000000002,
      createdAt: now,
      updatedAt: now,
    }],
    products: [{
      id: 99001,
      slug: 'pilot-disable-seed-product',
      brandId: 91001,
      brandName: '支付硬闸门测试品牌',
      ownerUserId: 990000000002,
      sku: 'PILOT-DISABLE-001',
      name: '支付硬闸门测试商品',
      category: '测试',
      description: '仅用于隔离自动测试',
      imageUrl: '',
      imageIsTest: true,
      imageDisclosure: '测试示意图',
      priceCny: '88.00',
      priceTwd: '0',
      supplyPriceCny: 50,
      stockQuantity: 10,
      fulfillmentInfo: '无需发货',
      commissionRate: '0',
      directRate: 30,
      upperRate: 5,
      activeRate: 65,
      status: 'approved',
      reviewStatus: 'approved',
      reviewNote: '',
      submittedAt: now,
      reviewedAt: now,
      reviewedBy: 990000000002,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }],
    audits: [],
  }, null, 2));
}

async function startServer(port, dataDir) {
  const child = spawn(nextBin, ['dev', '-H', '127.0.0.1', '-p', String(port)], {
    env: {
      ...process.env,
      PATH: `${path.dirname(nodeBin)}:${process.env.PATH || ''}`,
      LOCAL_CN_DATA_DIR: dataDir,
      CN_ENABLE_TEST_LOGIN: 'true',
      CN_ENABLE_BRAND_PILOT_LOGIN: 'true',
      CN_PILOT_PAYMENT_DISABLED: 'true',
      CN_ADMIN_TEST_ACCESS_CODE: 'pilot-admin-code',
      PAYMENT_CALLBACK_SECRET: callbackSecret,
      WECHAT_PAY_MCH_ID: '1900000109',
      WECHAT_PAY_API_V3_KEY: '12345678901234567890123456789012',
      WECHAT_PAY_CERT_SERIAL_NO: 'TESTSERIAL',
      WECHAT_PAY_PRIVATE_KEY: 'not-a-real-private-key',
      WECHAT_PAY_NOTIFY_URL: 'https://rich-smart.cn/api/payments/callback/wechat_pay',
      WECHAT_PAY_PUBLIC_KEY_ID: 'TESTPUB',
      WECHAT_PAY_PUBLIC_KEY: 'not-a-real-public-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, baseUrl, output: () => output };
    } catch {}
    await delay(250);
  }
  child.kill('SIGTERM');
  throw new Error(`server did not become ready:\n${output}`);
}

async function stopServer(server) {
  server.child.kill('SIGTERM');
  await delay(500);
}

function makeClient(baseUrl) {
  let cookie = '';
  async function request(pathname, options = {}) {
    const headers = {
      ...(options.json === false ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(`${baseUrl}${pathname}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : options.json === false ? options.body : JSON.stringify(options.body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
    return { response, data };
  }
  return { request };
}

async function expectOk(client, pathname, options) {
  const result = await client.request(pathname, options);
  assert.ok(result.response.ok, `${options?.method || 'GET'} ${pathname} ${result.response.status}: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function expectStatus(client, status, pathname, options) {
  const result = await client.request(pathname, options);
  assert.equal(result.response.status, status, `${options?.method || 'GET'} ${pathname}: ${JSON.stringify(result.data)}`);
  return result.data;
}

function signedCallbackBody(value) {
  const raw = JSON.stringify(value);
  const signature = createHmac('sha256', callbackSecret).update(raw).digest('hex');
  return { raw, signature };
}

const dataDir = tempDataDir();
seedMarketplace(dataDir);
const server = await startServer(3067, dataDir);

try {
  const admin = makeClient(server.baseUrl);
  await expectOk(admin, '/api/auth/test-account', {
    method: 'POST',
    headers: { 'x-caomi-mini-env': 'develop' },
    body: { action: 'login_admin', accessCode: 'pilot-admin-code' },
  });
  const invite = await expectOk(admin, '/api/auth/brand-pilot-login', {
    method: 'POST',
    body: { action: 'create_invite', expiresInMinutes: 60, referralCode: 'RS-CN-OFFICIAL' },
  });

  const pilot = makeClient(server.baseUrl);
  const pilotLogin = await expectOk(pilot, '/api/auth/brand-pilot-login', {
    method: 'POST',
    body: {
      action: 'login',
      token: invite.token,
      code: invite.code,
      nickname: '支付硬闸门昵称',
      confirmReferral: true,
      idempotencyKey: 'payment-brand-pilot-hard-disable-login',
    },
  });
  assert.equal(pilotLogin.user.region, 'CN');
  assert.equal(pilotLogin.user.demoAccount, undefined);

  const pilotProviders = await expectOk(pilot, '/api/payments/providers');
  for (const provider of pilotProviders.providers) {
    assert.equal(provider.liveConfigured, false, `${provider.id} must not be live for brand pilot`);
    assert.equal(provider.testMode, true, `${provider.id} must be test mode for brand pilot`);
    assert.equal(provider.paymentDisabled, true, `${provider.id} must be paymentDisabled for brand pilot`);
  }
  assert.equal(pilotProviders.providers.find((provider) => provider.id === 'bank_transfer').enabled, false);

  const blockedBankOrder = await expectStatus(pilot, 503, '/api/orders', {
    method: 'POST',
    body: {
      marketRegion: 'CN',
      currency: 'CNY',
      sourceChannel: 'web',
      paymentMethod: 'bank_transfer',
      shippingName: '支付硬闸门',
      shippingPhone: '13800000000',
      shippingCity: '上海市浦东新区',
      shippingAddress: '测试路 1 号',
      items: [{ productId: 99001, quantity: 1 }],
      idempotencyKey: 'pilot-bank-direct-blocked',
    },
  });
  assert.equal(blockedBankOrder.paymentDisabled, true);

  const order = await expectOk(pilot, '/api/orders', {
    method: 'POST',
    body: {
      marketRegion: 'CN',
      currency: 'CNY',
      sourceChannel: 'web',
      paymentMethod: 'bank_transfer',
      simulate: true,
      shippingName: '支付硬闸门',
      shippingPhone: '13800000000',
      shippingCity: '上海市浦东新区',
      shippingAddress: '测试路 1 号',
      items: [{ productId: 99001, quantity: 1 }],
      idempotencyKey: 'pilot-explicit-simulated-order',
    },
  });
  assert.notEqual(order.order.paymentMethod, 'bank_transfer');
  assert.equal(order.order.paymentStatus, 'pending');
  assert.equal(order.order.paymentMode, 'test');
  assert.equal(order.payment.paymentDisabled, true);

  const blockedSession = await expectStatus(pilot, 503, '/api/payments/session', {
    method: 'POST',
    body: { orderId: order.orderId, provider: 'wechat_pay', simulate: true, idempotencyKey: 'pilot-session-bypass' },
  });
  assert.equal(blockedSession.paymentDisabled, true);

  const callbackPayload = signedCallbackBody({ orderId: order.orderId, eventId: 'pilot-callback-bypass', transactionId: 'REAL-BYPASS-001' });
  const blockedCallback = await expectStatus(pilot, 503, '/api/payments/callback/wechat_pay', {
    method: 'POST',
    headers: { 'x-payment-signature': callbackPayload.signature },
    body: callbackPayload.raw,
    json: false,
  });
  assert.equal(blockedCallback.paymentDisabled, true);

  const normal = makeClient(server.baseUrl);
  await expectOk(normal, '/api/auth/test-account', {
    method: 'POST',
    headers: { 'x-caomi-mini-env': 'develop' },
    body: { action: 'login' },
  });
  const normalProviders = await expectOk(normal, '/api/payments/providers');
  const bank = normalProviders.providers.find((provider) => provider.id === 'bank_transfer');
  assert.equal(bank.liveConfigured, true);
  assert.equal(bank.testMode, false);
  assert.equal(bank.paymentDisabled, false);
  const normalOrder = await expectOk(normal, '/api/orders', {
    method: 'POST',
    body: {
      marketRegion: 'CN',
      currency: 'CNY',
      sourceChannel: 'web',
      paymentMethod: 'bank_transfer',
      shippingName: '正常会员',
      shippingPhone: '13800000001',
      shippingCity: '上海市浦东新区',
      shippingAddress: '正常路 1 号',
      items: [{ productId: 99001, quantity: 1 }],
      idempotencyKey: 'normal-bank-order-still-works',
    },
  });
  assert.equal(normalOrder.order.paymentMethod, 'bank_transfer');
  assert.equal(normalOrder.order.paymentMode, 'manual');

  console.log(JSON.stringify({
    ok: true,
    pilotMemberId: pilotLogin.user.id,
    pilotOrderId: order.orderId,
    normalOrderId: normalOrder.orderId,
    checks: [
      'brand pilot providers force liveConfigured=false testMode=true paymentDisabled=true',
      'bank_transfer is disabled for brand pilot providers',
      'brand pilot direct bank_transfer order is rejected without explicit simulation',
      'explicit pilot simulated order cannot become bank_transfer/manual',
      'brand pilot payment session cannot create real or simulated paid records',
      'signed direct callback bypass is rejected for pilot order',
      'normal member bank_transfer provider and order flow still work',
    ],
  }, null, 2));
} finally {
  await stopServer(server);
}

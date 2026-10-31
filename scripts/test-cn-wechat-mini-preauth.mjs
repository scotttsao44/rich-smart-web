import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const nodeBin = process.env.NODE_BIN || '/Users/maccc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node';
const nextBin = path.resolve('node_modules/.bin/next');
const authSecret = 'mini-preauth-regression-secret';

function b64json(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(encoded) {
  return createHmac('sha256', authSecret).update(encoded).digest('base64url');
}

function digest(token) {
  return createHmac('sha256', authSecret).update(token).digest('base64url');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(port, dataDir) {
  const child = spawn(nextBin, ['dev', '-H', '127.0.0.1', '-p', String(port)], {
    env: {
      ...process.env,
      PATH: `${path.dirname(nodeBin)}:${process.env.PATH || ''}`,
      AUTH_SECRET: authSecret,
      LOCAL_CN_DATA_DIR: dataDir,
      WECHAT_MINI_APP_ID: 'mini-app',
      WECHAT_MINI_APP_SECRET: 'mini-secret',
      WECHAT_MINI_MOCK_LOGIN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
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

async function post(baseUrl, route, body, expected) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${route}: ${JSON.stringify(data)}`);
  return data;
}

function seedUsers(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(path.join(dataDir, 'cn-users.json'), JSON.stringify([
    {
      id: 710001,
      name: '推荐会员',
      phone: '13900000001',
      email: 'mini-referrer@example.test',
      passwordHash: '',
      role: 'member',
      agentLevel: 1,
      referralCode: 'RS-CN-MINIREF',
      referrerCode: 'RS-CN-OFFICIAL',
      platformAdmin: false,
      store: null,
      wechatId: null,
      createdAt: now,
    },
    {
      id: 710002,
      name: '网页受邀会员',
      phone: '13800000000',
      email: 'mini-invited@example.test',
      passwordHash: '',
      role: 'member',
      agentLevel: 1,
      referralCode: 'RS-CN-INVITED',
      referrerCode: 'RS-CN-MINIREF',
      platformAdmin: false,
      store: null,
      wechatId: null,
      createdAt: now,
    },
  ], null, 2));
}

function expiredToken(dataDir) {
  const payload = {
    appId: 'mini-app',
    openId: 'expired-openid',
    unionId: null,
    referralCode: 'RS-CN-MINIREF',
    displayName: '过期会员',
    avatarUrl: '',
    iat: 1,
    exp: 2,
    nonce: 'expired',
  };
  const encoded = b64json(payload);
  const token = `${encoded}.${sign(encoded)}`;
  writeFileSync(path.join(dataDir, 'wechat-mini-preauth.json'), JSON.stringify({ [digest(token)]: { exp: 2, usedAt: null } }, null, 2));
  return token;
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'caomi-mini-preauth-'));
seedUsers(dataDir);
const server = await startServer(3061, dataDir);
try {
  const noUnion = await post(server.baseUrl, '/api/auth/wechat-mini/login', {
    code: b64json({ openid: 'mini-open-no-union' }),
    referrerCode: 'RS-CN-MINIREF',
    userInfo: { nickName: '新小程序会员' },
  }, 409);
  assert.equal(noUnion.code, 'PHONE_REQUIRED');
  assert.ok(noUnion.preAuthToken);

  const mergeRequired = await post(server.baseUrl, '/api/auth/wechat-mini/bind-phone', {
    phoneCode: b64json({ phone: '13800000000', countryCode: '86' }),
    preAuthToken: noUnion.preAuthToken,
  }, 409);
  assert.equal(mergeRequired.code, 'MERGE_CONFIRMATION_REQUIRED');
  assert.equal(mergeRequired.mergeCandidate.memberId, 710002);

  const merged = await post(server.baseUrl, '/api/auth/wechat-mini/bind-phone', {
    phoneCode: b64json({ phone: '13800000000', countryCode: '86' }),
    preAuthToken: noUnion.preAuthToken,
    confirmMerge: true,
  }, 200);
  assert.equal(merged.user.id, 710002, 'verified phone should merge to invited web member id');

  const usersAfterMerge = JSON.parse(readFileSync(path.join(dataDir, 'cn-users.json'), 'utf8'));
  assert.equal(usersAfterMerge.find((user) => user.id === 710002).referrerCode, 'RS-CN-MINIREF', 'existing referral must remain locked');
  const identitiesAfterMerge = JSON.parse(readFileSync(path.join(dataDir, 'cn-member-identities.json'), 'utf8'));
  assert.equal(identitiesAfterMerge.identities[0].memberId, 710002);

  await post(server.baseUrl, '/api/auth/wechat-mini/bind-phone', {
    phoneCode: b64json({ phone: '13800000000', countryCode: '86' }),
    preAuthToken: noUnion.preAuthToken,
  }, 400);

  const relogin = await post(server.baseUrl, '/api/auth/wechat-mini/login', {
    code: b64json({ openid: 'mini-open-no-union' }),
  }, 200);
  assert.equal(relogin.user.id, 710002, 'existing appId/openId should log in same member without referral');

  const unionFirst = await post(server.baseUrl, '/api/auth/wechat-mini/login', {
    code: b64json({ openid: 'union-open-1', unionid: 'union-mini-same' }),
    referrerCode: 'RS-CN-MINIREF',
    userInfo: { nickName: 'Union 会员' },
  }, 200);
  const unionSecond = await post(server.baseUrl, '/api/auth/wechat-mini/login', {
    code: b64json({ openid: 'union-open-2', unionid: 'union-mini-same' }),
  }, 200);
  assert.equal(unionSecond.user.id, unionFirst.user.id, 'same UnionID should reuse the member id');

  const tamperSource = await post(server.baseUrl, '/api/auth/wechat-mini/login', {
    code: b64json({ openid: 'tamper-openid' }),
    referrerCode: 'RS-CN-MINIREF',
  }, 409);
  const tampered = `${tamperSource.preAuthToken.slice(0, -1)}x`;
  await post(server.baseUrl, '/api/auth/wechat-mini/bind-phone', {
    phoneCode: b64json({ phone: '13900000002', countryCode: '86' }),
    preAuthToken: tampered,
  }, 400);

  await post(server.baseUrl, '/api/auth/wechat-mini/bind-phone', {
    phoneCode: b64json({ phone: '13900000003', countryCode: '86' }),
    preAuthToken: expiredToken(dataDir),
  }, 400);
} finally {
  await stopServer(server);
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  tested: [
    'no UnionID first login returns PHONE_REQUIRED pre-auth token',
    'verified phone matching existing member requires explicit merge confirmation',
    'phoneCode plus pre-auth token merges invited web member id',
    'one-time pre-auth token rejects replay',
    'tampered pre-auth token rejects',
    'expired pre-auth token rejects',
    'existing appId/openId login reuses same member id',
    'same UnionID login reuses same member id',
    'referral is locked on existing invited member',
  ],
}, null, 2));

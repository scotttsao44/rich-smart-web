import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const nodeBin = process.env.NODE_BIN || '/Users/maccc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node';
const nextBin = path.resolve('node_modules/.bin/next');

function tempDataDir(label) {
  return mkdtempSync(path.join(tmpdir(), `caomi-${label}-`));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(port, env) {
  const child = spawn(nextBin, ['dev', '-H', '127.0.0.1', '-p', String(port)], {
    env: { ...process.env, PATH: `${path.dirname(nodeBin)}:${process.env.PATH || ''}`, ...env },
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
  throw new Error(`server ${port} did not become ready:\n${output}`);
}

async function stopServer(server) {
  server.child.kill('SIGTERM');
  await delay(500);
}

async function request(baseUrl, path, options = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual', ...options });
}

function stateFromWechatLocation(location) {
  assert.ok(location, 'missing redirect location');
  const url = new URL(location.replace(/#wechat_redirect$/, ''));
  return url.searchParams.get('state');
}

function cookieFrom(response) {
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'missing oauth state cookie');
  return cookie;
}

async function startAndCallback(baseUrl, kind, code, userAgent = 'Mozilla/5.0') {
  const start = await request(baseUrl, `/api/auth/wechat/${kind}/start?returnTo=%2Fcn%2Fshop&ref=RS-CN-OFFICIAL`, { headers: { 'user-agent': userAgent } });
  assert.equal(start.status, 307);
  const location = start.headers.get('location') || '';
  assert.match(location, /open\.weixin\.qq\.com/);
  assert.match(decodeURIComponent(location), new RegExp(`https://rich-smart.cn/api/auth/wechat/${kind}/callback`));
  const state = stateFromWechatLocation(location);
  const cookie = cookieFrom(start);
  const callback = await request(baseUrl, `/api/auth/wechat/${kind}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, { headers: { cookie, 'user-agent': userAgent } });
  assert.equal(callback.status, 307);
  assert.equal(new URL(callback.headers.get('location'), baseUrl).pathname, '/cn/shop');
  return { state, cookie };
}

async function testMissingConfig() {
  const dataDir = tempDataDir('wechat-missing');
  const server = await startServer(3051, { LOCAL_CN_DATA_DIR: dataDir, CN_TEST_ACCOUNT_ENABLED: 'true' });
  try {
    const config = await request(server.baseUrl, '/api/auth/wechat/config');
    assert.equal(config.status, 200);
    const body = await config.json();
    assert.equal(body.officialConfigured, false);
    assert.equal(body.openConfigured, false);
    const login = await request(server.baseUrl, '/cn/login?switch=1');
    assert.equal(login.status, 200);
    assert.match(await login.text(), /微信登入尚未配置/);
  } finally {
    await stopServer(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testUnionMergeAndReplay() {
  const dataDir = tempDataDir('wechat-union');
  const server = await startServer(3052, {
    LOCAL_CN_DATA_DIR: dataDir,
    CN_TEST_ACCOUNT_ENABLED: 'true',
    WECHAT_AUTH_MOCK: 'true',
    WECHAT_OFFICIAL_APP_ID: 'official-app',
    WECHAT_OFFICIAL_APP_SECRET: 'official-secret',
    WECHAT_OPEN_APP_ID: 'open-app',
    WECHAT_OPEN_APP_SECRET: 'open-secret',
    WECHAT_OFFICIAL_MOCK_PROFILE: JSON.stringify({ openid: 'official-openid', unionid: 'union-same', nickname: '服务号会员' }),
    WECHAT_OPEN_MOCK_PROFILE: JSON.stringify({ openid: 'open-openid', unionid: 'union-same', nickname: '开放平台会员' }),
  });
  try {
    const official = await startAndCallback(server.baseUrl, 'official', 'official-code', 'MicroMessenger');
    const replay = await request(server.baseUrl, `/api/auth/wechat/official/callback?code=official-code&state=${encodeURIComponent(official.state)}`, { headers: { cookie: official.cookie, 'user-agent': 'MicroMessenger' } });
    assert.equal(replay.status, 307);
    assert.match(decodeURIComponent(replay.headers.get('location') || ''), /state/);
    await startAndCallback(server.baseUrl, 'open', 'open-code');
    const identities = JSON.parse(readFileSync(path.join(dataDir, 'cn-member-identities.json'), 'utf8')).identities;
    assert.equal(identities.length, 2);
    assert.equal(new Set(identities.map((identity) => identity.memberId)).size, 1, 'same UnionID should merge to one memberId');
  } finally {
    await stopServer(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testAppIdScopedOpenIdIsolation() {
  const dataDir = tempDataDir('wechat-isolation');
  const server = await startServer(3053, {
    LOCAL_CN_DATA_DIR: dataDir,
    CN_TEST_ACCOUNT_ENABLED: 'true',
    WECHAT_AUTH_MOCK: 'true',
    WECHAT_OFFICIAL_APP_ID: 'official-app',
    WECHAT_OFFICIAL_APP_SECRET: 'official-secret',
    WECHAT_OPEN_APP_ID: 'open-app',
    WECHAT_OPEN_APP_SECRET: 'open-secret',
    WECHAT_OFFICIAL_MOCK_PROFILE: JSON.stringify({ openid: 'same-openid', unionid: 'union-official', nickname: '服务号会员' }),
    WECHAT_OPEN_MOCK_PROFILE: JSON.stringify({ openid: 'same-openid', unionid: 'union-open', nickname: '网站会员' }),
  });
  try {
    await startAndCallback(server.baseUrl, 'official', 'official-code', 'MicroMessenger');
    await startAndCallback(server.baseUrl, 'open', 'open-code');
    const identities = JSON.parse(readFileSync(path.join(dataDir, 'cn-member-identities.json'), 'utf8')).identities;
    assert.equal(identities.length, 2);
    assert.equal(new Set(identities.map((identity) => identity.openId)).size, 1, 'test setup should reuse the same raw OpenID');
    assert.equal(new Set(identities.map((identity) => identity.appId)).size, 2, 'identities should remain appId-scoped');
    assert.equal(new Set(identities.map((identity) => identity.memberId)).size, 2, 'same OpenID under different AppIDs must not merge without UnionID match');
  } finally {
    await stopServer(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testPhoneMerge() {
  const dataDir = tempDataDir('wechat-phone');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, 'cn-users.json'), JSON.stringify([{
    id: 880001,
    name: '手机既有会员',
    phone: '+8613800000000',
    email: 'phone-existing@example.test',
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: 'RS-CN-PHONE',
    referrerCode: 'RS-CN-OFFICIAL',
    platformAdmin: false,
    store: null,
    wechatId: null,
    createdAt: new Date().toISOString(),
  }], null, 2));
  const server = await startServer(3054, {
    LOCAL_CN_DATA_DIR: dataDir,
    CN_TEST_ACCOUNT_ENABLED: 'true',
    WECHAT_AUTH_MOCK: 'true',
    WECHAT_OFFICIAL_APP_ID: 'official-app',
    WECHAT_OFFICIAL_APP_SECRET: 'official-secret',
    WECHAT_OFFICIAL_MOCK_PROFILE: JSON.stringify({ openid: 'phone-openid', unionid: null, phone: '+8613800000000', nickname: '手机微信会员' }),
  });
  try {
    await startAndCallback(server.baseUrl, 'official', 'phone-code', 'MicroMessenger');
    const identities = JSON.parse(readFileSync(path.join(dataDir, 'cn-member-identities.json'), 'utf8')).identities;
    assert.equal(identities.length, 1);
    assert.equal(identities[0].memberId, 880001, 'verified phone should merge into existing memberId');
  } finally {
    await stopServer(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

await testMissingConfig();
await testUnionMergeAndReplay();
await testAppIdScopedOpenIdIsolation();
await testPhoneMerge();

console.log(JSON.stringify({
  ok: true,
  tested: [
    'missing WeChat config renders safely',
    'official/open split start and callback URLs',
    'fixed rich-smart.cn callback domain',
    'one-time state replay rejection',
    'UnionID merge across WeChat web apps',
    'different AppID OpenID isolation',
    'verified phone merge into existing memberId',
  ],
}, null, 2));

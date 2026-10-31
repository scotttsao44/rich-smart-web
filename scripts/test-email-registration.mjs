import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Module, { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'richsmart-email-test-'));
const previousEnvironment = { ...process.env };
const oldResolve = Module._resolveFilename;
const oldTs = require.extensions['.ts'];
const passed = [];
const report = { scope: 'Isolated email registration, API contracts and referral chain; mock delivery only', passed, realEmails: 0, productionChanges: 0 };
let clock = Date.now();
const realDateNow = Date.now;
Date.now = () => clock;
Module._resolveFilename = function(name, parent, ...rest) {
  return oldResolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
require.extensions['.ts'] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }}).outputText, filename);
};
async function test(name, run) { await run(); passed.push(name); }
try {
  process.env.LOCAL_CN_DATA_DIR = directory;
  process.env.DATABASE_URL = '';
  process.env.EMAIL_AUTH_ENABLED = 'true';
  process.env.EMAIL_AUTH_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
  process.env.EMAIL_AUTH_ORIGIN = 'https://email-test.invalid';
  process.env.EMAIL_SMTP_HOST = 'mail.invalid';
  process.env.EMAIL_SMTP_USER = 'fixture';
  process.env.EMAIL_SMTP_PASSWORD = 'fixture-not-real';
  process.env.EMAIL_FROM = 'members@example.invalid';
  const users = require('../lib/local-cn-users.ts');
  const refs = require('../lib/local-cn-referral-attribution.ts');
  const mail = require('../lib/email-auth/mail.ts');
  const deliveries = [];
  mail.sendRegistrationEmail = async (email, code) => { deliveries.push({ email, code }); };
  const service = require('../lib/email-auth/service.ts');
  const auth = require('../lib/auth.ts');
  const { NextRequest } = require('next/server');
  const route = require('../app/api/auth/email/route.ts');
  const shareRoute = require('../app/api/auth/email/referral/route.ts');
  const browser = () => crypto.randomBytes(24).toString('hex');
  const password = 'Correct-test-password-42!';
  const owner = users.createLocalCnUser({ name: '邀请人 A', email: 'owner@example.invalid', phone: '', passwordHash: auth.hashPassword(password),
    role: 'member', agentLevel: 1, referralCode: 'RS-EMAIL-OWNER', referrerCode: null, store: null, wechatId: null });
  function landing(memberId) {
    const link = refs.ensureLocalCnReferralLink(memberId);
    const result = refs.recordLocalCnReferralLanding({ token: link.token, sourcePath: '/cn/email', sessionId: browser() });
    assert.equal(result.ok, true); return result.pending;
  }
  const pendingA = landing(owner.id);
  const signup = (email, context, referral = pendingA, deliver = mail.sendRegistrationEmail) => service.requestEmailRegistration({ email, name: '会员', password, confirmReferral: true }, context, referral, deliver);
  await test('normalize-email-without-provider-specific-dot-or-plus-merging', () => {
    assert.equal(service.normalizeEmail(' Alice+test@Example.com '), 'alice+test@example.com');
    assert.equal(service.normalizeEmail('bad\r\nTo:victim@example.com'), '');
    assert.equal(service.normalizeEmail('a b@example.com'), '');
  });
  await test('requires-valid-invitation-confirmation-and-strong-password', async () => {
    await assert.rejects(signup('none@example.invalid', browser(), null), e => e.code === 'REFERRAL_REQUIRED');
    await assert.rejects(service.requestEmailRegistration({ email: 'a@example.invalid', name: 'A', password: 'short', confirmReferral: true }, browser(), pendingA), e => e.code === 'INVALID_INPUT');
    await assert.rejects(service.requestEmailRegistration({ email: 'a@example.invalid', name: 'A', password, confirmReferral: false }, browser(), pendingA), e => e.code === 'REFERRAL_REQUIRED');
  });
  const bBrowser = browser();
  const b = await signup('MemberB@example.invalid', bBrowser);
  const bCode = deliveries.at(-1).code;
  await test('send-response-and-durable-state-never-contain-plaintext-code-or-password', () => {
    assert.deepEqual(Object.keys(b).sort(), ['challengeId', 'expiresIn', 'retryAfter']);
    const stored = fs.readFileSync(path.join(directory, 'cn-email-auth.json'), 'utf8');
    assert.ok(!stored.includes(password)); assert.ok(!stored.includes(`"${bCode}"`));
    assert.equal(users.listLocalCnUsers().length, 1);
  });
  await test('code-bound-to-browser-and-wrong-attempts-persist', () => {
    assert.throws(() => service.verifyEmailRegistration(b.challengeId, bCode, browser()), e => e.code === 'INVALID_CODE');
    assert.throws(() => service.verifyEmailRegistration(b.challengeId, bCode === '000000' ? '000001' : '000000', bBrowser), e => e.code === 'INVALID_CODE');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'cn-email-auth.json'))).challenges.find(row => row.id === b.challengeId).attempts, 1);
  });
  const memberB = service.verifyEmailRegistration(b.challengeId, bCode, bBrowser);
  await test('verified-member-preserves-parent-and-does-not-fake-phone-or-admin', () => {
    const row = users.findLocalCnUserById(memberB.id);
    assert.equal(row.referredByMemberId, owner.id); assert.ok(row.emailVerifiedAt);
    assert.equal(row.phone, ''); assert.equal(row.phoneVerifiedAt, null); assert.equal(row.platformAdmin, false);
    assert.equal(memberB.email, 'memberb@example.invalid');
    assert.equal(refs.getLocalCnReferralAttributionState().bindings.filter(row => row.memberId === memberB.id).length, 1);
    assert.ok(!row.passwordHash.includes(password));
  });
  await test('consumed-code-cannot-create-another-member-or-session', () => {
    assert.throws(() => service.verifyEmailRegistration(b.challengeId, bCode, bBrowser));
    assert.equal(users.listLocalCnUsers().length, 2);
  });
  const pendingB = landing(memberB.id);
  const cBrowser = browser(); const c = await signup('memberc@example.invalid', cBrowser, pendingB);
  const memberC = service.verifyEmailRegistration(c.challengeId, deliveries.at(-1).code, cBrowser);
  await test('A-to-B-to-C-each-gets-distinct-account-and-owned-referral-link', () => {
    assert.notEqual(memberB.id, memberC.id);
    assert.equal(users.findLocalCnUserById(memberC.id).referredByMemberId, memberB.id);
    assert.notEqual(refs.ensureLocalCnReferralLink(memberB.id).token, refs.ensureLocalCnReferralLink(memberC.id).token);
  });
  await test('login-normalizes-email-and-never-reparents-existing-member', () => {
    assert.equal(service.loginEmailMember(' MEMBERB@EXAMPLE.INVALID ', password).id, memberB.id);
    assert.throws(() => service.loginEmailMember('memberb@example.invalid', 'wrong-password'), e => e.code === 'INVALID_CREDENTIALS');
    assert.equal(users.findLocalCnUserById(memberB.id).referredByMemberId, owner.id);
    assert.throws(() => service.loginEmailMember(owner.email, password), e => e.code === 'INVALID_CREDENTIALS');
  });
  await test('duplicate-email-is-not-merged-and-cannot-replace-parent-or-password', async () => {
    clock += 61000;
    const ctx = browser(); const duplicate = await signup('MEMBERB@example.invalid', ctx, pendingB);
    assert.throws(() => service.verifyEmailRegistration(duplicate.challengeId, deliveries.at(-1).code, ctx), e => e.code === 'EMAIL_IN_USE');
    assert.equal(users.findLocalCnUserById(memberB.id).referredByMemberId, owner.id);
  });
  await test('five-wrong-codes-lock-correct-code', async () => {
    const ctx = browser(); const challenge = await signup('locked@example.invalid', ctx); const code = deliveries.at(-1).code;
    for (let i = 0; i < 5; i++) assert.throws(() => service.verifyEmailRegistration(challenge.challengeId, code === '999999' ? '999998' : '999999', ctx));
    assert.throws(() => service.verifyEmailRegistration(challenge.challengeId, code, ctx));
  });
  await test('pending-delivery-cannot-be-consumed-and-rejection-invalidates', async () => {
    const ctx = browser();
    await assert.rejects(signup('failed@example.invalid', ctx, pendingA, async (_email, code) => {
      const state = JSON.parse(fs.readFileSync(path.join(directory, 'cn-email-auth.json')));
      const row = state.challenges.find(row => row.email === 'failed@example.invalid');
      assert.throws(() => service.verifyEmailRegistration(row.id, code, ctx));
      throw new Error('fake provider rejected');
    }), e => e.code === 'EMAIL_DELIVERY_FAILED');
    const row = JSON.parse(fs.readFileSync(path.join(directory, 'cn-email-auth.json'))).challenges.find(row => row.email === 'failed@example.invalid');
    assert.equal(row.delivery, 'failed');
  });
  await test('resend-cooldown-and-replacement-invalidate-old-code', async () => {
    const ctx = browser(); const first = await signup('resend@example.invalid', ctx); const oldCode = deliveries.at(-1).code;
    await assert.rejects(signup('resend@example.invalid', ctx), e => e.code === 'RATE_LIMITED');
    clock += 61000;
    const second = await signup('resend@example.invalid', ctx);
    assert.throws(() => service.verifyEmailRegistration(first.challengeId, oldCode, ctx));
    assert.ok(service.verifyEmailRegistration(second.challengeId, deliveries.at(-1).code, ctx));
  });
  await test('expiry-boundary-fails-closed', async () => {
    const ctx = browser(); const challenge = await signup('expired@example.invalid', ctx); const code = deliveries.at(-1).code;
    clock += 600000;
    assert.throws(() => service.verifyEmailRegistration(challenge.challengeId, code, ctx));
  });
  const req = (body, cookie = '', origin = process.env.EMAIL_AUTH_ORIGIN) => new NextRequest(`${process.env.EMAIL_AUTH_ORIGIN}/api/auth/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, cookie }, body: JSON.stringify(body),
  });
  await test('API-rejects-CSRF-malformed-and-oversized-input', async () => {
    assert.equal((await route.POST(req({ action: 'login' }, '', 'https://evil.invalid'))).status, 403);
    assert.equal((await route.POST(req('x'.repeat(5000)))).status, 413);
    assert.equal((await route.POST(req(null))).status, 400);
  });
  await test('API-login-issues-HttpOnly-session-and-share-url-is-own-non-login-token', async () => {
    const response = await route.POST(req({ action: 'login', email: memberB.email, password }));
    assert.equal(response.status, 200); assert.equal((await response.json()).user.id, memberB.id);
    const setCookie = response.headers.get('set-cookie'); assert.match(setCookie, /HttpOnly/i);
    const cookie = setCookie.split(';')[0];
    const share = await shareRoute.GET(new NextRequest('https://email-test.invalid/api/auth/email/referral', { headers: { cookie } }));
    assert.equal(share.status, 200);
    const { referralPath } = await share.json(); assert.ok(referralPath.endsWith('&to=%2Fcn%2Femail'));
    assert.ok(!referralPath.includes('pilotMode') && !referralPath.includes('code='));
    const token = new URL(referralPath, 'https://email-test.invalid').searchParams.get('t');
    assert.equal(refs.verifyLocalCnReferralToken(token).owner.id, memberB.id);
    assert.equal((await route.POST(req({ action: 'login', email: memberC.email, password }, cookie))).status, 409);
  });
  await test('API-registration-cookie-verification-and-session-end-to-end', async () => {
    const pendingResponse = require('next/server').NextResponse.json({});
    refs.setPendingReferralAttributionCookie(pendingResponse, pendingB, true);
    const referralCookie = pendingResponse.headers.get('set-cookie').split(';')[0];
    const sent = await route.POST(req({ action: 'request', email: 'api@example.invalid', name: 'API member', password, confirmReferral: true }, referralCookie));
    assert.equal(sent.status, 200);
    const challenge = await sent.json(); assert.ok(!('code' in challenge));
    const browserCookie = sent.headers.get('set-cookie').split(';')[0];
    const response = await route.POST(req({ action: 'verify', challengeId: challenge.challengeId, code: deliveries.at(-1).code }, `${browserCookie}; ${referralCookie}`));
    assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(users.findLocalCnUserById(data.user.id).referredByMemberId, memberB.id);
    assert.match(response.headers.get('set-cookie'), /richsmart_session=/);
  });
  await test('password-reset-requires-email-code-preserves-parent-and-revokes-old-sessions', async () => {
    const oldSession = auth.createSessionToken(memberB);
    const nextPassword = 'New-correct-password-43!';
    const ctx = browser();
    const sent = await service.requestEmailRegistration({ purpose: 'reset', email: memberB.email, name: '', password: nextPassword, confirmReferral: false }, ctx, null);
    const code = deliveries.at(-1).code;
    assert.throws(() => service.verifyEmailRegistration(sent.challengeId, code, browser()));
    const updated = service.verifyEmailRegistration(sent.challengeId, code, ctx);
    assert.equal(updated.id, memberB.id);
    assert.equal(users.findLocalCnUserById(memberB.id).referredByMemberId, owner.id);
    assert.throws(() => service.loginEmailMember(memberB.email, password));
    assert.equal(service.loginEmailMember(memberB.email, nextPassword).id, memberB.id);
    const oldRequest = new NextRequest('https://email-test.invalid/api/auth/me', { headers: { cookie: `richsmart_session=${oldSession}` } });
    assert.equal(await auth.getFreshSessionUser(oldRequest), null);
    assert.ok(await auth.getFreshSessionUser(new NextRequest('https://email-test.invalid/api/auth/me', { headers: { cookie: `richsmart_session=${auth.createSessionToken(updated)}` } })));
  });
  await test('password-reset-never-claims-unverified-legacy-account', async () => {
    const original = users.findLocalCnUserById(owner.id).passwordHash;
    const ctx = browser();
    const sent = await service.requestEmailRegistration({ purpose: 'reset', email: owner.email, name: '', password: 'New-fake-password-44!', confirmReferral: false }, ctx, null);
    assert.throws(() => service.verifyEmailRegistration(sent.challengeId, deliveries.at(-1).code, ctx));
    assert.equal(users.findLocalCnUserById(owner.id).passwordHash, original);
  });
  await test('legacy-login-route-cannot-bypass-email-login-rate-limits-or-origin-check', async () => {
    const legacy = require('../app/api/auth/login/route.ts');
    assert.equal((await legacy.POST(req({ identifier: memberB.email, password: 'New-correct-password-43!' }, '', 'https://evil.invalid'))).status, 403);
    for (let i = 0; i < 20; i++) await legacy.POST(req({ identifier: memberC.email, password: 'wrong' }));
    assert.equal((await legacy.POST(req({ identifier: memberC.email, password }))).status, 429);
  });
  await test('revoked-or-disabled-referrer-cannot-register', async () => {
    const ctx = browser(); const challenge = await signup('disabled@example.invalid', ctx); const code = deliveries.at(-1).code;
    const filename = path.join(directory, 'cn-users.json'); const rows = JSON.parse(fs.readFileSync(filename));
    rows.find(row => row.id === owner.id).promotionQualificationStatus = 'disabled'; fs.writeFileSync(filename, JSON.stringify(rows));
    assert.throws(() => service.verifyEmailRegistration(challenge.challengeId, code, ctx));
    rows.find(row => row.id === owner.id).promotionQualificationStatus = null; fs.writeFileSync(filename, JSON.stringify(rows));
  });
  await test('missing-SMTP-configuration-never-sends-or-claims-delivery', async () => {
    const saved = process.env.EMAIL_SMTP_PASSWORD; delete process.env.EMAIL_SMTP_PASSWORD;
    const count = deliveries.length;
    assert.equal((await route.GET()).status, 200); assert.equal((await (await route.GET()).json()).registrationEnabled, false);
    await assert.rejects(signup('not-configured@example.invalid', browser()), e => e.code === 'EMAIL_NOT_CONFIGURED');
    assert.equal(deliveries.length, count); process.env.EMAIL_SMTP_PASSWORD = saved;
  });
  await test('corrupt-storage-and-held-lock-fail-closed-without-reset-or-steal', () => {
    const filename = path.join(directory, 'cn-email-auth.json'); const original = fs.readFileSync(filename);
    fs.writeFileSync(filename, '{broken'); assert.throws(() => service.loginEmailMember(memberB.email, password));
    assert.equal(fs.readFileSync(filename, 'utf8'), '{broken'); fs.writeFileSync(filename, original);
    const lock = path.join(directory, '.cn-email-auth.lock'); fs.mkdirSync(lock);
    assert.throws(() => service.loginEmailMember(memberB.email, password)); assert.ok(fs.existsSync(lock)); fs.rmdirSync(lock);
  });
  await test('two-real-worker-processes-consume-once-and-create-one-member', async () => {
    const context = browser(); const challenge = await signup('workers@example.invalid', context); const code = deliveries.at(-1).code;
    const worker = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/email-auth-consume-worker.cjs'], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = ''; let error = '';
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { error += data; });
      child.on('error', reject); child.on('exit', status => status === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
      child.stdin.end(JSON.stringify({ id: challenge.challengeId, code, browser: context, now: clock }));
    });
    const results = await Promise.all([worker(), worker()]);
    assert.equal(results.filter(row => row.ok).length, 1);
    assert.equal(users.listLocalCnUsers().filter(row => row.email === 'workers@example.invalid').length, 1);
    assert.throws(() => service.verifyEmailRegistration(challenge.challengeId, code, context));
  });
  await test('secret-rotation-and-DB-mode-fail-closed', () => {
    const secret = process.env.EMAIL_AUTH_SECRET;
    process.env.EMAIL_AUTH_SECRET = crypto.randomBytes(32).toString('hex');
    assert.throws(() => service.loginEmailMember(memberC.email, password)); process.env.EMAIL_AUTH_SECRET = secret;
    process.env.DATABASE_URL = 'postgresql://unused.invalid/test';
    assert.throws(() => service.loginEmailMember(memberC.email, password), e => e.code === 'EMAIL_NOT_CONFIGURED');
    process.env.DATABASE_URL = '';
  });
  await test('legacy-session-and-real-phone-collision-rules-remain-intact', async () => {
    const session = { id: owner.id, name: owner.name, email: owner.email, role: owner.role, agentLevel: 1, region: 'CN' };
    const request = new NextRequest('https://email-test.invalid/api/auth/me', { headers: { cookie: `richsmart_session=${auth.createSessionToken(session)}` } });
    assert.equal((await auth.getFreshSessionUser(request)).id, owner.id);
    const input = { name: 'legacy', phone: '13800000001', email: 'legacy-phone@example.invalid', passwordHash: '', role: 'member', agentLevel: 1, referralCode: 'RS-LEGACY-TEST', referrerCode: null, store: null, wechatId: null };
    assert.ok(users.createLocalCnUser(input));
    assert.equal(users.createLocalCnUser({ ...input, email: 'different@example.invalid' }), null);
    assert.equal(users.createLocalCnUser({ ...input, phone: '13800000002', email: 'LEGACY-PHONE@EXAMPLE.INVALID' }), null);
  });
  await test('global-budget-stops-browser-and-email-rotation', async () => {
    const filename = path.join(directory, 'cn-email-auth.json'); const state = JSON.parse(fs.readFileSync(filename));
    state.budgets.push({ key: 'send:global', count: 100, until: clock + 3600000, last: clock });
    state.budgets = state.budgets.filter((row, i, rows) => row.key !== 'send:global' || i === rows.length - 1);
    fs.writeFileSync(filename, JSON.stringify(state));
    const count = deliveries.length;
    await assert.rejects(signup('budget-new@example.invalid', browser()), e => e.code === 'RATE_LIMITED');
    assert.equal(deliveries.length, count);
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  Date.now = realDateNow;
  Module._resolveFilename = oldResolve;
  if (oldTs) require.extensions['.ts'] = oldTs; else delete require.extensions['.ts'];
  for (const name of Object.keys(process.env)) if (!(name in previousEnvironment)) delete process.env[name];
  Object.assign(process.env, previousEnvironment);
  fs.rmSync(directory, { recursive: true, force: true });
}

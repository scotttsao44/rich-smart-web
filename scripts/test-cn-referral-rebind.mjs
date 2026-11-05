import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'richsmart-rebind-'));
const oldResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(name, parent, ...rest) {
  return oldResolve.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
require.extensions['.ts'] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
};

process.env.LOCAL_CN_DATA_DIR = directory;
process.env.DATABASE_URL = '';
process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');

const users = require('../lib/local-cn-users.ts');
const identities = require('../lib/local-cn-member-identities.ts');
const auth = require('../lib/auth.ts');
const { NextRequest } = require('next/server');
const route = require('../app/api/cn/ops/referral-rebind/route.ts');

function makeUser(partial) {
  const user = users.createLocalCnUser({
    name: partial.name,
    phone: partial.phone || '',
    email: partial.email,
    passwordHash: '',
    role: 'member',
    agentLevel: 1,
    referralCode: partial.referralCode,
    referrerCode: partial.referrerCode || null,
    referredByMemberId: partial.referredByMemberId || null,
    referralSource: partial.referralSource || null,
    platformAdmin: partial.platformAdmin === true,
    referralSharingEnabled: partial.referralSharingEnabled !== false,
    promotionQualificationStatus: partial.promotionQualificationStatus || null,
    store: null,
    wechatId: null,
  });
  assert.ok(user, `failed to create ${partial.email}`);
  return user;
}

const admin = makeUser({ name: '平台管理员', email: 'admin@rebind.invalid', referralCode: 'RS-REBIND-ADMIN', platformAdmin: true });
const owner = makeUser({ name: '推荐人甲', email: 'owner@rebind.invalid', referralCode: 'RS-REBIND-OWNER' });
const other = makeUser({ name: '推荐人乙', email: 'other@rebind.invalid', referralCode: 'RS-REBIND-OTHER' });
const disabled = makeUser({
  name: '已停用推荐人',
  email: 'disabled@rebind.invalid',
  referralCode: 'RS-REBIND-DISABLED',
  referralSharingEnabled: false,
  promotionQualificationStatus: 'disabled',
});
const member = makeUser({
  name: '普通会员',
  email: 'member@rebind.invalid',
  referralCode: 'RS-REBIND-MEMBER',
  referrerCode: owner.referralCode,
  referredByMemberId: owner.id,
  referralSource: 'phone_sms',
});

const before = users.findLocalCnUserById(member.id);
const updated = users.updateLocalCnMemberProfile(member.id, {
  name: '改过昵称',
  referrerCode: other.referralCode,
});
assert.equal(updated.name, '改过昵称');
assert.equal(updated.referredByMemberId, before.referredByMemberId);
assert.equal(updated.referrerCode, before.referrerCode);
assert.equal(updated.referralSource, before.referralSource);
users.updateLocalCnMemberProfile(member.id, { referrerCode: 'RS-CN-OFFICIAL' });
const still = users.findLocalCnUserById(member.id);
assert.equal(still.referredByMemberId, owner.id);
assert.equal(still.referrerCode, owner.referralCode);

const scanned = users.findOrCreateLocalWechatUser('oid-disabled', 'union-disabled', '旧码新会员', disabled.referralCode, 'official_account');
assert.equal(scanned.isNew, true);
assert.equal(users.isLocalCnAttributionPending(scanned.user), true);
assert.equal(scanned.user.referrerCode, null);
assert.equal(scanned.user.referredByMemberId, null);
assert.notEqual(scanned.user.referrerCode, 'RS-CN-OFFICIAL');
users.updateLocalCnMemberProfile(scanned.user.id, { name: '仍待确认', referrerCode: owner.referralCode });
const scannedAgain = users.findLocalCnUserById(scanned.user.id);
assert.equal(users.isLocalCnAttributionPending(scannedAgain), true);
assert.equal(scannedAgain.referrerCode, null);

const linked = identities.resolveLocalCnWechatIdentity({
  source: 'wechat_official',
  appId: 'wx-rebind-test',
  openId: 'oid-disabled-identity',
  unionId: 'union-disabled-identity',
  displayName: '服务号旧码',
  referrerCode: disabled.referralCode,
});
assert.equal(linked.status, 'linked');
assert.equal(users.isLocalCnAttributionPending(linked.user), true);
assert.equal(linked.user.referredByMemberId, null);
assert.equal(linked.user.referrerCode, null);

const eligible = users.findOrCreateLocalWechatUser('oid-eligible', 'union-eligible', '有效码新会员', owner.referralCode, 'official_account');
assert.equal(eligible.user.referredByMemberId, owner.id);
assert.equal(users.isLocalCnAttributionPending(eligible.user), false);

const phone = users.findOrCreateLocalPhoneUser({
  phone: '13800138000',
  displayName: '手机旧码',
  referrerCode: disabled.referralCode,
  referredByMemberId: disabled.id,
});
assert.equal(users.isLocalCnAttributionPending(phone.user), true);
assert.equal(phone.user.referredByMemberId, null);

assert.throws(() => users.rebindLocalCnMemberReferral({ memberId: member.id, actorId: admin.id, reason: '   ' }), (error) => error.message === '请填写改绑原因');
assert.throws(() => users.rebindLocalCnMemberReferral({
  memberId: member.id, actorId: admin.id, reason: '自己', referrerCode: member.referralCode,
}), (error) => error.message === '不能把会员绑定为自己的推荐人');

const child = makeUser({
  name: '下级',
  email: 'child@rebind.invalid',
  referralCode: 'RS-REBIND-CHILD',
  referrerCode: owner.referralCode,
  referredByMemberId: owner.id,
  referralSource: 'phone_sms',
});
assert.throws(() => users.rebindLocalCnMemberReferral({
  memberId: owner.id, actorId: admin.id, reason: '会循环', referrerMemberId: child.id,
}), (error) => error.message === '该推荐人会形成循环推荐，不能改绑');

const rebound = users.rebindLocalCnMemberReferral({
  memberId: member.id,
  actorId: admin.id,
  actorName: admin.name,
  reason: '原推荐人填错',
  referrerCode: other.referralCode,
});
assert.equal(rebound.member.referredByMemberId, other.id);
assert.equal(rebound.member.referrerCode, other.referralCode);
assert.equal(rebound.audit.actorId, admin.id);
assert.equal(rebound.audit.actorName, admin.name);
assert.equal(rebound.audit.fromReferrerMemberId, owner.id);
assert.equal(rebound.audit.fromReferrerCode, owner.referralCode);
assert.equal(rebound.audit.toReferrerCode, other.referralCode);
assert.equal(rebound.audit.reason, '原推荐人填错');
assert.match(rebound.audit.createdAt, /^\d{4}-\d{2}-\d{2}T/);
assert.match(rebound.audit.note, /不回溯/);
assert.equal(fs.existsSync(path.join(directory, 'cn-commerce.json')), false);

const official = users.rebindLocalCnMemberReferral({
  memberId: scanned.user.id,
  actorId: admin.id,
  actorName: admin.name,
  reason: '曹总指定官方直属',
  officialDirect: true,
});
assert.equal(official.member.referredByMemberId, null);
assert.equal(official.member.referrerCode, 'RS-CN-OFFICIAL');
assert.equal(official.member.referralSource, 'admin_official');
assert.equal(users.isLocalCnAttributionPending(official.member), false);
assert.equal(official.audit.toReferrerCode, 'RS-CN-OFFICIAL');
assert.equal(official.audit.fromReferrerName, '归属待确认');
const freshOfficial = users.findLocalCnUserById(scanned.user.id);
assert.equal(freshOfficial.referrerCode, 'RS-CN-OFFICIAL');
assert.equal(users.isLocalCnAttributionPending(freshOfficial), false);

const audits = users.listLocalCnReferralRebindAudits(member.id);
assert.equal(audits.length, 1);
assert.equal(audits[0].toReferrerMemberId, other.id);

function sessionFor(user) {
  return `richsmart_session=${auth.createSessionToken({
    id: user.id,
    name: user.name,
    email: user.email,
    agentLevel: user.agentLevel,
    role: user.role,
    region: 'CN',
    referralCode: user.referralCode,
    platformAdmin: user.platformAdmin === true,
  })}`;
}
async function post(cookie, body) {
  return route.POST(new NextRequest('https://rebind.invalid/api/cn/ops/referral-rebind', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  }));
}

const anonymous = await post('', { memberId: member.id, reason: '无登录', referrerCode: owner.referralCode });
assert.equal(anonymous.status, 401);
const forbidden = await post(sessionFor(member), { memberId: member.id, reason: '会员自己改', referrerCode: owner.referralCode });
assert.equal(forbidden.status, 403);
const allowed = await post(sessionFor(admin), { memberId: eligible.user.id, reason: '后台改到乙', referrerCode: other.referralCode });
assert.equal(allowed.status, 200);
const payload = await allowed.json();
assert.equal(payload.member.referredByMemberId, other.id);
assert.equal(payload.audit.actorId, admin.id);
assert.equal(payload.audit.fromReferrerMemberId, owner.id);
const listed = await route.GET(new NextRequest('https://rebind.invalid/api/cn/ops/referral-rebind?memberId=' + eligible.user.id, {
  headers: { cookie: sessionFor(admin) },
}));
assert.equal(listed.status, 200);
const listedBody = await listed.json();
assert.equal(listedBody.audits[0].memberId, eligible.user.id);
assert.equal(fs.existsSync(path.join(directory, 'cn-commerce.json')), false);

console.log('referral rebind checks passed');

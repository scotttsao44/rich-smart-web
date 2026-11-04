import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { listLocalCnMemberIdentities } from './local-cn-member-identities';
import { findLocalCnUserById, findLocalCnUserByReferralCode, listLocalCnUsers, referralOwnerForAttribution } from './local-cn-users';
import { isSimulatedOpenid, windowStatus } from './local-cn-store-owners';
import { addContactWay, findWecomUserIdByName, getExternalContact, getFollowUserList, listExternalContacts, wecomConfigured, type WecomFollowInfo } from './wecom-api';
import { sendMpCustomImage, sendMpCustomText, uploadMpTempImage } from './wechat-mp-api';

// 企业微信客户联系（自建应用「糙米健康助手」）
// 资料（LOCAL_CN_DATA_DIR，不入 git）：
//   wecom-config.json     「联系我」二维码：default（默认接待成员）、stores[门店 id]（预留：每店一码，state=s<门店>）、members[会员 id]（邀请用，state=m<会员>）、
//                         referrers[会员 id]（推广长图用，state=推荐码前 30 字符；加好友时记推荐人，先到先得）
//   wecom-customers.json  外部联系人（回调 add/del 与手动同步写入）、会员对应（已加企业微信）、邀请记录
// 企业未认证：客户上限 100 人（WECOM_CUSTOMER_CAP 可调）。

export const WECOM_CUSTOMER_CAP = Number(process.env.WECOM_CUSTOMER_CAP || 100);
const DEFAULT_MEMBER_NAME = '曹哲魁';
const INVITE_REF = process.env.WECOM_INVITE_REF || 'RS-CN-WX6JQ13EQR';
const MP_MEDIA_TTL_MS = 60 * 3600 * 1000; // 临时素材 3 天有效，留余量

export type ContactWay = { configId: string; qrCode: string; userid: string; state: string; createdAt: string; mpMediaId?: string; mpMediaAt?: string };
type WecomConfig = {
  schemaVersion: 1;
  defaultUserId: string;
  default: ContactWay | null;
  stores: Record<string, ContactWay>;
  members: Record<string, ContactWay>;
  referrers: Record<string, ContactWay>;
};

export type WecomCustomer = {
  externalUserId: string;
  name: string;
  unionid: string;
  state: string;
  followUsers: Array<{ userid: string; state: string; createtime: number }>;
  memberId: number | null;
  matchedBy: 'state' | 'unionid' | null;
  // 推荐人（推广长图「联系我」码 state=推荐码）：首次记录后不再覆盖
  referrerCode?: string;
  referrerMemberId?: number;
  referredAt?: string;
  status: 'active' | 'deleted';
  addedAt: string;
  updatedAt: string;
  deletedAt?: string;
};
type InviteRecord = { at: string; memberId: number; status: 'sent' | 'unreachable' | 'failed' | 'simulated' | 'already_added' | 'cap_reached'; channel: string; errcode?: string; byMemberId?: number };
type CustomerState = {
  schemaVersion: 1;
  customers: Record<string, WecomCustomer>;
  events: Array<{ at: string; changeType: string; externalUserId: string; userid: string; state: string; memberId: number | null }>;
  invites: InviteRecord[];
  syncedAt?: string;
  syncError?: string;
};

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const file = path.join(dataDir(), name);
    if (existsSync(file)) return { ...fallback, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    // fallthrough
  }
  return fallback;
}

function writeJson(name: string, value: unknown) {
  const file = path.join(dataDir(), name);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export function readWecomConfig(): WecomConfig {
  const c = readJson<WecomConfig>('wecom-config.json', { schemaVersion: 1, defaultUserId: '', default: null, stores: {}, members: {}, referrers: {} });
  return { schemaVersion: 1, defaultUserId: c.defaultUserId || '', default: c.default || null, stores: c.stores || {}, members: c.members || {}, referrers: c.referrers || {} };
}

function writeWecomConfig(c: WecomConfig) {
  writeJson('wecom-config.json', c);
}

function readCustomers(): CustomerState {
  const s = readJson<CustomerState>('wecom-customers.json', { schemaVersion: 1, customers: {}, events: [], invites: [] });
  return { ...s, schemaVersion: 1, customers: s.customers || {}, events: Array.isArray(s.events) ? s.events : [], invites: Array.isArray(s.invites) ? s.invites : [] };
}

function writeCustomers(s: CustomerState) {
  if (s.events.length > 3000) s.events.splice(0, s.events.length - 3000);
  if (s.invites.length > 3000) s.invites.splice(0, s.invites.length - 3000);
  writeJson('wecom-customers.json', s);
}

// ── 「联系我」二维码 ──
async function defaultUserId(config = readWecomConfig()) {
  if (process.env.WECOM_DEFAULT_USERID) return process.env.WECOM_DEFAULT_USERID;
  if (config.defaultUserId) return config.defaultUserId;
  const found = await findWecomUserIdByName(DEFAULT_MEMBER_NAME);
  if (found) {
    const c = readWecomConfig();
    c.defaultUserId = found;
    writeWecomConfig(c);
  }
  return found || '';
}

async function createWay(userid: string, state: string, remark: string): Promise<ContactWay> {
  const r = await addContactWay({ userid, state, remark, skipVerify: true });
  if (!r.ok || !r.configId || !r.qrCode) throw new Error(`创建联系我二维码失败（${r.errcode}${r.errmsg ? ` ${r.errmsg}` : ''}）`);
  return { configId: r.configId, qrCode: r.qrCode, userid, state, createdAt: new Date().toISOString() };
}

export async function ensureDefaultContactWay() {
  const config = readWecomConfig();
  if (config.default?.qrCode) return config.default;
  if (!wecomConfigured()) throw new Error('企业微信未配置');
  const userid = await defaultUserId(config);
  if (!userid) throw new Error('找不到默认接待成员（曹哲魁）的 userid');
  const way = await createWay(userid, 'default', '网站默认');
  const c = readWecomConfig();
  c.default = way;
  c.defaultUserId = userid;
  writeWecomConfig(c);
  return way;
}

// 预留：每个门店一码（state=s<门店 id>），绑定该店的企业成员 userid
export async function ensureStoreContactWay(storeId: string, userid: string) {
  const key = String(storeId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 28);
  if (!key || !userid) throw new Error('门店 id 与成员 userid 必填');
  const existing = readWecomConfig().stores[key];
  if (existing?.qrCode && existing.userid === userid) return existing;
  const way = await createWay(userid, `s${key}`, `门店${key}`.slice(0, 30));
  const c = readWecomConfig();
  c.stores[key] = way;
  writeWecomConfig(c);
  return way;
}

export async function ensureMemberContactWay(memberId: number) {
  const existing = readWecomConfig().members[String(memberId)];
  if (existing?.qrCode) return existing;
  const userid = await defaultUserId();
  if (!userid) throw new Error('找不到默认接待成员（曹哲魁）的 userid');
  const way = await createWay(userid, `m${memberId}`, `会员${memberId}`);
  const c = readWecomConfig();
  c.members[String(memberId)] = way;
  writeWecomConfig(c);
  return way;
}

// 推广长图：该会员（推荐人）专属「联系我」码，state=推荐码（≤30 字符），接待成员同默认（曹哲魁）
export async function ensureReferrerContactWay(memberId: number, referralCode: string) {
  const state = String(referralCode || '').trim().toUpperCase().slice(0, 30);
  if (!state) throw new Error('缺少推荐码');
  const existing = readWecomConfig().referrers[String(memberId)];
  if (existing?.qrCode && existing.state === state) return existing;
  if (!wecomConfigured()) throw new Error('企业微信未配置');
  const userid = await defaultUserId();
  if (!userid) throw new Error('找不到默认接待成员（曹哲魁）的 userid');
  const way = await createWay(userid, state, `推广${memberId}`.slice(0, 30));
  const c = readWecomConfig();
  c.referrers[String(memberId)] = way;
  writeWecomConfig(c);
  return way;
}

// state 为推荐码（推广长图「联系我」码）时返回推荐人；须仍有推荐资格
function referrerFromState(state: string) {
  const code = String(state || '').trim();
  if (!code || code === 'default' || /^m\d+$/.test(code) || /^s/.test(code)) return null;
  const owner = findLocalCnUserByReferralCode(code);
  if (!owner || !referralOwnerForAttribution(owner.id)) return null;
  return owner;
}

function patchMemberWay(memberId: number, patch: Partial<ContactWay>) {
  const c = readWecomConfig();
  const way = c.members[String(memberId)];
  if (!way) return;
  c.members[String(memberId)] = { ...way, ...patch };
  writeWecomConfig(c);
}

// ── 外部联系人 → 会员对应 ──
function memberIdFromState(state: string) {
  const m = /^m(\d{1,15})$/.exec(String(state || ''));
  if (!m) return null;
  const id = Number(m[1]);
  return findLocalCnUserById(id) ? id : null;
}

function memberIdFromUnionid(unionid: string) {
  if (!unionid) return null;
  const user = listLocalCnUsers().find((u) => u.wechatUnionId === unionid);
  if (user) return user.id;
  return listLocalCnMemberIdentities().identities.find((row) => row.unionId === unionid)?.memberId || null;
}

function upsertCustomer(s: CustomerState, externalUserId: string, contact: { name?: string; unionid?: string } | null, follows: WecomFollowInfo[]) {
  const prev = s.customers[externalUserId];
  const now = new Date().toISOString();
  const followUsers = follows.map((f) => ({ userid: String(f.userid), state: String(f.state || ''), createtime: Number(f.createtime || 0) }));
  const state = followUsers.map((f) => f.state).find((st) => memberIdFromState(st)) || followUsers.map((f) => f.state).find(Boolean) || prev?.state || '';
  const unionid = String(contact?.unionid || prev?.unionid || '');
  const byState = followUsers.map((f) => memberIdFromState(f.state)).find((id) => id) || null;
  const byUnion = byState ? null : memberIdFromUnionid(unionid);
  const memberId = byState || byUnion || prev?.memberId || null;
  const first = followUsers.map((f) => f.createtime).filter(Boolean).sort()[0];
  s.customers[externalUserId] = {
    externalUserId,
    name: String(contact?.name || prev?.name || ''),
    unionid,
    state,
    followUsers,
    memberId,
    matchedBy: byState ? 'state' : byUnion ? 'unionid' : prev?.matchedBy || null,
    status: followUsers.length ? 'active' : 'deleted',
    addedAt: prev?.addedAt || (first ? new Date(first * 1000).toISOString() : now),
    updatedAt: now,
    deletedAt: followUsers.length ? undefined : now,
    referrerCode: prev?.referrerCode,
    referrerMemberId: prev?.referrerMemberId,
    referredAt: prev?.referredAt,
  };
  return s.customers[externalUserId];
}

// 回调事件 change_external_contact
export async function handleExternalContactChange(msg: Record<string, string>) {
  const changeType = String(msg.ChangeType || '');
  const externalUserId = String(msg.ExternalUserID || '');
  const userid = String(msg.UserID || '');
  if (!externalUserId) return null;
  let customer: WecomCustomer | null = null;
  if (changeType === 'add_external_contact' || changeType === 'edit_external_contact' || changeType === 'add_half_external_contact') {
    const r = await getExternalContact(externalUserId);
    const s = readCustomers();
    if (r.ok) customer = upsertCustomer(s, externalUserId, r.contact, r.followUsers);
    else {
      // 取不到详情时先用事件里的 state 记录
      customer = upsertCustomer(s, externalUserId, null, [{ userid, state: String(msg.State || ''), createtime: Number(msg.CreateTime || 0) }]);
    }
    // 推荐人：add_external_contact 的 State（推荐码）首次记录，先到先得，不覆盖
    if (changeType === 'add_external_contact' && !customer.referrerCode) {
      const owner = referrerFromState(String(msg.State || ''));
      if (owner) {
        customer.referrerCode = owner.referralCode;
        customer.referrerMemberId = owner.id;
        customer.referredAt = new Date().toISOString();
      }
    }
    s.events.push({ at: new Date().toISOString(), changeType, externalUserId, userid, state: String(msg.State || ''), memberId: customer.memberId });
    writeCustomers(s);
  } else if (changeType === 'del_external_contact' || changeType === 'del_follow_user') {
    const s = readCustomers();
    const prev = s.customers[externalUserId];
    if (prev) {
      const rest = prev.followUsers.filter((f) => f.userid !== userid);
      customer = upsertCustomer(s, externalUserId, { name: prev.name, unionid: prev.unionid }, rest.map((f) => ({ userid: f.userid, state: f.state, createtime: f.createtime })));
    }
    s.events.push({ at: new Date().toISOString(), changeType, externalUserId, userid, state: String(msg.State || ''), memberId: prev?.memberId || null });
    writeCustomers(s);
  }
  return customer;
}

// 手动同步：按配置了客户联系的成员逐个拉取外部联系人（核对 x/100）
export async function syncWecomCustomers() {
  const f = await getFollowUserList();
  if (!f.ok) throw new Error(`读取客户联系成员失败（${f.errcode}）`);
  const seen = new Set<string>();
  for (const userid of f.followUsers) {
    const l = await listExternalContacts(userid);
    if (!l.ok) throw new Error(`读取客户列表失败（${l.errcode}）`);
    l.ids.forEach((id) => seen.add(id));
  }
  const s = readCustomers();
  for (const id of Array.from(seen)) {
    const known = s.customers[id];
    if (known && known.status === 'active') continue;
    const r = await getExternalContact(id);
    if (r.ok) upsertCustomer(s, id, r.contact, r.followUsers);
  }
  for (const c of Object.values(s.customers)) {
    if (c.status === 'active' && !seen.has(c.externalUserId)) {
      c.status = 'deleted';
      c.deletedAt = new Date().toISOString();
      c.followUsers = [];
    }
  }
  s.syncedAt = new Date().toISOString();
  writeCustomers(s);
  return { total: seen.size };
}

export function activeWecomCustomerCount() {
  return Object.values(readCustomers().customers).filter((c) => c.status === 'active').length;
}

export function wecomContactForMember(memberId: number) {
  const c = Object.values(readCustomers().customers).find((x) => x.status === 'active' && x.memberId === memberId && x.followUsers.length);
  if (!c) return null;
  const preferred = readWecomConfig().defaultUserId;
  const sender = c.followUsers.find((f) => f.userid === preferred)?.userid || c.followUsers[0].userid;
  return { externalUserId: c.externalUserId, sender, addedAt: c.addedAt };
}

// ── 邀请加企业微信（后台按钮，管理员点击后真实发送） ──
export function inviteText() {
  return [
    '你好，这里是糙米健康。',
    '添加我们的企业微信，门店体验预约、新品和活动消息会第一时间发给你，有问题也可以随时咨询。',
    '长按识别下方二维码即可添加。',
    `了解门店合作：https://rich-smart.com.cn/cn/afu?ref=${INVITE_REF}`,
  ].join('\n');
}

async function fetchImage(url: string) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`qr_fetch_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchQrImage(url: string) {
  if (!/^https:\/\/[^/]*(qpic\.cn|weixin\.qq\.com|qq\.com)\//.test(url)) throw new Error('bad_qr_url');
  return fetchImage(url);
}

export async function inviteMembersToWecom(memberIds: number[], byMemberId?: number) {
  const ids = Array.from(new Set(memberIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 50);
  const results: Array<{ memberId: number; name: string; status: InviteRecord['status']; label: string; qrCode?: string; errcode?: string }> = [];
  let count = activeWecomCustomerCount();
  for (const memberId of ids) {
    const user = findLocalCnUserById(memberId);
    const name = user?.name || `会员 ${memberId}`;
    const record = (status: InviteRecord['status'], channel: string, errcode?: string) => {
      const s = readCustomers();
      s.invites.push({ at: new Date().toISOString(), memberId, status, channel, errcode, byMemberId });
      writeCustomers(s);
    };
    if (!user) { results.push({ memberId, name, status: 'failed', label: '会员不存在' }); continue; }
    if (wecomContactForMember(memberId)) { results.push({ memberId, name, status: 'already_added', label: '已加企业微信' }); continue; }
    if (count >= WECOM_CUSTOMER_CAP) { record('cap_reached', 'none'); results.push({ memberId, name, status: 'cap_reached', label: `客户已达上限 ${WECOM_CUSTOMER_CAP}` }); continue; }
    let way: ContactWay;
    try {
      way = await ensureMemberContactWay(memberId);
    } catch (error) {
      results.push({ memberId, name, status: 'failed', label: error instanceof Error ? error.message : '二维码生成失败' });
      continue;
    }
    const openid = String(user.wechatOfficialOpenId || '');
    const w = windowStatus(openid);
    if (!openid || !w.open) {
      record('unreachable', 'manual');
      results.push({ memberId, name, status: 'unreachable', label: openid ? '无法触达（超过48小时）' : '无法触达（未绑定服务号）', qrCode: way.qrCode });
      continue;
    }
    if (isSimulatedOpenid(openid)) {
      record('simulated', 'wechat_kefu');
      results.push({ memberId, name, status: 'simulated', label: '模拟（未实发）', qrCode: way.qrCode });
      continue;
    }
    let mediaId = way.mpMediaId && way.mpMediaAt && Date.now() - Date.parse(way.mpMediaAt) < MP_MEDIA_TTL_MS ? way.mpMediaId : '';
    if (!mediaId) {
      try {
        const up = await uploadMpTempImage(await fetchQrImage(way.qrCode), `wecom-m${memberId}.jpg`);
        if (up.ok && up.mediaId) {
          mediaId = up.mediaId;
          patchMemberWay(memberId, { mpMediaId: mediaId, mpMediaAt: new Date().toISOString() });
        }
      } catch {
        mediaId = '';
      }
    }
    const t = await sendMpCustomText(openid, inviteText());
    if (!t.ok) {
      const unreachable = String(t.errcode) === '45015';
      record(unreachable ? 'unreachable' : 'failed', 'wechat_kefu', String(t.errcode));
      results.push({ memberId, name, status: unreachable ? 'unreachable' : 'failed', label: unreachable ? '无法触达（超过48小时）' : `发送失败（${t.errcode}）`, qrCode: way.qrCode, errcode: String(t.errcode) });
      continue;
    }
    const img = mediaId ? await sendMpCustomImage(openid, mediaId) : { ok: false, errcode: 'no_media' };
    record('sent', img.ok ? 'wechat_kefu:text+image' : 'wechat_kefu:text', img.ok ? '0' : String(img.errcode));
    results.push({ memberId, name, status: 'sent', label: img.ok ? '已发送（文字＋二维码）' : `已发送文字，二维码图片失败（${img.errcode}）`, qrCode: way.qrCode });
  }
  return { results, count: activeWecomCustomerCount(), cap: WECOM_CUSTOMER_CAP };
}

// ── 后台列表 ──
export function wecomOverview(people: Array<{ memberId: number; name: string; role: string }>) {
  const s = readCustomers();
  const c = readWecomConfig();
  const active = Object.values(s.customers).filter((x) => x.status === 'active');
  const lastInvite = (id: number) => s.invites.filter((r) => r.memberId === id).slice(-1)[0] || null;
  const rows = people.map((p) => {
    const user = findLocalCnUserById(p.memberId);
    const openid = String(user?.wechatOfficialOpenId || '');
    const added = active.find((x) => x.memberId === p.memberId) || null;
    return {
      memberId: p.memberId,
      name: p.name,
      role: p.role,
      bound: Boolean(openid),
      window: windowStatus(openid),
      wecomAdded: Boolean(added),
      wecomAddedAt: added?.addedAt || null,
      lastInvite: lastInvite(p.memberId),
      inviteQr: c.members[String(p.memberId)]?.qrCode || null,
    };
  });
  return {
    configured: wecomConfigured(),
    callbackConfigured: Boolean(process.env.WECOM_CALLBACK_TOKEN && process.env.WECOM_CALLBACK_AES_KEY),
    count: active.length,
    cap: WECOM_CUSTOMER_CAP,
    unmatched: active.filter((x) => !x.memberId).length,
    defaultQr: c.default ? { qrCode: c.default.qrCode, configId: c.default.configId, createdAt: c.default.createdAt } : null,
    storeQrCount: Object.keys(c.stores).length,
    syncedAt: s.syncedAt || null,
    inviteText: inviteText(),
    rows,
  };
}

export function memberInviteQr(memberId: number) {
  return readWecomConfig().members[String(memberId)]?.qrCode || null;
}

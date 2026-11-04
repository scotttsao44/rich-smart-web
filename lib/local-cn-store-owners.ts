import { createHmac, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { EXPERIENCE_POINTS, type ExperiencePoint } from './cn-experience-points';
import { linkLocalCnWechatIdentityToMember } from './local-cn-member-identities';
import { listActiveStoreApplicationsForNotify } from './local-cn-store-applications';
import { findLocalCnUserById, listLocalCnUsers } from './local-cn-users';
import { getKefuConversation } from './local-cn-wechat-kefu';
import { sendMpCustomText, sendMpTemplate } from './wechat-mp-api';
import { bookingNowText, sendBookingSuccessTemplate, type BookingTemplateInput } from './wechat-booking-notify';

// 店主／体验点负责人通知（预约与线索）
// - 资格：已开通门店申请的门店负责人，或后台在体验点上指定的负责人（ownerMemberIds）
// - 会员自己在会员中心勾选「接收预约与线索通知」；必须已绑定服务号 openid（扫码「糙米量子」带参二维码绑定）
// - 发送：模板消息（配置 WECHAT_STORE_OWNER_TEMPLATE_ID 或 WECHAT_KEFU_NOTIFY_TEMPLATE_ID 时）→ 否则客服消息（48 小时窗口）
// - 抄送 KEFU_NOTIFY_OPENIDS；店主未绑定／发送失败／30 分钟未确认 → 只通知 KEFU_NOTIFY_OPENIDS
// - SIMULATED_／SIMKB_ 开头的 openid 只记录不发送

export type OwnerEvent = {
  type: 'lead' | 'appointment' | 'test';
  city: string;
  phone?: string;
  source?: string;
  note?: string;
  test?: boolean;
  simulated?: boolean;
};

export type OwnerNotice = {
  id: string;
  at: string;
  targetId: string; // 体验点 id 或门店申请 id
  targetLabel: string;
  event: OwnerEvent['type'];
  city: string;
  phoneTail: string;
  memberId: number; // 0＝抄送／兜底接收人（KEFU_NOTIFY_OPENIDS）
  role: 'owner' | 'copy' | 'fallback' | 'escalation';
  channel: string;
  status: string;
  errcode?: string;
  ackAt?: string;
  escalatedAt?: string;
  test?: boolean;
  simulated?: boolean;
};

type OwnerState = {
  schemaVersion: 1;
  pointOwners: Record<string, number[]>;
  optIns: Record<string, { enabled: boolean; updatedAt: string }>;
  notices: OwnerNotice[];
};

const MAX_NOTICES = 3000;
const ACK_TIMEOUT_MS = 30 * 60 * 1000;
const WINDOW_MS = 48 * 60 * 60 * 1000;
export const OWNER_BIND_PREFIX = 'owner_bind';

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function stateFile() {
  return path.join(dataDir(), 'cn-store-owners.json');
}

function emptyState(): OwnerState {
  return { schemaVersion: 1, pointOwners: {}, optIns: {}, notices: [] };
}

function readState(): OwnerState {
  try {
    if (!existsSync(stateFile())) return emptyState();
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'));
    return {
      schemaVersion: 1,
      pointOwners: parsed.pointOwners && typeof parsed.pointOwners === 'object' ? parsed.pointOwners : {},
      optIns: parsed.optIns && typeof parsed.optIns === 'object' ? parsed.optIns : {},
      notices: Array.isArray(parsed.notices) ? parsed.notices : [],
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: OwnerState) {
  mkdirSync(path.dirname(stateFile()), { recursive: true });
  if (state.notices.length > MAX_NOTICES) state.notices.splice(0, state.notices.length - MAX_NOTICES);
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, stateFile());
}

function mutate<T>(fn: (state: OwnerState) => T) {
  const state = readState();
  const out = fn(state);
  writeState(state);
  return out;
}

function secret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-change-before-production';
}

function sign(value: string, len: number) {
  return createHmac('sha256', secret()).update(value).digest('base64url').slice(0, len);
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://rich-smart.com.cn').replace(/\/$/, '');
}

export function isSimulatedOpenid(openid: string) {
  return openid.startsWith('SIMULATED_') || openid.startsWith('SIMKB_');
}

export function adminNotifyOpenids() {
  return String(process.env.KEFU_NOTIFY_OPENIDS || '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{10,64}$/.test(s));
}

function nowText() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function shortText(text: string, max: number) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── 48 小时互动窗口（客服消息能否送达） ──
export function lastInteractionAt(openid: string) {
  const conv = openid ? getKefuConversation(openid) : null;
  if (!conv) return null;
  const times = [conv.lastUserAt, ...conv.messages.filter((m) => m.role === 'user' || (m.role === 'system' && m.type === 'event' && !m.text.includes('取消关注'))).map((m) => m.at)]
    .map((v) => Date.parse(String(v || '')))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

// 微信现行规则：只有「用户主动发消息」给 48 小时（5 条）客服消息额度；
// 关注、扫码、点菜单只给 1 分钟 3 条，后台操作记录（如「标记已处理」）不算互动。
export function kefuWindowStartAt(openid: string) {
  const conv = openid ? getKefuConversation(openid) : null;
  if (!conv) return null;
  const times = [conv.lastUserAt, ...conv.messages.filter((m) => m.role === 'user').map((m) => m.at)]
    .map((v) => Date.parse(String(v || '')))
    .filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

export function windowStatus(openid: string) {
  const last = kefuWindowStartAt(openid);
  if (!openid) return { open: false, lastInteractionAt: null, hoursLeft: 0, label: '未绑定' };
  if (!last) return { open: false, lastInteractionAt: null, hoursLeft: 0, label: '未主动发过消息（客服消息发不出）' };
  const left = Date.parse(last) + WINDOW_MS - Date.now();
  return left > 0
    ? { open: true, lastInteractionAt: last, hoursLeft: Math.floor(left / 3600000), label: `窗口内，约剩 ${Math.max(1, Math.floor(left / 3600000))} 小时` }
    : { open: false, lastInteractionAt: last, hoursLeft: 0, label: '已超过 48 小时' };
}

// ── 体验点 ownerMemberIds（后台可设置；底稿 EXPERIENCE_POINTS 不动） ──
export function experiencePointsWithOwners(state = readState()): Array<ExperiencePoint & { ownerMemberIds: number[] }> {
  return EXPERIENCE_POINTS.map((point) => ({
    ...point,
    ownerMemberIds: Array.from(new Set([...(point.ownerMemberIds || []), ...((state.pointOwners[point.id] || []).filter((n) => Number.isInteger(n) && n > 0))])),
  }));
}

export function setExperiencePointOwners(pointId: string, memberIds: number[]) {
  if (!EXPERIENCE_POINTS.some((point) => point.id === pointId)) throw new Error('找不到该体验点');
  const ids = Array.from(new Set(memberIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  for (const id of ids) if (!findLocalCnUserById(id)) throw new Error(`找不到会员 ${id}`);
  return mutate((state) => {
    state.pointOwners[pointId] = ids;
    return experiencePointsWithOwners(state).find((point) => point.id === pointId);
  });
}

function leaderStores(memberId: number) {
  return listActiveStoreApplicationsForNotify().filter((row) => row.applicantId === memberId || row.participants.some((p) => p.userId === memberId && p.role === '门店负责人'));
}

export function ownerEligibility(memberId: number, state = readState()) {
  const stores = leaderStores(memberId);
  const points = experiencePointsWithOwners(state).filter((point) => point.ownerMemberIds.includes(memberId));
  return {
    eligible: stores.length > 0 || points.length > 0,
    targets: [
      ...points.map((point) => ({ id: point.id, label: point.kefuLabel, city: point.city, source: '后台指定' })),
      ...stores.map((store) => ({ id: store.id, label: store.name, city: cityOfAddress(store.address), source: '门店负责人' })),
    ],
  };
}

function cityOfAddress(address: string) {
  const a = String(address || '');
  const point = EXPERIENCE_POINTS.find((p) => a.includes(p.city));
  if (point) return point.city;
  return a.replace(/^.{2,3}?省/, '').match(/^([\u4e00-\u9fa5]{2,4}?)市/)?.[1] || '';
}

export function getOwnerStatus(memberId: number) {
  const state = readState();
  const user = findLocalCnUserById(memberId);
  const openid = String(user?.wechatOfficialOpenId || '');
  const eligibility = ownerEligibility(memberId, state);
  return {
    eligible: eligibility.eligible,
    targets: eligibility.targets,
    bound: Boolean(openid),
    enabled: Boolean(state.optIns[String(memberId)]?.enabled) && Boolean(openid) && eligibility.eligible,
    window: windowStatus(openid),
  };
}

export function setOwnerOptIn(memberId: number, enabled: boolean) {
  const status = getOwnerStatus(memberId);
  if (enabled && !status.eligible) throw new Error('仅门店负责人或平台指定的体验点负责人可开启');
  if (enabled && !status.bound) throw new Error('请先扫码绑定「糙米量子」服务号');
  mutate((state) => {
    state.optIns[String(memberId)] = { enabled, updatedAt: new Date().toISOString() };
  });
  return getOwnerStatus(memberId);
}

function optedIn(memberId: number, state: OwnerState) {
  return Boolean(state.optIns[String(memberId)]?.enabled);
}

// ── 扫码绑定：服务号临时带参二维码 scene＝owner_bind:<会员>:<过期>:<签名> ──
export function ownerBindScene(memberId: number, ttlSeconds = 1800) {
  const exp = Math.floor(Date.now() / 1000 + ttlSeconds).toString(36);
  return `${OWNER_BIND_PREFIX}:${memberId}:${exp}:${sign(`bind:${memberId}:${exp}`, 12)}`;
}

export function parseOwnerBindScene(eventKey?: string | null) {
  const raw = String(eventKey || '').replace(/^qrscene_/, '').trim();
  const m = raw.match(/^owner_bind:(\d{1,15}):([0-9a-z]{1,10}):([A-Za-z0-9_-]{12})$/);
  if (!m) return null;
  const memberId = Number(m[1]);
  const expired = parseInt(m[2], 36) * 1000 < Date.now();
  const valid = safeEqual(m[3], sign(`bind:${memberId}:${m[2]}`, 12));
  return { memberId, expired, valid };
}

export function handleOwnerBindScan(openid: string, eventKey: string) {
  const parsed = parseOwnerBindScene(eventKey);
  if (!parsed) return null;
  if (!parsed.valid) return '二维码无效，请回到网站会员中心重新生成。';
  if (parsed.expired) return '二维码已过期，请回到网站会员中心刷新后再扫。';
  const user = findLocalCnUserById(parsed.memberId);
  if (!user) return '找不到对应的会员账号，请联系客服。';
  if (listLocalCnUsers().some((u) => u.id !== user.id && u.wechatOfficialOpenId === openid)) {
    return '这个微信已绑定其他会员账号，暂时不能重复绑定，请联系客服处理。';
  }
  try {
    linkLocalCnWechatIdentityToMember(user.id, { source: 'wechat_official', appId: process.env.WECHAT_OFFICIAL_APP_ID || 'wechat_official', openId: openid });
  } catch (error) {
    return `绑定未完成：${error instanceof Error ? error.message : '请联系客服'}`;
  }
  const status = getOwnerStatus(user.id);
  if (status.eligible) {
    mutate((state) => { state.optIns[String(user.id)] = { enabled: true, updatedAt: new Date().toISOString() }; });
    return '已绑定「糙米量子」服务号，并开启店主通知。之后有新的预约与线索会发到这里。\n收到通知后回复「收到」即可确认。';
  }
  return '已绑定「糙米量子」服务号。';
}

// ── 发送 ──
async function deliver(openid: string, text: string, tpl: Record<string, string> | null, url: string, simulated: boolean, booking?: BookingTemplateInput) {
  if (simulated || isSimulatedOpenid(openid)) return [{ channel: 'custom', status: 'simulated' }];
  const templateId = process.env.WECHAT_STORE_OWNER_TEMPLATE_ID || process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_ID || '';
  const order: Array<'template' | 'custom'> = templateId && tpl ? ['template', 'custom'] : ['custom'];
  const out: Array<{ channel: string; status: string; errcode?: string }> = [];
  for (const channel of order) {
    const r = channel === 'template' ? await sendMpTemplate(openid, templateId, url, tpl || {}) : await sendMpCustomText(openid, text);
    out.push({ channel, status: r.ok ? 'sent' : 'failed', errcode: r.ok ? '0' : String(r.errcode) });
    if (r.ok) break;
  }
  // 预约通知：客服消息 45015（超过 48 小时未互动）时改发「预约成功通知」模板消息（不受 48 小时限制）
  const last = out[out.length - 1];
  if (booking && last && last.channel === 'custom' && last.errcode === '45015') {
    const r = await sendBookingSuccessTemplate(openid, { ...booking, url: booking.url || url }, 'owner-fallback');
    out.push({ channel: 'booking_tpl', status: r.ok ? 'sent' : 'failed', errcode: r.ok ? '0' : String(r.errcode) });
  }
  return out;
}

function ackLink(id: string) {
  return `${appUrl()}/api/cn/store-owner/ack?n=${encodeURIComponent(id)}&s=${sign(`ack:${id}`, 16)}`;
}

export function verifyAck(id: string, sig: string) {
  return safeEqual(String(sig || ''), sign(`ack:${id}`, 16));
}

function eventLabel(type: OwnerEvent['type']) {
  return type === 'appointment' ? '新预约' : type === 'test' ? '测试通知' : '新线索';
}

function resolveTarget(targetId: string, state: OwnerState) {
  const point = experiencePointsWithOwners(state).find((p) => p.id === targetId);
  if (point) return { id: point.id, label: point.kefuLabel, city: point.city, ownerIds: point.ownerMemberIds };
  const store = listActiveStoreApplicationsForNotify().find((s) => s.id === targetId);
  if (store) {
    const leaders = store.participants.filter((p) => p.role === '门店负责人').map((p) => p.userId);
    return { id: store.id, label: store.name, city: cityOfAddress(store.address), ownerIds: Array.from(new Set([store.applicantId, ...leaders])) };
  }
  return null;
}

function record(notice: Omit<OwnerNotice, 'id' | 'at'>) {
  return mutate((state) => {
    const row: OwnerNotice = { ...notice, id: `ON-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() };
    state.notices.push(row);
    return row;
  });
}

async function sendToAdmins(text: string, base: Omit<OwnerNotice, 'id' | 'at' | 'memberId' | 'channel' | 'status' | 'role'>, role: OwnerNotice['role']) {
  const rows: OwnerNotice[] = [];
  for (const openid of adminNotifyOpenids()) {
    const results = await deliver(openid, text, null, '', Boolean(base.simulated));
    const last = results[results.length - 1];
    rows.push(record({ ...base, memberId: 0, role, channel: last.channel, status: last.status, errcode: last.errcode }));
  }
  return rows;
}

// 发给某体验点／门店的店主，抄送曹总；copyToAdmins=false 时由调用方自己通知曹总（例如客服线索已有转人工通知）
export async function notifyStoreOwner(targetId: string, event: OwnerEvent, opts: { copyToAdmins?: boolean } = {}) {
  const state = readState();
  const target = resolveTarget(targetId, state);
  if (!target) return { ok: false, reason: 'target_not_found', notices: [] as OwnerNotice[] };
  const tag = event.test ? '【测试】' : '';
  const phone = String(event.phone || '').trim();
  const base = { targetId: target.id, targetLabel: target.label, event: event.type, city: event.city || target.city, phoneTail: phone.slice(-4), test: event.test, simulated: event.simulated };
  const lines = [
    `${tag}【糙米量子 · ${eventLabel(event.type)}】`,
    `城市：${event.city || target.city || '未提供'}`,
    `门店：${target.label}`,
    `客人手机：${phone || '未提供'}`,
    event.source ? `来源：${event.source}` : '',
    event.note ? `备注：${shortText(event.note, 60)}` : '',
    `时间：${nowText()}`,
  ].filter(Boolean);
  const notices: OwnerNotice[] = [];
  let delivered = 0;
  let hadOwner = false;
  for (const memberId of target.ownerIds) {
    const user = findLocalCnUserById(memberId);
    const openid = String(user?.wechatOfficialOpenId || '');
    if (!user || !optedIn(memberId, state)) {
      notices.push(record({ ...base, memberId, role: 'owner', channel: 'none', status: user ? 'not_enabled' : 'member_not_found' }));
      continue;
    }
    hadOwner = true;
    if (!openid) {
      notices.push(record({ ...base, memberId, role: 'owner', channel: 'none', status: 'no_openid' }));
      continue;
    }
    const pending = record({ ...base, memberId, role: 'owner', channel: 'pending', status: 'pending' });
    const text = `${lines.join('\n')}\n确认收到：回复「收到」，或点 ${ackLink(pending.id)}`;
    const results = await deliver(openid, text, {
      thing1: shortText(`${tag}${eventLabel(event.type)} ${event.city || target.city}`, 18),
      thing2: shortText(`客人手机 ${phone || '未提供'}`, 18),
      time3: nowText(),
    }, ackLink(pending.id), Boolean(event.simulated), event.type === 'appointment' ? {
      store: `${tag}${target.label}`,
      item: event.note || '阿富同学体验',
      time: bookingNowText(),
      address: target.label,
    } : undefined);
    const last = results[results.length - 1];
    const row = mutate((s) => {
      const r = s.notices.find((n) => n.id === pending.id);
      if (r) Object.assign(r, { channel: results.map((x) => x.channel).join('→'), status: last.status, errcode: last.errcode });
      return r || pending;
    });
    notices.push(row);
    if (['sent', 'simulated'].includes(last.status)) delivered += 1;
  }
  if (opts.copyToAdmins !== false) {
    notices.push(...await sendToAdmins(`${lines.join('\n').replace(/^(【测试】)?【/, '$1【抄送 · ')}\n店主：${delivered ? '已送达' : '未送达，请直接跟进'}`, base, 'copy'));
  } else if (hadOwner && !delivered) {
    notices.push(...await sendToAdmins(`${tag}【店主未收到通知】${target.label}\n城市：${base.city || '未提供'}\n客人手机：${phone || '未提供'}\n原因：店主未绑定服务号或发送失败，请直接跟进。`, base, 'fallback'));
  }
  if (delivered) scheduleEscalation();
  return { ok: true, delivered, notices };
}

// 线索按城市路由：同城所有体验点与已开通门店的店主都通知
export async function notifyStoreOwnersForCity(city: string, event: Omit<OwnerEvent, 'city'>, opts: { copyToAdmins?: boolean } = {}) {
  const c = String(city || '').trim();
  if (!c) return { routed: 0, targets: [] as string[] };
  const state = readState();
  const targets = [
    ...experiencePointsWithOwners(state).filter((p) => p.city === c).map((p) => p.id),
    ...listActiveStoreApplicationsForNotify().filter((s) => cityOfAddress(s.address) === c || String(s.address || '').includes(c)).map((s) => s.id),
  ];
  for (const id of targets) await notifyStoreOwner(id, { ...event, city: c }, opts);
  return { routed: targets.length, targets };
}

// ── 确认与 30 分钟未确认升级 ──
export function ackOwnerNotice(id: string) {
  return mutate((state) => {
    const row = state.notices.find((n) => n.id === id && n.role === 'owner');
    if (!row) return null;
    row.ackAt = row.ackAt || new Date().toISOString();
    return row;
  });
}

export function ackPendingByOpenid(openid: string) {
  // 返回 -1：不是已开启通知的店主；否则返回本次确认的通知数
  const user = listLocalCnUsers().find((u) => u.wechatOfficialOpenId === openid);
  if (!user || !optedIn(user.id, readState())) return -1;
  return mutate((state) => {
    let count = 0;
    for (const row of state.notices) {
      if (row.role === 'owner' && row.memberId === user.id && !row.ackAt && ['sent', 'simulated'].includes(row.status) && Date.now() - Date.parse(row.at) < 24 * 3600000) {
        row.ackAt = new Date().toISOString();
        count += 1;
      }
    }
    return count;
  });
}

export async function escalateUnconfirmed(opts: { dryRun?: boolean } = {}) {
  const state = readState();
  const due = state.notices.filter((n) => n.role === 'owner' && ['sent', 'simulated'].includes(n.status) && !n.ackAt && !n.escalatedAt && Date.now() - Date.parse(n.at) >= ACK_TIMEOUT_MS && Date.now() - Date.parse(n.at) < 24 * 3600000);
  if (opts.dryRun) return { due: due.length, escalated: 0 };
  for (const n of due) {
    mutate((s) => { const r = s.notices.find((x) => x.id === n.id); if (r) r.escalatedAt = new Date().toISOString(); });
    const owner = findLocalCnUserById(n.memberId);
    await sendToAdmins(`${n.test ? '【测试】' : ''}【店主 30 分钟未确认】${n.targetLabel}\n城市：${n.city || '未提供'}\n客人手机尾号：${n.phoneTail || '未提供'}\n店主：${owner?.name || n.memberId}\n请直接跟进客人。`, {
      targetId: n.targetId, targetLabel: n.targetLabel, event: n.event, city: n.city, phoneTail: n.phoneTail, test: n.test, simulated: n.simulated,
    }, 'escalation');
  }
  return { due: due.length, escalated: due.length };
}

let escalationTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleEscalation() {
  if (escalationTimer) return;
  escalationTimer = setTimeout(() => {
    escalationTimer = null;
    escalateUnconfirmed().catch(() => console.warn('[store-owner] escalate error'));
  }, ACK_TIMEOUT_MS + 30_000);
  escalationTimer.unref?.();
}

// ── 后台「需要推送的人」 ──
export function listPushPeople() {
  const state = readState();
  const points = experiencePointsWithOwners(state);
  const ids = new Set<number>();
  for (const p of points) p.ownerMemberIds.forEach((id) => ids.add(id));
  for (const s of listActiveStoreApplicationsForNotify()) ids.add(s.applicantId);
  for (const [id, v] of Object.entries(state.optIns)) if (v.enabled) ids.add(Number(id));
  const lastNotice = (memberId: number) => state.notices.filter((n) => n.memberId === memberId && n.role === 'owner').slice(-1)[0] || null;
  const owners = Array.from(ids).filter((id) => id > 0).map((id) => {
    const user = findLocalCnUserById(id);
    const openid = String(user?.wechatOfficialOpenId || '');
    const elig = ownerEligibility(id, state);
    return {
      memberId: id,
      name: user?.name || `会员 ${id}`,
      targets: elig.targets,
      eligible: elig.eligible,
      enabled: optedIn(id, state) && Boolean(openid) && elig.eligible,
      bound: Boolean(openid),
      window: windowStatus(openid),
      lastNotice: lastNotice(id),
    };
  });
  const admins = adminNotifyOpenids().map((openid) => {
    const last = state.notices.filter((n) => n.memberId === 0).slice(-1)[0] || null;
    const user = listLocalCnUsers().find((u) => u.wechatOfficialOpenId === openid);
    return { openidTail: openid.slice(-6), name: user?.name || '抄送接收人', window: windowStatus(openid), lastNotice: last };
  });
  return {
    owners,
    admins,
    points: points.map((p) => ({ id: p.id, city: p.city, label: p.kefuLabel, ownerMemberIds: p.ownerMemberIds })),
    recent: state.notices.slice(-30).reverse(),
  };
}

export function listOptedInOwners() {
  const state = readState();
  return Object.entries(state.optIns)
    .filter(([, v]) => v.enabled)
    .map(([id]) => Number(id))
    .map((id) => ({ id, user: findLocalCnUserById(id), elig: ownerEligibility(id, state) }))
    .filter((row) => row.user && row.user.wechatOfficialOpenId && row.elig.eligible);
}

export function ownerNoticesSince(memberId: number, sinceMs: number) {
  return readState().notices.filter((n) => n.memberId === memberId && n.role === 'owner' && Date.parse(n.at) >= sinceMs && n.event !== 'test');
}

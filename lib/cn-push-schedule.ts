import { FOLLOW_QR_HINT } from './local-cn-follow-qr';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { confirmedRecentIncome, listMemberTiersForPush, readWakeupAssets } from './local-cn-referral-engagement';
import { adminNotifyOpenids, escalateUnconfirmed, isSimulatedOpenid, lastInteractionAt, listOptedInOwners, ownerNoticesSince, windowStatus } from './local-cn-store-owners';
import { findLocalCnUserById, getFrozenReferrerCode, listLocalCnUsers, normalizeCnReferrerCode, type LocalCnUser } from './local-cn-users';
import { sendMpCustomArticle, sendMpCustomImage, sendMpCustomText } from './wechat-mp-api';
import { wecomContactForMember } from './local-cn-wecom';
import { addMsgTemplate } from './wecom-api';

// 分层唤醒排程（由例行任务每天调用 POST /api/cn/push-jobs?task=daily）
// 渠道：只用服务号客服消息（48 小时互动窗口内）；不用群发。窗口外一律跳过并记录原因。
// 分层与冷却：
//   店主（已勾选店主通知）：每天一份简报（今日线索、今日素材、本人近 7 天已确认收益，仅本人可见）
//   活跃（7 天内有动作）：每 7 天最多 1 次，图文素材
//   降温／待启动：每 3 天最多 1 次（每周 1–2 次）
//   沉睡（30 天以上）：每 10 天最多 1 次，连续 3 次后停止，直到会员重新活跃
//   人工一键唤醒 2 天内发过的不再排程；回复「退订」的不再排程
// 真实发送需同时满足：dryRun=false 且环境变量 PUSH_WAKE_LIVE=1；否则只生成计划（dry-run）。
// testOpenid（必须在 KEFU_NOTIFY_OPENIDS 内）：只给这一个 openid 真发一份【测试】样本。
// 已加企业微信的会员：改走企业微信群发助手（add_msg_template，成员需在手机确认；每位客户每天最多 1 条），不受 48 小时窗口限制。

type Tier = 'owner' | 'active' | 'cooling' | 'pending_start' | 'sleeping';
const RULES: Record<Exclude<Tier, 'owner'>, { intervalDays: number; maxStreak?: number; label: string }> = {
  active: { intervalDays: 7, label: '活跃' },
  cooling: { intervalDays: 3, label: '降温' },
  pending_start: { intervalDays: 3, label: '待启动' },
  sleeping: { intervalDays: 10, maxStreak: 3, label: '沉睡' },
};
const MANUAL_COOLDOWN_MS = 2 * 86400000;
const BATCH_LIMIT = 100;

type SendRecord = { memberId: number; at: string; tier: Tier; status: string; channel: string; errcode?: string; test?: boolean };
type ScheduleState = {
  schemaVersion: 1;
  sends: SendRecord[];
  streaks: Record<string, { tier: Tier; count: number }>;
  optOut: Record<string, string>;
  runs: Array<{ at: string; task: string; dryRun: boolean; live: boolean; summary: Record<string, number> }>;
};

function file() {
  return path.join(process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data'), 'cn-push-schedule.json');
}

function readState(): ScheduleState {
  try {
    if (existsSync(file())) {
      const p = JSON.parse(readFileSync(file(), 'utf8'));
      return { schemaVersion: 1, sends: Array.isArray(p.sends) ? p.sends : [], streaks: p.streaks || {}, optOut: p.optOut || {}, runs: Array.isArray(p.runs) ? p.runs : [] };
    }
  } catch {
    // fallthrough
  }
  return { schemaVersion: 1, sends: [], streaks: {}, optOut: {}, runs: [] };
}

function writeState(state: ScheduleState) {
  mkdirSync(path.dirname(file()), { recursive: true });
  if (state.sends.length > 20000) state.sends.splice(0, state.sends.length - 20000);
  if (state.runs.length > 500) state.runs.splice(0, state.runs.length - 500);
  const tmp = `${file()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file());
}

export function setPushOptOut(openid: string, out: boolean) {
  const state = readState();
  if (out) state.optOut[openid] = new Date().toISOString();
  else delete state.optOut[openid];
  writeState(state);
}

function shanghaiDayStart(now = Date.now()) {
  const d = new Date(now + 8 * 3600000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 8 * 3600000;
}

function money(v: number) {
  return `¥${Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function linkFor(member: LocalCnUser | null, base: string) {
  const own = member && member.referralSharingEnabled !== false ? String(member.referralCode || '').trim() : '';
  const attributed = member ? String(getFrozenReferrerCode(member) || '').trim() : '';
  const code = own ? normalizeCnReferrerCode(own) : attributed ? normalizeCnReferrerCode(attributed) : '';
  try {
    const url = new URL(base, 'https://rich-smart.com.cn');
    if (code && /(^|\.)rich-smart\.com\.cn$/.test(url.hostname) && !url.searchParams.get('ref')) url.searchParams.set('ref', code);
    return url.toString();
  } catch {
    return base;
  }
}

function callName(member: LocalCnUser | null) {
  const n = String(member?.name || '').trim();
  return n && !n.startsWith('微信会员') && !n.startsWith('微信用户') ? n : '你好';
}

export function ownerDigestText(member: LocalCnUser | null, tag = '') {
  const assets = readWakeupAssets();
  const today = member ? ownerNoticesSince(member.id, shanghaiDayStart()) : [];
  const date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const leadLines = today.slice(-5).map((n) => `· ${n.city || '未提供城市'}｜手机尾号 ${n.phoneTail || '—'}${n.ackAt ? '（已确认）' : ''}`);
  const income = member ? confirmedRecentIncome(member.id, 7) : 0;
  return [
    `${tag}【今日门店简报】${date}`,
    `今日新线索：${today.length} 条`,
    ...leadLines,
    `近 7 天已确认收益：${money(income)}（仅你本人可见）`,
    `今日素材：${assets.linkTitle}`,
    linkFor(member, assets.linkUrl),
    '回复「收到」确认，明天继续为你推送简报。',
  ].join('\n');
}

function wakeText(member: LocalCnUser, tier: Exclude<Tier, 'owner'>, tag = '') {
  const assets = readWakeupAssets();
  const link = linkFor(member, assets.linkUrl);
  const name = callName(member);
  if (tier === 'active') return `${tag}${name}，本周新内容：${assets.linkTitle}\n${link}\n${FOLLOW_QR_HINT}`;
  if (tier === 'sleeping') return `${tag}${name}，富智慧给你留了一份新内容：${assets.linkTitle}\n${link}\n${FOLLOW_QR_HINT}\n不想再收到此类提醒，回复「退订」即可。`;
  return `${tag}${name}，好久不见。最近有新内容：${assets.linkTitle}\n${link}\n${FOLLOW_QR_HINT}\n想了解附近体验点，直接回复所在城市即可。`;
}

async function sendRich(openid: string, text: string, withMedia: boolean) {
  if (isSimulatedOpenid(openid)) return { channel: 'custom', status: 'simulated' as const };
  const r = await sendMpCustomText(openid, text);
  if (!r.ok) return { channel: 'custom', status: 'failed' as const, errcode: String(r.errcode) };
  const assets = readWakeupAssets();
  let channel = 'custom';
  if (withMedia && assets.articleId) {
    const a = await sendMpCustomArticle(openid, assets.articleId);
    if (a.ok) channel += '+article';
  } else if (withMedia && assets.coverMediaId) {
    const i = await sendMpCustomImage(openid, assets.coverMediaId);
    if (i.ok) channel += '+image';
  }
  return { channel, status: 'sent' as const, errcode: '0' };
}

// 企业微信群发助手：创建任务即记为 sent（成员手机确认后才真正发出）
async function sendWecom(memberId: number, text: string) {
  const contact = wecomContactForMember(memberId);
  if (!contact) return { channel: 'wecom_template', status: 'failed' as const, errcode: 'not_added' };
  const r = await addMsgTemplate({ sender: contact.sender, externalUserIds: [contact.externalUserId], text });
  if (!r.ok) return { channel: 'wecom_template', status: 'failed' as const, errcode: String(r.errcode) };
  if (r.failList.includes(contact.externalUserId)) return { channel: 'wecom_template', status: 'failed' as const, errcode: 'fail_list' };
  return { channel: 'wecom_template', status: 'sent' as const, errcode: '0' };
}

type PlanRow = {
  memberId: number;
  name: string;
  tier: Tier;
  tierLabel: string;
  action: 'send' | 'skip';
  reason: string;
  window: string;
  lastSentAt: string | null;
  preview?: string;
  channel: 'mp_kefu' | 'wecom';
};

export function buildPushPlan() {
  const state = readState();
  const now = Date.now();
  const admins = new Set(adminNotifyOpenids());
  const lastSend = (memberId: number, tier?: Tier) => state.sends
    .filter((s) => s.memberId === memberId && s.status === 'sent' && !s.test && (!tier || (tier === 'owner') === (s.tier === 'owner')))
    .map((s) => s.at).sort().pop() || null;
  const rows: PlanRow[] = [];
  const ownerIds = new Set<number>();
  for (const owner of listOptedInOwners()) {
    const user = owner.user as LocalCnUser;
    ownerIds.add(user.id);
    const w = windowStatus(String(user.wechatOfficialOpenId));
    const wecom = wecomContactForMember(user.id);
    const last = lastSend(user.id, 'owner');
    const sentToday = last && Date.parse(last) >= shanghaiDayStart(now);
    const action = !w.open && !wecom ? 'skip' : sentToday ? 'skip' : 'send';
    rows.push({ memberId: user.id, name: user.name, tier: 'owner', tierLabel: '店主', action, reason: !w.open && !wecom ? `客服消息窗口：${w.label}` : sentToday ? '今天已发过简报' : wecom ? '每日简报（企业微信群发助手）' : '每日简报', window: w.label, lastSentAt: last, preview: action === 'send' ? ownerDigestText(user) : undefined, channel: wecom ? 'wecom' : 'mp_kefu' });
  }
  for (const row of listMemberTiersForPush(lastInteractionAt)) {
    if (ownerIds.has(row.member.id) || admins.has(row.openid)) continue;
    const tier = (row.tier in RULES ? row.tier : 'sleeping') as Exclude<Tier, 'owner'>;
    const rule = RULES[tier];
    const w = windowStatus(row.openid);
    const wecom = wecomContactForMember(row.member.id);
    const last = lastSend(row.member.id);
    const streak = state.streaks[String(row.member.id)];
    let reason = '';
    if (state.optOut[row.openid]) reason = '已回复退订';
    else if (row.lastReminderAt && now - Date.parse(row.lastReminderAt) < MANUAL_COOLDOWN_MS) reason = '2 天内已有人工唤醒';
    else if (last && now - Date.parse(last) < rule.intervalDays * 86400000) reason = `冷却中（每 ${rule.intervalDays} 天最多 1 次）`;
    else if (rule.maxStreak && streak?.tier === tier && streak.count >= rule.maxStreak) reason = `沉睡已连续 ${rule.maxStreak} 次，停止推送`;
    else if (!w.open && !wecom) reason = `客服消息窗口：${w.label}`;
    rows.push({ memberId: row.member.id, name: row.member.name, tier, tierLabel: rule.label, action: reason ? 'skip' : 'send', reason: reason || `${rule.label}：每 ${rule.intervalDays} 天 1 次${wecom ? '（企业微信群发助手）' : ''}`, window: w.label, lastSentAt: last, preview: reason ? undefined : wakeText(row.member, tier), channel: wecom ? 'wecom' : 'mp_kefu' });
  }
  return rows;
}

function summarize(rows: PlanRow[]) {
  const summary: Record<string, number> = { total: rows.length, send: 0, skip: 0 };
  for (const r of rows) {
    summary[r.action] += 1;
    summary[`${r.tier}_${r.action}`] = (summary[`${r.tier}_${r.action}`] || 0) + 1;
  }
  return summary;
}

export async function runPushSchedule(opts: { task?: string; dryRun?: boolean; testOpenid?: string }) {
  const task = opts.task || 'daily';
  const liveAllowed = process.env.PUSH_WAKE_LIVE === '1';
  const live = opts.dryRun === false && liveAllowed;
  // 30 分钟未确认升级只通知 KEFU_NOTIFY_OPENIDS（内部），task=escalate 时真实执行；daily 只报告待升级数量
  const escalation = await escalateUnconfirmed({ dryRun: task !== 'escalate' });
  if (task === 'escalate') return { task, dryRun: !live, liveAllowed, escalation };
  const rows = buildPushPlan();
  const summary = summarize(rows);
  const result: Record<string, unknown> = { task, dryRun: !live, liveAllowed, escalation, summary, plan: rows };

  if (opts.testOpenid) {
    const testOpenid = String(opts.testOpenid);
    if (!adminNotifyOpenids().includes(testOpenid)) return { ...result, test: { ok: false, reason: 'testOpenid 必须在 KEFU_NOTIFY_OPENIDS 内' } };
    const self = listLocalCnUsers().find((u) => u.wechatOfficialOpenId === testOpenid) || null;
    const r = await sendRich(testOpenid, ownerDigestText(self, '【测试】'), true);
    const state = readState();
    state.sends.push({ memberId: self?.id || 0, at: new Date().toISOString(), tier: 'owner', status: r.status, channel: r.channel, errcode: r.errcode, test: true });
    state.runs.push({ at: new Date().toISOString(), task: `${task}:test`, dryRun: true, live: false, summary });
    writeState(state);
    return { ...result, test: { ok: r.status === 'sent', channel: r.channel, status: r.status, errcode: r.errcode, window: windowStatus(testOpenid).label } };
  }

  const sent: Array<{ memberId: number; tier: Tier; status: string; channel: string; errcode?: string }> = [];
  if (live) {
    for (const row of rows.filter((r) => r.action === 'send').slice(0, BATCH_LIMIT)) {
      const user = findLocalCnUserById(row.memberId);
      const openid = String(user?.wechatOfficialOpenId || '');
      if (!user || (!openid && row.channel !== 'wecom')) continue;
      const text = row.tier === 'owner' ? ownerDigestText(user) : wakeText(user, row.tier as Exclude<Tier, 'owner'>);
      const r = row.channel === 'wecom' ? await sendWecom(row.memberId, text) : await sendRich(openid, text, true);
      sent.push({ memberId: row.memberId, tier: row.tier, status: r.status, channel: r.channel, errcode: r.errcode });
      const state = readState();
      state.sends.push({ memberId: row.memberId, at: new Date().toISOString(), tier: row.tier, status: r.status, channel: r.channel, errcode: r.errcode });
      if (r.status === 'sent' && row.tier !== 'owner') {
        const key = String(row.memberId);
        const prev = state.streaks[key];
        state.streaks[key] = { tier: row.tier, count: prev && prev.tier === row.tier ? prev.count + 1 : 1 };
      }
      writeState(state);
    }
  }
  const state = readState();
  state.runs.push({ at: new Date().toISOString(), task, dryRun: !live, live, summary: { ...summary, sent: sent.filter((s) => s.status === 'sent').length } });
  writeState(state);
  return { ...result, sent };
}

export function lastPushRuns(limit = 10) {
  return readState().runs.slice(-limit).reverse();
}

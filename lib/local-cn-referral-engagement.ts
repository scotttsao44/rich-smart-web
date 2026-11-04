import { FOLLOW_QR_HINT } from '@/lib/local-cn-follow-qr';
import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import type { SessionUser } from './auth';
import { commerceSnapshot, getWallet } from './local-cn-commerce';
import { findLocalCnUserById, getFrozenReferrerCode, listLocalCnUsers, normalizeCnReferrerCode, type LocalCnUser } from './local-cn-users';
import { sendMpCustomArticle, sendMpCustomImage, sendMpCustomText, sendMpTemplate } from './wechat-mp-api';
import { getWorkspace } from './local-cn-workspaces';
import { isPaidEngagementOrder, matchesEngagementMember } from './vendor-member-store-view';

type ReferralVisitEvent = {
  id: string;
  referralCode: string;
  visitorHash: string;
  sessionHash: string;
  userAgentHash: string;
  sourcePath: string;
  botFiltered: boolean;
  duplicate: boolean;
  createdAt: string;
};

type ReferralReminder = {
  id: string;
  senderId: number;
  recipientId: number;
  template: 'winback' | 'appointment';
  status: 'sent' | 'skipped';
  reason: string;
  // in_app：仅站内通知；其余为站内通知 + 服务号渠道（wechat_kefu 客服消息 / wechat_template 模板消息）
  channel: 'in_app' | 'in_app+wechat_kefu' | 'in_app+wechat_template';
  wechat?: { status: 'sent' | 'failed' | 'skipped' | 'simulated'; steps: Array<{ type: string; errcode: string }> };
  message: string;
  sentAt: string;
};

type MemberNotification = {
  id: string;
  userId: number;
  senderId: number;
  template: 'winback' | 'appointment';
  title: string;
  message: string;
  imageUrl?: string;
  linkUrl?: string;
  channel: 'in_app';
  readAt: string | null;
  createdAt: string;
};

type MemberActivity = {
  userId: number;
  source: 'member_dashboard';
  lastSeenAt: string;
};

type ReferralEngagementState = {
  schemaVersion: number;
  visits: ReferralVisitEvent[];
  reminders: ReferralReminder[];
  notifications: MemberNotification[];
  memberActivities: MemberActivity[];
};

export type ReferralRange = '7d' | '30d' | '90d' | 'month';
export type ReferralTemplate = 'winback' | 'appointment';

const BATCH_LIMIT = 20;
const COOLDOWN_DAYS = 7;

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function statePath() {
  return path.join(dataDir(), 'cn-referral-engagement.json');
}

// 唤醒素材配置：LOCAL_CN_DATA_DIR/mp-wakeup-assets.json（每日文章例行任务会更新）；文件缺失或字段为空时用默认值
type WakeupAssets = { coverUrl: string; coverMediaId: string; articleId: string; linkUrl: string; linkTitle: string; updatedAt?: string };

const DEFAULT_WAKEUP_ASSETS: WakeupAssets = {
  coverUrl: '/images/mp/wakeup-device-office-cover.jpg',
  coverMediaId: 'pRX7sgthfzDxBsjIAQLY6k08PEodwNVR-TP8v130Zm03gy14RGOitddcvQFfcO6K',
  articleId: '',
  linkUrl: 'https://rich-smart.com.cn/cn/afu',
  linkTitle: '阿富同学 · 门店合作',
};

export function readWakeupAssets(): WakeupAssets {
  const file = path.join(dataDir(), 'mp-wakeup-assets.json');
  let parsed: Record<string, unknown> = {};
  try {
    if (existsSync(file)) parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    parsed = {};
  }
  const pick = (key: keyof WakeupAssets) => {
    const value = typeof parsed[key] === 'string' ? String(parsed[key]).trim() : '';
    return value || String(DEFAULT_WAKEUP_ASSETS[key] || '');
  };
  return {
    coverUrl: pick('coverUrl'),
    coverMediaId: pick('coverMediaId'),
    articleId: typeof parsed.articleId === 'string' ? parsed.articleId.trim() : '',
    linkUrl: pick('linkUrl'),
    linkTitle: pick('linkTitle'),
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
  };
}

// 链接带发送人自己的推荐码；发送人没有推荐码时沿用成员已绑定的推荐归属；只对本站链接追加 ref
function wakeupLink(assets: WakeupAssets, sender: SessionUser, recipient: LocalCnUser) {
  // normalizeCnReferrerCode 对空值会回落到官方码，这里先判空，避免把官方码误当成发送人的码
  const senderLocal = findLocalCnUserById(sender.id);
  const own = senderLocal?.referralSharingEnabled === false ? '' : String(senderLocal?.referralCode || sender.referralCode || '').trim();
  const attributed = String(getFrozenReferrerCode(recipient) || '').trim();
  const code = own ? normalizeCnReferrerCode(own) : attributed ? normalizeCnReferrerCode(attributed) : '';
  try {
    const url = new URL(assets.linkUrl, 'https://rich-smart.com.cn');
    if (code && /(^|\.)rich-smart\.com\.cn$/.test(url.hostname) && !url.searchParams.get('ref')) url.searchParams.set('ref', code);
    return url.toString();
  } catch {
    return assets.linkUrl;
  }
}

function wakeupTemplateConfig() {
  const templateId = process.env.WECHAT_WAKEUP_TEMPLATE_ID || process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_ID || '';
  const keys = String(process.env.WECHAT_WAKEUP_TEMPLATE_KEYS || process.env.WECHAT_KEFU_NOTIFY_TEMPLATE_KEYS || 'thing1,thing2,time3').split(',').map((key) => key.trim());
  return { templateId, keys };
}

function shortText(text: string, max: number) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

type WechatDelivery = NonNullable<ReferralReminder['wechat']> & { channel: ReferralReminder['channel']; reason: string };

// 服务号：客服文字 + 图文（有 articleId）或图片；客服消息失败（如 45015 超过 48 小时未互动）时，配置了模板 ID 才改发模板消息，否则只记录原因
async function deliverWakeupWechat(openid: string, input: { senderName: string; title: string; message: string; linkUrl: string; assets: WakeupAssets }): Promise<WechatDelivery> {
  const steps: Array<{ type: string; errcode: string }> = [];
  if (/^(SIMULATED_|SIMKB_)/.test(openid)) {
    return { status: 'simulated', steps: [{ type: 'kefu_text', errcode: 'simulated' }], channel: 'in_app+wechat_kefu', reason: '模拟测试 openid，未真实发送' };
  }
  const directList = String(process.env.KEFU_NOTIFY_OPENIDS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const testTag = directList.includes(openid) ? '【测试】' : '';
  const text = `${testTag}${input.senderName} 通过富智慧给你发来${input.title}：\n${input.message}\n查看：${input.linkUrl}\n${FOLLOW_QR_HINT}`;
  const textResult = await sendMpCustomText(openid, text);
  steps.push({ type: 'kefu_text', errcode: textResult.ok ? '0' : String(textResult.errcode) });
  if (textResult.ok) {
    const media = input.assets.articleId
      ? { type: 'kefu_article', result: await sendMpCustomArticle(openid, input.assets.articleId) }
      : input.assets.coverMediaId
        ? { type: 'kefu_image', result: await sendMpCustomImage(openid, input.assets.coverMediaId) }
        : null;
    if (media) steps.push({ type: media.type, errcode: media.result.ok ? '0' : String(media.result.errcode) });
    const mediaFailed = media && !media.result.ok;
    return { status: 'sent', steps, channel: 'in_app+wechat_kefu', reason: mediaFailed ? `客服文字已送达，配图失败 errcode=${steps[steps.length - 1].errcode}` : '' };
  }
  const { templateId, keys } = wakeupTemplateConfig();
  if (!templateId) {
    return { status: 'failed', steps, channel: 'in_app', reason: `客服消息失败 errcode=${textResult.errcode}（45015 为超过 48 小时未互动）；未配置模板消息，仅站内通知` };
  }
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const templateResult = await sendMpTemplate(openid, templateId, input.linkUrl, {
    [keys[0] || 'thing1']: shortText(`${testTag}${input.senderName}的${input.title}`, 18),
    [keys[1] || 'thing2']: shortText(input.message, 18),
    [keys[2] || 'time3']: time,
  });
  steps.push({ type: 'template', errcode: templateResult.ok ? '0' : String(templateResult.errcode) });
  if (templateResult.ok) return { status: 'sent', steps, channel: 'in_app+wechat_template', reason: `客服消息失败 errcode=${textResult.errcode}，已改发模板消息` };
  return { status: 'failed', steps, channel: 'in_app', reason: `客服消息失败 errcode=${textResult.errcode}；模板消息失败 errcode=${templateResult.errcode}；仅站内通知` };
}

function channelLabel(channel: ReferralReminder['channel']) {
  if (channel === 'in_app+wechat_kefu') return '站内通知 + 服务号客服消息';
  if (channel === 'in_app+wechat_template') return '站内通知 + 服务号模板消息';
  return '站内通知';
}

function defaultState(): ReferralEngagementState {
  return { schemaVersion: 1, visits: [], reminders: [], notifications: [], memberActivities: [] };
}

function readState(): ReferralEngagementState {
  if (!existsSync(statePath())) return defaultState();
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'));
    return {
      schemaVersion: 1,
      visits: Array.isArray(parsed.visits) ? parsed.visits : [],
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      memberActivities: Array.isArray(parsed.memberActivities) ? parsed.memberActivities : [],
    };
  } catch {
    return defaultState();
  }
}

function writeState(state: ReferralEngagementState) {
  mkdirSync(path.dirname(statePath()), { recursive: true });
  const temporary = `${statePath()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, statePath());
}

function mutate<T>(fn: (state: ReferralEngagementState) => T) {
  const state = readState();
  const result = fn(state);
  writeState(state);
  return result;
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function money(value: number) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parseMoney(value: unknown) {
  return Number(String(value || '0').replace(/[^0-9.-]/g, '')) || 0;
}

function rangeStart(range: ReferralRange, now = new Date()) {
  const start = new Date(now);
  if (range === '7d') start.setDate(start.getDate() - 7);
  else if (range === '90d') start.setDate(start.getDate() - 90);
  else if (range === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else start.setDate(start.getDate() - 30);
  return start;
}

function withinRange(value: string | null | undefined, range: ReferralRange) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) && time >= rangeStart(range).getTime() && time <= Date.now();
}

function canonicalReferralCode(user: SessionUser) {
  const local = findLocalCnUserById(user.id);
  return normalizeCnReferrerCode(local?.referralCode || user.referralCode || '');
}

function directMembers(referralCode: string) {
  return listLocalCnUsers().filter((candidate) => normalizeCnReferrerCode(getFrozenReferrerCode(candidate)) === referralCode);
}

function referralAppointments(referralCode: string, members = directMembers(referralCode)) {
  const store = getWorkspace('store');
  return (Array.isArray(store.appointments) ? store.appointments : []).filter((row: Record<string, unknown>) => {
    const code = normalizeCnReferrerCode(String(row.code || row.source || row.referralCode || row.referrerCode || ''));
    if (code && code !== referralCode) return false;
    const memberId = row.userId ?? row.memberId;
    if (memberId !== undefined && memberId !== null && String(memberId) !== '') return members.some((member) => matchesEngagementMember(row, member));
    return code === referralCode || members.some((member) => matchesEngagementMember(row, member));
  });
}

function appointmentTime(row: Record<string, unknown>) {
  const date = String(row.date || row.appointmentDate || row.time || row.createdAt || '');
  const time = String(row.time || '').match(/^\d{1,2}:\d{2}/) ? String(row.time) : '';
  const combined = time && !date.includes(time) ? `${date} ${time}` : date;
  const parsed = new Date(combined.replace(/\//g, '-')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function appointmentStatusFor(member: { id: number; name: string; phone: string }, appointments: Array<Record<string, unknown>>) {
  const mine = appointments.filter((row) => matchesEngagementMember(row, member));
  const now = Date.now();
  const hasFuture = mine.some((row) => ['已预约', 'pending', 'booked'].includes(String(row.status || '')) && appointmentTime(row) >= now);
  const completed = mine.some((row) => ['检测完成', 'completed', 'done'].includes(String(row.status || '')));
  if (hasFuture) return { key: 'future', label: '已有未来预约', canRemind: false };
  if (completed) return { key: 'completed', label: '预约已完成', canRemind: false };
  if (mine.length) return { key: 'incomplete', label: '预约未完成', canRemind: true };
  return { key: 'none', label: '未预约', canRemind: true };
}

function validReferralOrders(referralCode: string) {
  return commerceSnapshot().orders.filter((order) => (
    normalizeCnReferrerCode(order.referralCode) === referralCode
    && isPaidEngagementOrder(order)
  ));
}

export function confirmedRecentIncome(userId: number, days = 30) {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const state = commerceSnapshot();
  const ordersById = new Map(state.orders.map((order) => [order.id, order]));
  return getWallet(userId).entries
    .filter((entry) => entry.amount > 0 && ['available', 'paid'].includes(entry.status))
    .filter((entry) => {
      const confirmedAt = new Date(entry.availableAt || entry.updatedAt || entry.createdAt).getTime();
      return Number.isFinite(confirmedAt) && confirmedAt >= cutoff && confirmedAt <= now;
    })
    .filter((entry) => {
      const order = ordersById.get(entry.orderId);
      return !order || (order.paymentMode !== 'test' && !['refunded', 'cancelled'].includes(order.status) && order.paymentStatus === 'paid');
    })
    .reduce((sum, entry) => sum + entry.amount, 0);
}

function confirmedRewardsForOrders(userId: number, orderIds: number[]) {
  const orderIdSet = new Set(orderIds);
  const state = commerceSnapshot();
  const ordersById = new Map(state.orders.map((order) => [order.id, order]));
  return getWallet(userId).entries
    .filter((entry) => orderIdSet.has(entry.orderId) && entry.amount > 0 && ['available', 'paid'].includes(entry.status))
    .filter((entry) => {
      const order = ordersById.get(entry.orderId);
      return !order || (order.paymentMode !== 'test' && !['refunded', 'cancelled'].includes(order.status) && order.paymentStatus !== 'refunded');
    })
    .reduce((sum, entry) => sum + entry.amount, 0);
}

function memberActivityLevel(input: {
  lastActivityAt: string | null;
  joinedAt: string;
  orderCount: number;
  appointmentKey: string;
  hasTrackedActivity: boolean;
}) {
  const { lastActivityAt, joinedAt, orderCount, appointmentKey, hasTrackedActivity } = input;
  const last = new Date(lastActivityAt || '').getTime();
  if (!Number.isFinite(last)) return { key: 'sleeping', label: '沉睡', nextAction: '发送回流唤醒' };
  const days = Math.floor((Date.now() - last) / 86400000);
  const joinedDays = Math.floor((Date.now() - new Date(joinedAt).getTime()) / 86400000);
  if (!hasTrackedActivity && orderCount <= 0 && !['future', 'completed'].includes(appointmentKey) && joinedDays <= 7) {
    return { key: 'pending_start', label: '待启动', nextAction: '提醒预约或完成首次行动' };
  }
  if (days <= 7) return { key: 'active', label: '活跃', nextAction: '保持服务跟进' };
  if (days <= 30) return { key: 'cooling', label: '降温', nextAction: '轻提醒回访' };
  return { key: 'sleeping', label: '沉睡', nextAction: '发送回流唤醒' };
}

export function touchMemberActivity(user: SessionUser) {
  if (!Number.isInteger(user.id) || user.id <= 0) return null;
  return mutate((state) => {
    const now = new Date().toISOString();
    const existing = state.memberActivities.find((row) => row.userId === user.id);
    if (existing) {
      existing.lastSeenAt = now;
      existing.source = 'member_dashboard';
      return existing;
    }
    const activity: MemberActivity = { userId: user.id, source: 'member_dashboard', lastSeenAt: now };
    state.memberActivities.push(activity);
    return activity;
  });
}

export function recordReferralVisit(input: {
  referralCode: string;
  sessionId?: string;
  ipHint?: string | null;
  userAgent?: string | null;
  sourcePath?: string | null;
}) {
  const referralCode = normalizeCnReferrerCode(input.referralCode);
  const sessionId = input.sessionId || randomUUID();
  const referralOwnerExists = listLocalCnUsers().some((user) => (
    user.referralSharingEnabled !== false && normalizeCnReferrerCode(user.referralCode) === referralCode
  ));
  if (!referralOwnerExists) return { event: null, sessionId };
  const userAgent = String(input.userAgent || '').slice(0, 300);
  const visitorHash = digest(`${sessionId}:${input.ipHint || ''}:${userAgent.slice(0, 80)}`);
  const sessionHash = digest(sessionId);
  const userAgentHash = digest(userAgent);
  const botFiltered = /bot|spider|crawl|preview|monitor|headless/i.test(userAgent);
  return mutate((state) => {
    const now = new Date();
    const duplicate = state.visits.some((visit) => (
      visit.referralCode === referralCode
      && visit.visitorHash === visitorHash
      && now.getTime() - new Date(visit.createdAt).getTime() < 6 * 60 * 60 * 1000
    ));
    const event: ReferralVisitEvent = {
      id: `RV-${Date.now()}-${state.visits.length + 1}`,
      referralCode,
      visitorHash,
      sessionHash,
      userAgentHash,
      sourcePath: String(input.sourcePath || '/cn').slice(0, 200),
      botFiltered,
      duplicate,
      createdAt: now.toISOString(),
    };
    state.visits.push(event);
    if (state.visits.length > 50_000) state.visits.splice(0, state.visits.length - 50_000);
    return { event, sessionId };
  });
}

export function getReferralEngagement(user: SessionUser, range: ReferralRange = '30d') {
  const referralCode = canonicalReferralCode(user);
  const members = directMembers(referralCode);
  const state = readState();
  const visits = state.visits.filter((visit) => visit.referralCode === referralCode && !visit.botFiltered && !visit.duplicate && withinRange(visit.createdAt, range));
  const uniqueVisitorHashes = new Set(visits.map((visit) => visit.visitorHash));
  const orders = validReferralOrders(referralCode).filter((order) => withinRange(order.paidAt || order.updatedAt || order.createdAt, range));
  const ordersByBuyer = new Set(orders.map((order) => String(order.userId || order.shippingPhone || order.shippingName || order.orderNo)));
  const appointments = referralAppointments(referralCode, members).filter((row: Record<string, unknown>) => withinRange(String(row.createdAt || row.date || row.time || ''), range));
  const appointmentPeople = new Set(appointments.map((row: Record<string, unknown>) => String(row.userId || row.memberId || row.phone || row.name || row.id)));
  const registeredMembers = members.filter((member) => withinRange(member.createdAt, range));
  const denominator = uniqueVisitorHashes.size;
  const rate = (count: number) => denominator > 0 ? `${(count / denominator * 100).toFixed(1)}%` : '0%';
  const allReferralOrders = validReferralOrders(referralCode);
  const allAppointments = referralAppointments(referralCode, members);
  const memberRows = members.map((member) => {
    const memberOrders = allReferralOrders.filter((order) => matchesEngagementMember(order as unknown as Record<string, unknown>, member));
    const lastOrder = memberOrders.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
    const appointment = appointmentStatusFor(member, allAppointments);
    const trackedActivity = state.memberActivities.find((row) => row.userId === member.id) || null;
    const activityDates = [
      trackedActivity?.lastSeenAt,
      member.onboardingCompletedAt,
      member.profileAuthorizedAt,
      member.phoneVerifiedAt,
      member.createdAt,
      lastOrder?.paidAt,
      lastOrder?.updatedAt,
      ...allAppointments
        .filter((row: Record<string, unknown>) => matchesEngagementMember(row, member))
        .map((row: Record<string, unknown>) => String(row.updatedAt || row.createdAt || row.date || '')),
    ].filter(Boolean).map((value) => new Date(String(value)).getTime()).filter(Number.isFinite);
    const lastActivityAt = activityDates.length ? new Date(Math.max(...activityDates)).toISOString() : null;
    const contribution = memberOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const rewards = confirmedRewardsForOrders(user.id, memberOrders.map((order) => order.id));
    const activity = memberActivityLevel({
      lastActivityAt,
      joinedAt: member.createdAt,
      orderCount: memberOrders.length,
      appointmentKey: appointment.key,
      hasTrackedActivity: Boolean(trackedActivity),
    });
    const lastReminder = state.reminders
      .filter((row) => row.senderId === user.id && row.recipientId === member.id && row.status === 'sent')
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0] || null;
    return {
      id: member.id,
      name: member.name,
      memberId: member.id,
      joinedAt: member.createdAt,
      lastActivityAt,
      lastOrderAt: lastOrder?.paidAt || lastOrder?.createdAt || null,
      appointmentStatus: appointment.label,
      canRemindAppointment: appointment.canRemind,
      orders: memberOrders.length,
      contributionAmount: money(contribution),
      rewardAmount: money(rewards),
      activityKey: activity.key,
      activityLabel: activity.label,
      nextAction: activity.nextAction,
      lastReminderAt: lastReminder?.sentAt || null,
      hasWechat: Boolean(member.wechatOfficialOpenId),
      winbackPreview: messageFor('winback', user, member.name),
      appointmentPreview: messageFor('appointment', user, member.name),
    };
  });

  return {
    range,
    rangeLabel: range === '7d' ? '近 7 天' : range === '90d' ? '近 90 天' : range === 'month' ? '本月' : '近 30 天',
    referralCode,
    metrics: {
      visits: visits.length,
      uniqueVisitors: denominator,
      registeredMembers: registeredMembers.length,
      referralOrders: orders.length,
      referralAppointments: appointments.length,
      orderRate: rate(ordersByBuyer.size || orders.length),
      appointmentRate: rate(appointmentPeople.size || appointments.length),
      orderRateBasis: '有效推荐订单人数 / 唯一访客',
      appointmentRateBasis: '推荐预约人数 / 唯一访客',
    },
    details: {
      visits: visits.map((visit) => ({ id: visit.id, createdAt: visit.createdAt, sourcePath: visit.sourcePath })),
      registrations: registeredMembers.map((member) => ({ id: member.id, name: member.name, createdAt: member.createdAt })),
      orders: orders.map((order) => ({ id: order.id, orderNo: order.orderNo, buyer: order.shippingName || `会员 ${order.userId || ''}`, totalAmount: money(Number(order.totalAmount)), status: order.status, paidAt: order.paidAt || order.updatedAt })),
      appointments: appointments.map((row: Record<string, unknown>) => ({ id: row.id, name: row.name || row.customer || '', store: row.store || '', time: row.time || row.date || '', status: row.status || '已预约' })),
    },
    members: memberRows,
    wakeup: (() => {
      const assets = readWakeupAssets();
      return { coverUrl: assets.coverUrl, linkTitle: assets.linkTitle, wechatMedia: assets.articleId ? 'article' : assets.coverMediaId ? 'image' : 'none', templateFallback: Boolean(wakeupTemplateConfig().templateId) };
    })(),
  };
}

function messageFor(template: ReferralTemplate, sender: SessionUser, recipientName: string) {
  const income = confirmedRecentIncome(sender.id, 30);
  const safeName = String(sender.name || '我').replace(/[<>]/g, '').slice(0, 40);
  const safeRecipient = String(recipientName || '朋友').replace(/[<>]/g, '').slice(0, 40);
  if (template === 'appointment') {
    return `Hi ${safeRecipient}，你还没有完成门店预约。我在富智慧帮你留意了入口，回来后可以继续预约体验。`;
  }
  const incomeLine = income > 0 ? `我最近 30 天在平台已确认收益是 ${money(income)}，这是后台实际确认金额。` : '';
  return `Hi ${safeRecipient}，最近有新的健康服务和商品可以看看。${incomeLine}有空回来看看你的会员中心。`;
}

export async function sendReferralReminders(user: SessionUser, input: { template: ReferralTemplate; recipientIds: number[] }) {
  const referralCode = canonicalReferralCode(user);
  const ids = Array.from(new Set(input.recipientIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (!['winback', 'appointment'].includes(input.template)) throw new Error('不支持的提醒模板');
  if (!ids.length) throw new Error('请选择收件人');
  if (ids.length > BATCH_LIMIT) throw new Error(`单次最多发送 ${BATCH_LIMIT} 人`);
  const direct = new Map(directMembers(referralCode).map((member) => [member.id, member]));
  const appointments = referralAppointments(referralCode, Array.from(direct.values()));
  const assets = readWakeupAssets();
  const title = input.template === 'appointment' ? '预约提醒' : '会员回流提醒';
  const queued: Array<{ reminderId: string; openid: string; message: string; linkUrl: string }> = [];
  const written = mutate((state) => {
    const now = new Date();
    const results = ids.map((id) => {
      const recipient = direct.get(id);
      if (!recipient) throw new Error('只能提醒自己直接推荐的成员');
      if (input.template === 'appointment') {
        const appointment = appointmentStatusFor(recipient, appointments);
        if (!appointment.canRemind) throw new Error(`${recipient.name} 已有有效预约或已完成预约`);
      }
      const recent = state.reminders.find((row) => (
        row.senderId === user.id
        && row.recipientId === id
        && row.template === input.template
        && row.status === 'sent'
        && now.getTime() - new Date(row.sentAt).getTime() < COOLDOWN_DAYS * 86400000
      ));
      if (recent) throw new Error(`${recipient.name} 同类提醒仍在 7 天冷却中`);
      const message = messageFor(input.template, user, recipient.name);
      const linkUrl = wakeupLink(assets, user, recipient);
      const reminder: ReferralReminder = {
        id: `RR-${Date.now()}-${state.reminders.length + 1}`,
        senderId: user.id,
        recipientId: id,
        template: input.template,
        status: 'sent',
        reason: '',
        channel: 'in_app',
        message,
        sentAt: now.toISOString(),
      };
      const notification: MemberNotification = {
        id: `MN-${Date.now()}-${state.notifications.length + 1}`,
        userId: id,
        senderId: user.id,
        template: input.template,
        title,
        message,
        imageUrl: assets.coverUrl,
        linkUrl,
        channel: 'in_app',
        readAt: null,
        createdAt: now.toISOString(),
      };
      state.reminders.push(reminder);
      state.notifications.unshift(notification);
      if (recipient.wechatOfficialOpenId) queued.push({ reminderId: reminder.id, openid: recipient.wechatOfficialOpenId, message, linkUrl });
      else reminder.reason = '成员未绑定服务号 openid，仅站内通知';
      return { recipientId: id, name: recipient.name, status: 'sent', channel: '站内通知', reason: reminder.reason, sentAt: reminder.sentAt };
    });
    return { sent: results };
  });
  if (!queued.length) return written;
  const senderName = String(user.name || '你的推荐人').replace(/[<>]/g, '').slice(0, 40);
  const deliveries = new Map<string, WechatDelivery>();
  for (const item of queued) {
    deliveries.set(item.reminderId, await deliverWakeupWechat(item.openid, { senderName, title, message: item.message, linkUrl: item.linkUrl, assets }));
  }
  const byRecipient = new Map<number, WechatDelivery>();
  mutate((state) => {
    for (const reminder of state.reminders) {
      const delivery = deliveries.get(reminder.id);
      if (!delivery) continue;
      reminder.channel = delivery.channel;
      reminder.reason = delivery.reason;
      reminder.wechat = { status: delivery.status, steps: delivery.steps };
      byRecipient.set(reminder.recipientId, delivery);
    }
  });
  return {
    sent: written.sent.map((row) => {
      const delivery = byRecipient.get(row.recipientId);
      return delivery ? { ...row, channel: delivery.status === 'simulated' ? '站内通知 + 服务号（模拟）' : channelLabel(delivery.channel), reason: delivery.reason } : row;
    }),
  };
}

export function listReferralNotifications(user: SessionUser) {
  return readState().notifications.filter((row) => row.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function markReferralNotificationRead(user: SessionUser, id: string) {
  return mutate((state) => {
    const row = state.notifications.find((item) => item.id === id && item.userId === user.id);
    if (!row) return null;
    row.readAt = row.readAt || new Date().toISOString();
    return row;
  });
}

export const referralEngagementTestHooks = {
  readState,
  parseMoney,
  confirmedRecentIncome,
  BATCH_LIMIT,
  COOLDOWN_DAYS,
};

// 分层唤醒排程用：全体已绑定服务号的会员，按最近活跃时间分层（与推荐人页面同一套规则）
export function listMemberTiersForPush(extraLastSeen: (openid: string) => string | null = () => null) {
  const state = readState();
  const orders = commerceSnapshot().orders.filter((order) => isPaidEngagementOrder(order));
  return listLocalCnUsers()
    .filter((member) => member.id > 0 && Boolean(member.wechatOfficialOpenId))
    .map((member) => {
      const tracked = state.memberActivities.find((row) => row.userId === member.id) || null;
      const memberOrders = orders.filter((order) => order.userId === member.id);
      const dates = [
        tracked?.lastSeenAt,
        member.onboardingCompletedAt,
        member.profileAuthorizedAt,
        member.phoneVerifiedAt,
        member.createdAt,
        ...memberOrders.map((order) => order.paidAt || order.updatedAt),
        extraLastSeen(String(member.wechatOfficialOpenId)),
      ].filter(Boolean).map((value) => new Date(String(value)).getTime()).filter(Number.isFinite);
      const lastActivityAt = dates.length ? new Date(Math.max(...dates)).toISOString() : null;
      const level = memberActivityLevel({ lastActivityAt, joinedAt: member.createdAt, orderCount: memberOrders.length, appointmentKey: 'none', hasTrackedActivity: Boolean(tracked) });
      const lastReminder = state.reminders.filter((row) => row.recipientId === member.id && row.status === 'sent').map((row) => row.sentAt).sort().pop() || null;
      return { member, openid: String(member.wechatOfficialOpenId), lastActivityAt, tier: level.key, tierLabel: level.label, lastReminderAt: lastReminder };
    });
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import crypto from 'crypto';
import path from 'path';

// 服务号「糙米量子」AI 客服对话存档（LOCAL_CN JSON 存储，权限 600）

export type KefuRole = 'user' | 'ai' | 'admin' | 'system';
export type KefuDelivery = 'passive' | 'custom' | 'failed' | 'simulated' | 'none';
export type KefuStatus = 'ai' | 'pending' | 'human' | 'closed';

export type KefuMessage = {
  id: string;
  role: KefuRole;
  type: string;
  text: string;
  at: string;
  msgKey?: string;
  delivery?: KefuDelivery;
  errcode?: string;
  tag?: string;
  adminName?: string;
};

export type KefuAttribution = {
  status: 'none' | 'known' | 'asked' | 'pending_review' | 'confirmed' | 'rejected';
  answer?: string;
  note?: string;
  askedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
};

export type KefuConversation = {
  openid: string;
  memberId?: number | null;
  memberName?: string | null;
  source?: string | null;
  subscribed?: boolean;
  createdAt: string;
  lastUserAt?: string;
  lastMessageAt: string;
  status: KefuStatus;
  pausedUntil?: string | null;
  handoffReason?: string | null;
  unread: number;
  tags: string[];
  attribution: KefuAttribution;
  lastNotifiedAt?: string | null;
  aiCalls: string[];
  messages: KefuMessage[];
};

export type KefuNotification = {
  id: string;
  openid: string;
  reason: string;
  at: string;
  results: Array<{ memberId: number; channel: string; status: string; errcode?: string }>;
};

type KefuState = {
  conversations: Record<string, KefuConversation>;
  processed: Record<string, { at: string; passive?: string | null }>;
  notifications: KefuNotification[];
};

const MAX_MESSAGES = 300;
const MAX_PROCESSED = 2000;
const MAX_NOTIFICATIONS = 500;

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

export function kefuFilePath() {
  return path.join(path.resolve(dataDir()), 'cn-wechat-kefu.json');
}

function readState(): KefuState {
  const file = kefuFilePath();
  if (!existsSync(file)) return { conversations: {}, processed: {}, notifications: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return {
      conversations: parsed?.conversations && typeof parsed.conversations === 'object' ? parsed.conversations : {},
      processed: parsed?.processed && typeof parsed.processed === 'object' ? parsed.processed : {},
      notifications: Array.isArray(parsed?.notifications) ? parsed.notifications : [],
    };
  } catch {
    return { conversations: {}, processed: {}, notifications: [] };
  }
}

function writeState(state: KefuState) {
  const file = kefuFilePath();
  mkdirSync(path.dirname(file), { recursive: true });
  const keys = Object.keys(state.processed);
  if (keys.length > MAX_PROCESSED) {
    keys
      .sort((a, b) => Date.parse(state.processed[a].at) - Date.parse(state.processed[b].at))
      .slice(0, keys.length - MAX_PROCESSED)
      .forEach((k) => delete state.processed[k]);
  }
  state.notifications = state.notifications.slice(0, MAX_NOTIFICATIONS);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
}

// 所有修改都是同步的读-改-写，Node 单线程内不会交错
function mutate<T>(work: (state: KefuState) => T): T {
  const state = readState();
  const result = work(state);
  writeState(state);
  return result;
}

function newConversation(openid: string): KefuConversation {
  const now = new Date().toISOString();
  return {
    openid,
    createdAt: now,
    lastMessageAt: now,
    status: 'ai',
    unread: 0,
    tags: [],
    attribution: { status: 'none' },
    aiCalls: [],
    messages: [],
  };
}

export function getKefuConversation(openid: string): KefuConversation | null {
  return readState().conversations[openid] || null;
}

export function listKefuConversations() {
  return Object.values(readState().conversations).sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}

export function listKefuNotifications(openid?: string) {
  const rows = readState().notifications;
  return openid ? rows.filter((n) => n.openid === openid) : rows;
}

export function updateKefuConversation(openid: string, patch: (conv: KefuConversation) => void) {
  return mutate((state) => {
    const conv = state.conversations[openid] || newConversation(openid);
    patch(conv);
    state.conversations[openid] = conv;
    return conv;
  });
}

export function appendKefuMessage(openid: string, message: Omit<KefuMessage, 'id' | 'at'> & { at?: string }, patch?: (conv: KefuConversation) => void) {
  return mutate((state) => {
    const conv = state.conversations[openid] || newConversation(openid);
    const row: KefuMessage = { id: `km-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, at: message.at || new Date().toISOString(), ...message };
    conv.messages.push(row);
    if (conv.messages.length > MAX_MESSAGES) conv.messages = conv.messages.slice(-MAX_MESSAGES);
    conv.lastMessageAt = row.at;
    if (row.role === 'user') {
      conv.lastUserAt = row.at;
      conv.unread += 1;
    }
    if (patch) patch(conv);
    state.conversations[openid] = conv;
    return { conv, message: row };
  });
}

export function setKefuMessageDelivery(openid: string, messageId: string, delivery: KefuDelivery, errcode?: string) {
  mutate((state) => {
    const conv = state.conversations[openid];
    const row = conv?.messages.find((m) => m.id === messageId);
    if (row) {
      row.delivery = delivery;
      if (errcode) row.errcode = errcode;
    }
  });
}

// 去重：返回 null 表示首次；否则返回已记录的条目
export function claimKefuMessageKey(key: string) {
  return mutate((state) => {
    const existing = state.processed[key];
    if (existing) return existing;
    state.processed[key] = { at: new Date().toISOString(), passive: null };
    return null;
  });
}

export function setKefuProcessedPassive(key: string, passive: string | null) {
  mutate((state) => {
    if (state.processed[key]) state.processed[key].passive = passive;
  });
}

export function recordKefuNotification(entry: Omit<KefuNotification, 'id' | 'at'>) {
  return mutate((state) => {
    const row: KefuNotification = { id: `kn-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, at: new Date().toISOString(), ...entry };
    state.notifications.unshift(row);
    const conv = state.conversations[entry.openid];
    if (conv) conv.lastNotifiedAt = row.at;
    return row;
  });
}

// 仅供测试清理：删除指定前缀（SIMULATED_）的对话、去重记录与通知
export function purgeKefuByOpenidPrefix(prefix: string) {
  return mutate((state) => {
    let removed = 0;
    for (const id of Object.keys(state.conversations)) {
      if (id.startsWith(prefix)) {
        delete state.conversations[id];
        removed += 1;
      }
    }
    for (const k of Object.keys(state.processed)) if (k.includes(prefix)) delete state.processed[k];
    state.notifications = state.notifications.filter((n) => !n.openid.startsWith(prefix));
    return removed;
  });
}

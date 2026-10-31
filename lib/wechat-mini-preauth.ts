import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';

const PREAUTH_MAX_AGE_SECONDS = 5 * 60;

export class WechatMiniPreAuthStoreError extends Error {
  constructor() {
    super('验证凭证暂不可用，请稍后重试');
    this.name = 'WechatMiniPreAuthStoreError';
    Object.setPrototypeOf(this, WechatMiniPreAuthStoreError.prototype);
  }
}

export type WechatMiniPreAuthPayload = {
  appId: string;
  openId: string;
  unionId: string | null;
  referralCode: string;
  referralToken?: string;
  displayName: string;
  avatarUrl: string;
  iat: number;
  exp: number;
  nonce: string;
};

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-change-before-production';
}

function storePath() {
  const directory = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(directory, 'wechat-mini-preauth.json');
}

function sign(encoded: string) {
  return createHmac('sha256', authSecret()).update(encoded).digest('base64url');
}

function digest(token: string) {
  return createHmac('sha256', authSecret()).update(token).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readStore(): Record<string, { exp: number; usedAt: string | null }> {
  try {
    if (!existsSync(storePath())) return {};
    const parsed = JSON.parse(readFileSync(storePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid store');
    for (const [key, value] of Object.entries(parsed)) {
      const row = value as { exp: number; usedAt: string | null };
      if (!/^[A-Za-z0-9_-]{43}$/.test(key) || !row || !Number.isFinite(row.exp)
        || !(row.usedAt === null || (typeof row.usedAt === 'string' && Number.isFinite(Date.parse(row.usedAt))))) throw new Error('invalid row');
    }
    return parsed;
  } catch {
    throw new WechatMiniPreAuthStoreError();
  }
}

// Short synchronous write lock only. Never hold this across provider/DB awaits,
// or steal an abandoned lock and risk resurrecting an already consumed token.
function withStoreWriteLock<T>(write: () => T): T {
  const lock = `${storePath()}.lock`;
  try {
    mkdirSync(path.dirname(storePath()), { recursive: true });
    mkdirSync(lock, { mode: 0o700 });
  } catch { throw new WechatMiniPreAuthStoreError(); }
  try { return write(); }
  finally {
    try { rmdirSync(lock); } catch { throw new WechatMiniPreAuthStoreError(); }
  }
}

function writeStore(store: Record<string, { exp: number; usedAt: string | null }>) {
  const target = storePath();
  mkdirSync(path.dirname(target), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const compact = Object.fromEntries(Object.entries(store).filter(([, value]) => value.exp >= now - 60));
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    const file = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(file, JSON.stringify(compact, null, 2), 'utf8'); fsyncSync(file); }
    finally { closeSync(file); }
    renameSync(temporary, target);
    const directory = openSync(path.dirname(target), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch { throw new WechatMiniPreAuthStoreError(); }
  finally {
    if (existsSync(temporary)) {
      try { unlinkSync(temporary); } catch { /* A failed private temporary file never replaces the store. */ }
    }
  }
}

export function createWechatMiniPreAuthToken(input: Omit<WechatMiniPreAuthPayload, 'iat' | 'exp' | 'nonce'>) {
  return withStoreWriteLock(() => {
    const iat = Math.floor(Date.now() / 1000);
    const payload: WechatMiniPreAuthPayload = {
      appId: input.appId,
      openId: input.openId,
      unionId: input.unionId || null,
      referralCode: input.referralCode,
      referralToken: input.referralToken || '',
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      iat,
      exp: iat + PREAUTH_MAX_AGE_SECONDS,
      nonce: randomBytes(16).toString('base64url'),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const token = `${encoded}.${sign(encoded)}`;
    const store = readStore();
    store[digest(token)] = { exp: payload.exp, usedAt: null };
    writeStore(store);
    return token;
  });
}

function parseWechatMiniPreAuthToken(token: string, expectedAppId: string) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature || !safeEqual(sign(encoded), signature)) {
    throw new Error('手机号验证凭证无效，请重新微信登录');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as WechatMiniPreAuthPayload;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error('手机号验证凭证已过期，请重新微信登录');
  if (payload.appId !== expectedAppId) throw new Error('手机号验证凭证来源不一致，请重新微信登录');
  if (!payload.openId) throw new Error('手机号验证凭证缺少微信身份，请重新微信登录');

  const store = readStore();
  const key = digest(token);
  const row = store[key];
  if (!row) throw new Error('手机号验证凭证不存在或已失效，请重新微信登录');
  if (row.exp !== payload.exp) throw new Error('手机号验证凭证无效，请重新微信登录');
  if (row.usedAt) throw new Error('手机号验证凭证已使用，请重新微信登录');
  return { payload, store, key, row };
}

export function readWechatMiniPreAuthToken(token: string, expectedAppId: string) {
  return parseWechatMiniPreAuthToken(token, expectedAppId).payload;
}

export function consumeWechatMiniPreAuthToken(token: string, expectedAppId: string) {
  return withStoreWriteLock(() => {
    const { payload, store, row } = parseWechatMiniPreAuthToken(token, expectedAppId);
    row.usedAt = new Date().toISOString();
    writeStore(store);
    return payload;
  });
}

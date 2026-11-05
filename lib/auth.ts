import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from './db';
import { findLocalCnUserById } from './local-cn-users';

const SESSION_COOKIE = 'richsmart_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const ADMIN_ROLES = new Set(['admin', 'staff']);

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  agentLevel: number;
  role: string;
  region: string;
  referralCode?: string;
  platformAdmin?: boolean;
  referralSharingEnabled?: boolean;
  demoAccount?: boolean;
  emailCredentialVersion?: number;
  // 仅由 /api/auth/wechat/kefu-admin（服务号 snsapi_base 授权）写入；每次请求重新核对 KEFU_NOTIFY_OPENIDS 白名单
  kefuAdminOpenid?: string;
}

export function kefuAdminOpenids() {
  return String(process.env.KEFU_NOTIFY_OPENIDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** 服务号 openid 是否在 KEFU_NOTIFY_OPENIDS：可走微信验证进 /cn/ops，不改会员 platformAdmin 字段 */
export function isKefuAdminEligible(openid: string | null | undefined) {
  const id = String(openid || '').trim();
  return Boolean(id && kefuAdminOpenids().includes(id));
}

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-change-before-production';
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function sign(value: string) {
  return createHmac('sha256', authSecret()).update(value).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(password, salt, 64).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;

  if (!stored.startsWith('scrypt$')) {
    return safeEqual(password, stored);
  }

  const [, salt, expected] = stored.split('$');
  if (!salt || !expected) return false;

  const actual = scryptSync(password, salt, 64).toString('base64url');
  return safeEqual(actual, expected);
}

export function createSessionToken(user: SessionUser) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = base64Url(JSON.stringify({ ...user, exp: expiresAt }));
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token: string | undefined): SessionUser | null {
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      id: Number(parsed.id),
      name: String(parsed.name || ''),
      email: String(parsed.email || ''),
      agentLevel: Number(parsed.agentLevel || 0),
      role: String(parsed.role || 'member'),
      region: String(parsed.region || 'TW'),
      referralCode: parsed.referralCode ? String(parsed.referralCode) : undefined,
      platformAdmin: parsed.platformAdmin === true,
      referralSharingEnabled: parsed.referralSharingEnabled !== false,
      demoAccount: parsed.demoAccount === true,
      emailCredentialVersion: Number.isSafeInteger(parsed.emailCredentialVersion) ? parsed.emailCredentialVersion : undefined,
      kefuAdminOpenid: parsed.kefuAdminOpenid ? String(parsed.kefuAdminOpenid) : undefined,
    };
  } catch {
    return null;
  }
}

export function getRequestSession(request: NextRequest) {
  const authorization = request.headers.get('authorization') || '';
  const bearerToken = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : undefined;
  return readSessionToken(bearerToken || request.cookies.get(SESSION_COOKIE)?.value);
}

function isChinaTestSession(user: SessionUser | null) {
  return Boolean(user && user.id < 0 && user.region === 'CN_TEST');
}

export function isAdminRole(role: string | null | undefined) {
  return ADMIN_ROLES.has(String(role || '').toLowerCase());
}

export function hasPlatformAdminAccess(user: SessionUser | null | undefined) {
  return Boolean(user?.platformAdmin || isAdminRole(user?.role));
}

export function setSessionCookie(response: NextResponse, user: SessionUser) {
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_API_URL || '';
  response.cookies.set(SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: publicUrl.startsWith('https://'),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  const publicUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_API_URL || '';
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: publicUrl.startsWith('https://'),
    path: '/',
    maxAge: 0,
  });
}

export function toSessionUser(user: typeof users.$inferSelect): SessionUser {
  return {
    id: user.id,
    name: user.name || '',
    email: user.email || '',
    agentLevel: Number(user.agentLevel || 0),
    role: user.role || 'member',
    region: 'TW',
    referralCode: user.referralCode || `RS${user.id}`,
  };
}

export async function getFreshSessionUser(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session?.id) return null;
  if (isChinaTestSession(session)) return session;

  if (!process.env.DATABASE_URL && session.region === 'CN') {
    const localUser = findLocalCnUserById(session.id);
    if (!localUser) return null;
    if (localUser.emailRegistrationId && session.emailCredentialVersion !== (localUser.emailCredentialVersion || 1)) return null;
    const kefuAdmin = Boolean(
      session.kefuAdminOpenid
      && kefuAdminOpenids().includes(session.kefuAdminOpenid)
      && localUser.wechatOfficialOpenId === session.kefuAdminOpenid,
    );
    return {
      id: localUser.id,
      name: localUser.name,
      email: localUser.email,
      agentLevel: localUser.agentLevel,
      role: localUser.role,
      region: 'CN',
      referralCode: localUser.referralSharingEnabled === false ? undefined : localUser.referralCode,
      platformAdmin: localUser.platformAdmin === true || kefuAdmin,
      referralSharingEnabled: localUser.referralSharingEnabled !== false,
      demoAccount: localUser.email.startsWith('brand-demo-'),
      emailCredentialVersion: localUser.emailRegistrationId ? (localUser.emailCredentialVersion || 1) : undefined,
      kefuAdminOpenid: kefuAdmin ? session.kefuAdminOpenid : undefined,
    };
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1);

  const user = rows[0];
  if (!user || (user.status && user.status !== 'active')) return null;
  const fresh = toSessionUser(user);
  return {
    ...fresh,
    region: session.region === 'CN' ? 'CN' : fresh.region,
    platformAdmin: session.platformAdmin === true || hasPlatformAdminAccess(fresh),
    referralSharingEnabled: session.referralSharingEnabled !== false,
    demoAccount: session.demoAccount === true,
  };
}

export async function requireAdmin(request: NextRequest) {
  const user = await getFreshSessionUser(request);

  if (!hasPlatformAdminAccess(user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export async function requireUser(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!user) {
    return { user: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { user, response: null };
}

import { db } from '@/lib/db';
import { userIdentities, users } from '@/lib/schema';
import {
  createSessionToken,
  getFreshSessionUser,
  setSessionCookie,
  toSessionUser,
  type SessionUser,
} from '@/lib/auth';
import { and, eq } from 'drizzle-orm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  bindReferrerIfMissing,
  createReferralCode,
  resolveReferrerId,
  sanitizeReferralCode,
} from '@/lib/referrals';

export const OAUTH_STATE_COOKIE = 'richsmart_oauth_state';
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

export type OAuthProvider = 'line' | 'wechat' | 'wechat_official' | 'wechat_open' | 'wechat_mini_program';

interface OAuthStatePayload {
  provider: OAuthProvider;
  returnTo: string;
  referralCode?: string;
  bindMemberId?: number;
  nonce: string;
  exp: number;
}

interface ExternalProfile {
  provider: OAuthProvider;
  providerUserId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  metadata?: Record<string, unknown>;
}

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-change-before-production';
}

function sign(value: string) {
  return createHmac('sha256', authSecret()).update(value).digest('base64url');
}

function base64Url(input: string) {
  return Buffer.from(input).toString('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function stateStorePath() {
  const directory = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(directory, 'oauth-state-replay.json');
}

function stateDigest(state: string) {
  return createHmac('sha256', authSecret()).update(state).digest('base64url');
}

function readStateStore(): Record<string, { exp: number; usedAt: string | null }> {
  try {
    if (!existsSync(stateStorePath())) return {};
    const parsed = JSON.parse(readFileSync(stateStorePath(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStateStore(store: Record<string, { exp: number; usedAt: string | null }>) {
  const target = stateStorePath();
  mkdirSync(path.dirname(target), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const compact = Object.fromEntries(Object.entries(store).filter(([, value]) => value.exp >= now - 60));
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(compact, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
}

function rememberOAuthState(state: string, exp: number) {
  const store = readStateStore();
  store[stateDigest(state)] = { exp, usedAt: null };
  writeStateStore(store);
}

function consumeOAuthState(state: string) {
  const store = readStateStore();
  const digest = stateDigest(state);
  const row = store[digest];
  if (!row) throw new Error('OAuth state 不存在或已失效，请重新授权');
  if (row.usedAt) throw new Error('OAuth state 已使用，请重新授权');
  if (row.exp < Math.floor(Date.now() / 1000)) throw new Error('OAuth state 已过期，请重新授权');
  row.usedAt = new Date().toISOString();
  writeStateStore(store);
}

function sanitizeReturnTo(value: string | null) {
  if (!value) return '/portal/profile';
  if (!value.startsWith('/') || value.startsWith('//')) return '/portal/profile';
  return value;
}

export function appOrigin(request: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
}

export function createOAuthState(provider: OAuthProvider, returnTo: string, referralCode?: string | null, bindMemberId?: number | null) {
  const exp = Math.floor(Date.now() / 1000) + OAUTH_STATE_MAX_AGE_SECONDS;
  const payload: OAuthStatePayload = {
    provider,
    returnTo: sanitizeReturnTo(returnTo),
    referralCode: sanitizeReferralCode(referralCode) || undefined,
    bindMemberId: bindMemberId || undefined,
    nonce: randomBytes(16).toString('base64url'),
    exp,
  };
  const encoded = base64Url(JSON.stringify(payload));
  const state = `${encoded}.${sign(encoded)}`;
  rememberOAuthState(state, exp);
  return state;
}

export function verifyOAuthState(request: NextRequest, provider: OAuthProvider, state: string | null) {
  const cookieValue = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !cookieValue || !safeEqual(state, cookieValue)) {
    throw new Error('OAuth state 验证失败，请重新授权');
  }

  const [encoded, signature] = state.split('.');
  if (!encoded || !signature || !safeEqual(sign(encoded), signature)) {
    throw new Error('OAuth state 簽章不正确');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthStatePayload;
  if (payload.provider !== provider || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('OAuth state 已过期，请重新授权');
  }

  consumeOAuthState(state);
  return payload;
}

export function setOAuthStateCookie(response: NextResponse, state: string) {
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://'),
    path: '/',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export function clearOAuthStateCookie(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://'),
    path: '/',
    maxAge: 0,
  });
}

export async function linkOrCreateUserFromExternalProfile(
  request: NextRequest,
  profile: ExternalProfile,
  inboundReferralCode?: string | null
): Promise<SessionUser> {
  const currentUser = await getFreshSessionUser(request);
  const sameIdentity = await db
    .select()
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, profile.provider),
        eq(userIdentities.providerUserId, profile.providerUserId)
      )
    )
    .limit(1);

  if (currentUser) {
    if (sameIdentity[0] && sameIdentity[0].userId !== currentUser.id) {
      throw new Error('此外部身份已绑定其他会员');
    }

    const existingForUser = await db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.userId, currentUser.id),
          eq(userIdentities.provider, profile.provider)
        )
      )
      .limit(1);

    const now = new Date();
    const payload = {
      userId: currentUser.id,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      displayName: profile.displayName || null,
      avatarUrl: profile.avatarUrl || null,
      metadata: profile.metadata || {},
      updatedAt: now,
    };

    if (existingForUser[0]) {
      await db.update(userIdentities).set(payload).where(eq(userIdentities.id, existingForUser[0].id));
    } else {
      await db.insert(userIdentities).values({ ...payload, createdAt: now });
    }

    await bindReferrerIfMissing(currentUser.id, inboundReferralCode);
    return currentUser;
  }

  if (sameIdentity[0]) {
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.id, sameIdentity[0].userId))
      .limit(1);

    if (!existingUser[0]) throw new Error('外部身份已存在，但会员资料不存在');
    await bindReferrerIfMissing(existingUser[0].id, inboundReferralCode);
    return toSessionUser(existingUser[0]);
  }

  const displayName = profile.displayName || `${profile.provider} 会员`;
  const now = new Date();
  const referrerId = await resolveReferrerId(inboundReferralCode);
  if (!referrerId) throw new Error('请从邀请链接进入完成会员注册');
  const insertedUser = await db
    .insert(users)
    .values({
      name: displayName,
      role: 'member',
      agentLevel: 0,
      agentStatus: 'member',
      status: 'active',
      referralCode: createReferralCode(profile.provider),
      referrerId,
      referredByMemberId: referrerId,
      referralBoundAt: now,
      referralSource: String(profile.provider),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(userIdentities).values({
    userId: insertedUser[0].id,
    provider: profile.provider,
    providerUserId: profile.providerUserId,
    displayName,
    avatarUrl: profile.avatarUrl || null,
    metadata: profile.metadata || {},
    createdAt: now,
    updatedAt: now,
  });

  return toSessionUser(insertedUser[0]);
}

export function redirectWithSession(url: string, user: SessionUser) {
  const response = NextResponse.redirect(url);
  setSessionCookie(response, user);
  clearOAuthStateCookie(response);
  return response;
}

export function jsonWithSession(body: Record<string, unknown>, user: SessionUser, status = 200) {
  const response = NextResponse.json(body, { status });
  response.cookies.set('richsmart_session', createSessionToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://'),
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

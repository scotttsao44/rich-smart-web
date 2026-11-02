import { createHmac, randomBytes, timingSafeEqual, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import type { NextRequest, NextResponse } from 'next/server';
import { findLocalCnUserById, findLocalCnUserByReferralCode, referralOwnerForAttribution } from '@/lib/local-cn-users';

export const REFERRAL_ATTRIBUTION_COOKIE = 'rs_ref_attr';
export const REFERRAL_SESSION_COOKIE = 'rs_ref_session';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

type ReferralLinkStatus = 'active' | 'revoked';

export type LocalCnReferralLink = {
  id: string;
  memberId: number;
  status: ReferralLinkStatus;
  createdAt: string;
  revokedAt?: string | null;
  revokedBy?: number | null;
  revokeReason?: string | null;
};

export type LocalCnReferralVisit = {
  id: string;
  linkId: string;
  referrerMemberId: number;
  sessionHash: string;
  sourcePath: string;
  attributionId: string;
  retainedExistingAttribution: boolean;
  userAgentHash: string;
  createdAt: string;
};

export type LocalCnReferralBindingAudit = {
  id: string;
  memberId: number;
  referredByMemberId: number;
  linkId: string;
  visitId: string;
  attributionId: string;
  source: string;
  result: 'bound' | 'ignored_existing' | 'rejected';
  reason: string;
  createdAt: string;
};

type ReferralAttributionState = {
  schemaVersion: 1;
  links: LocalCnReferralLink[];
  visits: LocalCnReferralVisit[];
  bindings: LocalCnReferralBindingAudit[];
};

export type PendingReferralAttribution = {
  attributionId: string;
  linkId: string;
  visitId: string;
  referrerMemberId: number;
  sourcePath: string;
  createdAt: string;
};

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function statePath() {
  return path.join(dataDir(), 'cn-referral-attribution.json');
}

function lockPath() {
  return path.join(dataDir(), '.cn-referral-attribution.lock');
}

function secret() {
  return process.env.REFERRAL_TOKEN_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-change-before-production';
}

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function digest(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function emptyState(): ReferralAttributionState {
  return { schemaVersion: 1, links: [], visits: [], bindings: [] };
}

function readState(): ReferralAttributionState {
  if (!existsSync(statePath())) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'));
    return {
      schemaVersion: 1,
      links: Array.isArray(parsed.links) ? parsed.links : [],
      visits: Array.isArray(parsed.visits) ? parsed.visits : [],
      bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: ReferralAttributionState) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${statePath()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, statePath());
}

function acquireLock() {
  mkdirSync(dataDir(), { recursive: true });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      mkdirSync(lockPath());
      return;
    } catch {
      try {
        if (Date.now() - statSync(lockPath()).mtimeMs > 30_000) rmSync(lockPath(), { recursive: true, force: true });
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  throw new Error('推荐归属资料正忙，请稍后重试');
}

function releaseLock() {
  rmSync(lockPath(), { recursive: true, force: true });
}

function mutate<T>(fn: (state: ReferralAttributionState) => T) {
  acquireLock();
  try {
    const state = readState();
    const result = fn(state);
    writeState(state);
    return result;
  } finally {
    releaseLock();
  }
}

function tokenForLinkId(linkId: string) {
  return `${linkId}.${sign(`referral-link:${linkId}`)}`;
}

function verifyTokenSignature(token: string) {
  const [linkId, signature] = String(token || '').trim().split('.');
  if (!linkId || !signature || !/^[A-Za-z0-9_-]{24,80}$/.test(linkId)) return null;
  return safeEqual(signature, sign(`referral-link:${linkId}`)) ? linkId : null;
}

function encodeCookie(payload: PendingReferralAttribution) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(`referral-attribution:${encoded}`)}`;
}

function decodeCookie(value?: string | null): PendingReferralAttribution | null {
  const [encoded, signature] = String(value || '').split('.');
  if (!encoded || !signature || !safeEqual(signature, sign(`referral-attribution:${encoded}`))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return {
      attributionId: String(parsed.attributionId || ''),
      linkId: String(parsed.linkId || ''),
      visitId: String(parsed.visitId || ''),
      referrerMemberId: Number(parsed.referrerMemberId || 0),
      sourcePath: String(parsed.sourcePath || ''),
      createdAt: String(parsed.createdAt || ''),
    };
  } catch {
    return null;
  }
}

function activeLink(state: ReferralAttributionState, linkId: string) {
  const link = state.links.find((row) => row.id === linkId && row.status === 'active') || null;
  if (!link) return null;
  const owner = referralOwnerForAttribution(link.memberId);
  if (!owner) return null;
  return { link, owner };
}

export function ensureLocalCnReferralLink(memberId: number) {
  const owner = referralOwnerForAttribution(memberId);
  if (!owner) return null;
  return mutate((state) => {
    const existing = state.links.find((link) => link.memberId === memberId && link.status === 'active');
    const link = existing || {
      id: randomBytes(24).toString('base64url'),
      memberId,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
    };
    if (!existing) state.links.push(link);
    return { link, token: tokenForLinkId(link.id), path: `/api/cn/referral-link/landing?t=${encodeURIComponent(tokenForLinkId(link.id))}` };
  });
}

export function verifyLocalCnReferralToken(token: string) {
  const linkId = verifyTokenSignature(token);
  if (!linkId) return { ok: false as const, reason: 'invalid_token' };
  const state = readState();
  const resolved = activeLink(state, linkId);
  if (!resolved) return { ok: false as const, reason: 'revoked_or_ineligible' };
  return { ok: true as const, link: resolved.link, owner: resolved.owner };
}

export function referralCodeFromLocalCnReferralToken(token: string) {
  const verified = verifyLocalCnReferralToken(token);
  if (!verified.ok) return null;
  return verified.owner.referralCode;
}

export function resolveReferralAttributionFromCode(rawCode?: string | null, sourcePath = '/cn/login'): PendingReferralAttribution | null {
  const cleaned = String(rawCode || '').trim();
  let owner = cleaned ? findLocalCnUserByReferralCode(cleaned) : null;
  if (owner && !referralOwnerForAttribution(owner.id)) owner = null;
  // 没有有效推荐码：不默认归 Scoot/官方直属，回传 null → 新会员为「归属待确认」，由 AI 客服询问来源并交后台核对
  if (!owner) return null;
  const ensured = ensureLocalCnReferralLink(owner.id);
  if (!ensured) return null;
  const landed = recordLocalCnReferralLanding({
    token: ensured.token,
    sourcePath,
  });
  return landed.ok ? landed.pending : null;
}

function extractRefFromRefererHeader(request: NextRequest): string | null {
  const referer = request.headers.get('referer') || request.headers.get('referrer') || '';
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const ref = (
      url.searchParams.get('ref') ||
      url.searchParams.get('r') ||
      url.searchParams.get('referrerCode') ||
      url.searchParams.get('referrer') ||
      ''
    ).trim();
    return ref || null;
  } catch {
    return null;
  }
}

export function readPendingReferralAttribution(request: NextRequest, fallbackRefCode?: string | null): PendingReferralAttribution | null {
  const queryRef = (
    request.nextUrl?.searchParams?.get('ref') ||
    request.nextUrl?.searchParams?.get('r') ||
    request.nextUrl?.searchParams?.get('referrerCode') ||
    request.nextUrl?.searchParams?.get('referrer') ||
    request.headers.get('x-referral-code') ||
    fallbackRefCode ||
    extractRefFromRefererHeader(request) ||
    ''
  ).trim();
  if (queryRef) {
    const explicitOwner = findLocalCnUserByReferralCode(queryRef);
    if (explicitOwner) {
      const resolvedFromRef = resolveReferralAttributionFromCode(explicitOwner.referralCode, request.nextUrl?.pathname || '/cn/login');
      if (resolvedFromRef) return resolvedFromRef;
    }
  }
  const pending = decodeCookie(request.cookies.get(REFERRAL_ATTRIBUTION_COOKIE)?.value);
  if (pending?.linkId && pending.referrerMemberId) {
    const state = readState();
    const resolved = activeLink(state, pending.linkId);
    if (resolved && resolved.owner.id === pending.referrerMemberId) {
      return pending;
    }
  }
  return resolveReferralAttributionFromCode(queryRef || null, request.nextUrl?.pathname || '/cn/login');
}

export function setPendingReferralAttributionCookie(response: NextResponse, pending: PendingReferralAttribution, secure: boolean) {
  response.cookies.set(REFERRAL_ATTRIBUTION_COOKIE, encodeCookie(pending), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearPendingReferralAttributionCookie(response: NextResponse, secure: boolean) {
  response.cookies.set(REFERRAL_ATTRIBUTION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  });
}

export function recordLocalCnReferralLanding(input: {
  token: string;
  existingPending?: PendingReferralAttribution | null;
  sessionId?: string | null;
  sourcePath?: string | null;
  userAgent?: string | null;
}) {
  const linkId = verifyTokenSignature(input.token);
  if (!linkId) return { ok: false as const, reason: 'invalid_token' };
  return mutate((state) => {
    const resolved = activeLink(state, linkId);
    if (!resolved) return { ok: false as const, reason: 'revoked_or_ineligible' };
    const now = new Date().toISOString();
    const sessionId = input.sessionId || randomUUID();
    const retained = false;
    const visit: LocalCnReferralVisit = {
      id: `RAV-${Date.now()}-${state.visits.length + 1}`,
      linkId,
      referrerMemberId: resolved.owner.id,
      sessionHash: digest(sessionId),
      sourcePath: String(input.sourcePath || ''),
      attributionId: `RA-${Date.now()}-${randomBytes(5).toString('base64url')}`,
      retainedExistingAttribution: retained,
      userAgentHash: digest(String(input.userAgent || '').slice(0, 300)),
      createdAt: now,
    };
    state.visits.unshift(visit);
    state.visits = state.visits.slice(0, 5000);
    const pending: PendingReferralAttribution = {
      attributionId: visit.attributionId,
      linkId,
      visitId: visit.id,
      referrerMemberId: resolved.owner.id,
      sourcePath: visit.sourcePath,
      createdAt: now,
    };
    return { ok: true as const, visit, pending, retainedExistingAttribution: retained, sessionId };
  });
}

export function appendLocalCnReferralBindingAudit(input: Omit<LocalCnReferralBindingAudit, 'id' | 'createdAt'>) {
  return mutate((state) => {
    const row: LocalCnReferralBindingAudit = {
      ...input,
      id: `RBA-${Date.now()}-${state.bindings.length + 1}`,
      createdAt: new Date().toISOString(),
    };
    state.bindings.unshift(row);
    state.bindings = state.bindings.slice(0, 5000);
    return row;
  });
}

export function getLocalCnReferralAttributionState() {
  return readState();
}

export function referralDisplayName(memberId?: number | null) {
  if (!memberId) return '';
  const user = findLocalCnUserById(memberId);
  if (!user) return '';
  return user.name || `会员 ${memberId}`;
}

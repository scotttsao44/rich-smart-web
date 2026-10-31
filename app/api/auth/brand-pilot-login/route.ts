import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, getFreshSessionUser, type SessionUser } from '@/lib/auth';
import { jsonWithSession } from '@/lib/oauth';
import {
  consumeBrandDemoLoginChallenge,
  createBrandDemoInvite,
  createBrandDemoLoginChallenge,
  createBrandPilotAccessLink,
  getLocalBrandPilotIdentity,
  inspectBrandDemoInvite,
  listBrandPilotAccessRows,
  listBrandPilotPermanentAccessLinks,
  redeemBrandPilotInvite,
  revokeBrandDemoInvite,
  revokeBrandPilotAccessLink,
  updateLocalBrandPilotNickname,
} from '@/lib/local-cn-brand-demo-access';
import type { LocalCnUser } from '@/lib/local-cn-users';
import { getApprovedBrandForUser } from '@/lib/local-cn-brand-marketplace';
import {
  brandPilotDbEnabled,
  consumeDbBrandDemoLoginChallenge,
  createDbBrandDemoInvite,
  createDbBrandDemoLoginChallenge,
  createDbBrandPilotAccessLink,
  getDbBrandPilotIdentity,
  inspectDbBrandDemoInvite,
  listDbBrandPilotAccessRows,
  listDbBrandPilotPermanentAccessLinks,
  redeemDbBrandDemoInvite,
  revokeDbBrandDemoInvite,
  revokeDbBrandPilotAccessLink,
  toDbDemoSessionUser,
  updateDbBrandPilotNickname,
} from '@/lib/brand-pilot-db';
import { findLocalCnUserById } from '@/lib/local-cn-users';

export const dynamic = 'force-dynamic';

function enabled() {
  return process.env.CN_ENABLE_BRAND_PILOT_LOGIN === 'true' || process.env.CN_ENABLE_BRAND_DEMO === 'true' || process.env.NODE_ENV !== 'production';
}

function toSessionUser(user: LocalCnUser): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    agentLevel: user.agentLevel,
    role: user.role,
    region: 'CN',
    referralCode: user.referralCode,
    platformAdmin: user.platformAdmin === true,
    referralSharingEnabled: user.referralSharingEnabled !== false,
  };
}

function appOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) return `${forwardedProto || 'https'}://${forwardedHost}`;
  return request.nextUrl.origin;
}

function oneClickLoginUrl(request: NextRequest, params: Record<string, string>) {
  return `${appOrigin(request)}/cn/login?switch=1#${new URLSearchParams(params).toString()}`;
}

export async function GET(request: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: '品牌受邀测试登入暂未开放' }, { status: 404 });
  const token = String(request.nextUrl.searchParams.get('invite') || request.nextUrl.searchParams.get('token') || '').trim();
  if (!token) return NextResponse.json({ error: '请提供邀请 token' }, { status: 400 });
  const invite = brandPilotDbEnabled() ? await inspectDbBrandDemoInvite(token) : null;
  if (invite) return NextResponse.json({ invite });
  const local = brandPilotDbEnabled() ? null : inspectBrandDemoInvite(token);
  return local ? NextResponse.json({ invite: local }) : NextResponse.json({ error: '邀请不存在或已失效' }, { status: 404 });
}

export async function POST(request: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: '品牌受邀测试登入暂未开放' }, { status: 404 });
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'login');
    const current = await getFreshSessionUser(request).catch(() => null);
    if (action === 'create_invite') {
      const persistentAccess = body.persistentAccess === true;
      const referralCode = current?.referralSharingEnabled === false ? undefined : body.referralCode;
      const result = brandPilotDbEnabled()
        ? await createDbBrandDemoInvite(current, { expiresInMinutes: body.expiresInMinutes, expiresInSeconds: body.expiresInSeconds, maxUses: 1, referralCode, persistentAccess })
        : createBrandDemoInvite(current, { expiresInMinutes: body.expiresInMinutes, expiresInSeconds: body.expiresInSeconds, maxUses: 1, referralCode, persistentAccess });
      return NextResponse.json({
        ...result,
        oneClickUrl: oneClickLoginUrl(request, { pilotMode: 'invite', token: result.token, code: result.code }),
      }, { status: 201 });
    }
    if (action === 'list_access') {
      const [rows, accessLinks] = brandPilotDbEnabled()
        ? await Promise.all([listDbBrandPilotAccessRows(current), listDbBrandPilotPermanentAccessLinks(current)])
        : [listBrandPilotAccessRows(current), listBrandPilotPermanentAccessLinks(current)];
      return NextResponse.json({ invites: rows, accessLinks });
    }
    if (action === 'update_nickname') {
      const updated = brandPilotDbEnabled()
        ? await updateDbBrandPilotNickname(current, String(body.nickname || body.displayName || ''))
        : updateLocalBrandPilotNickname(current, String(body.nickname || body.displayName || ''));
      const row = updated.user;
      const user = brandPilotDbEnabled() ? toDbDemoSessionUser(row as never) : toSessionUser(row as LocalCnUser);
      return jsonWithSession({ user, token: createSessionToken(user), pilotIdentity: updated.identity, message: '昵称已更新。' }, user);
    }
    if (action === 'revoke_invite') {
      const invite = brandPilotDbEnabled()
        ? await revokeDbBrandDemoInvite(current, String(body.token || ''))
        : revokeBrandDemoInvite(current, String(body.token || ''));
      return NextResponse.json({ invite });
    }
    if (action === 'create_challenge') {
      const memberId = Number(body.memberId || 0);
      const brandId = Number(body.brandId || 0);
      if (!memberId) return NextResponse.json({ error: '请提供会员 ID' }, { status: 400 });
      if (!brandPilotDbEnabled() && !findLocalCnUserById(memberId)) return NextResponse.json({ error: '找不到会员' }, { status: 404 });
      if (!brandPilotDbEnabled() && brandId > 0 && getApprovedBrandForUser(memberId)?.id !== brandId) return NextResponse.json({ error: '会员不属于该品牌，不能建立品牌登入码' }, { status: 403 });
      const result = brandPilotDbEnabled()
        ? await createDbBrandDemoLoginChallenge(current, { memberId, brandId, expiresInMinutes: body.expiresInMinutes, expiresInSeconds: body.expiresInSeconds })
        : createBrandDemoLoginChallenge(current, { memberId, brandId, expiresInMinutes: body.expiresInMinutes, expiresInSeconds: body.expiresInSeconds });
      return NextResponse.json({
        challenge: result.challenge,
        code: result.code,
        oneClickUrl: oneClickLoginUrl(request, { pilotMode: 'relogin', challengeId: result.challenge.id, code: result.code }),
        message: '品牌测试账号入口已建立。',
      }, { status: 201 });
    }
    if (action === 'create_access_link') {
      const memberId = Number(body.memberId || 0);
      const brandId = Number(body.brandId || 0);
      if (!memberId) return NextResponse.json({ error: '请提供会员 ID' }, { status: 400 });
      if (!brandPilotDbEnabled() && !findLocalCnUserById(memberId)) return NextResponse.json({ error: '找不到会员' }, { status: 404 });
      if (!brandPilotDbEnabled() && brandId > 0 && getApprovedBrandForUser(memberId)?.id !== brandId) return NextResponse.json({ error: '会员不属于该品牌，不能建立专属测试链接' }, { status: 403 });
      const result = brandPilotDbEnabled()
        ? await createDbBrandPilotAccessLink(current, { memberId, brandId })
        : createBrandPilotAccessLink(current, { memberId, brandId });
      return NextResponse.json({
        access: result.access,
        oneClickUrl: oneClickLoginUrl(request, { pilotMode: 'access', challengeId: result.access.id, code: result.code }),
        message: '长期专属品牌测试链接已建立。',
      }, { status: 201 });
    }
    if (action === 'revoke_access_link') {
      const accessId = String(body.accessId || '');
      if (!accessId) return NextResponse.json({ error: '请提供专属链接编号' }, { status: 400 });
      const access = brandPilotDbEnabled()
        ? await revokeDbBrandPilotAccessLink(current, accessId)
        : revokeBrandPilotAccessLink(current, accessId);
      return NextResponse.json({ access, message: '专属测试链接已撤销。' });
    }
    if (action === 'login_challenge' || action === 'login_access') {
      const challengePayload = {
        challengeId: String(body.challengeId || ''),
        code: String(body.code || ''),
        nickname: String(body.nickname || body.displayName || ''),
      };
      const result = brandPilotDbEnabled()
        ? await consumeDbBrandDemoLoginChallenge(challengePayload)
        : consumeBrandDemoLoginChallenge(challengePayload);
      const resolved = result as { user?: unknown; memberId: number; brandId?: number };
      const row = resolved.user || findLocalCnUserById(Number(resolved.memberId || 0));
      if (!row) throw new Error('找不到会员');
      const user = brandPilotDbEnabled() ? toDbDemoSessionUser(row as never) : toSessionUser(row as LocalCnUser);
      return jsonWithSession({
        user,
        token: createSessionToken(user),
        brandId: Number(resolved.brandId || 0),
        pilotIdentity: brandPilotDbEnabled() ? await getDbBrandPilotIdentity(user.id) : getLocalBrandPilotIdentity(user.id),
        next: body.next || '/cn/member',
        message: action === 'login_access' ? '已通过专属链接登入同一品牌测试会员。' : '已进入同一品牌测试会员。',
      }, user);
    }
    const payload = {
      token: String(body.token || ''),
      code: String(body.code || ''),
      idempotencyKey: String(body.idempotencyKey || request.headers.get('x-idempotency-key') || ''),
      memberName: String(body.nickname || body.displayName || body.memberName || ''),
      displayName: String(body.nickname || body.displayName || body.memberName || ''),
      nickname: String(body.nickname || body.displayName || body.memberName || ''),
      contact: String(body.contact || ''),
      phone: String(body.phone || ''),
      referrerCode: String(body.referrerCode || ''),
      confirmReferral: body.confirmReferral === true,
    };
    const result = brandPilotDbEnabled() ? await redeemDbBrandDemoInvite(payload) : redeemBrandPilotInvite(payload);
    const resolved = result as { user?: unknown; memberId?: number; idempotent?: boolean };
    const row = resolved.user || findLocalCnUserById(Number(resolved.memberId || 0));
    if (!row) throw new Error('找不到会员');
    const user = brandPilotDbEnabled() ? toDbDemoSessionUser(row as never) : toSessionUser(row as LocalCnUser);
    return jsonWithSession({ user, token: createSessionToken(user), next: body.next || '/cn/shop', idempotent: result.idempotent, pilotIdentity: brandPilotDbEnabled() ? await getDbBrandPilotIdentity(user.id) : getLocalBrandPilotIdentity(user.id) }, user);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '品牌受邀测试登入失败' }, { status: 400 });
  }
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, setSessionCookie, type SessionUser } from '@/lib/auth';
import {
  appendLocalCnReferralBindingAudit,
  clearPendingReferralAttributionCookie,
  readPendingReferralAttribution,
} from '@/lib/local-cn-referral-attribution';
import {
  CAOMI_SCOOT_REFERRAL_CODE,
  ensureLocalCnScootAdminAccount,
  findLocalCnUserById,
  findOrCreateLocalPhoneUser,
} from '@/lib/local-cn-users';
import { normalizeCnOrTwPhone, verifyPhoneCodeChallenge } from '@/lib/phone-sms/challenges';

export const dynamic = 'force-dynamic';

type PhoneChallenge = {
  id: string;
  phone: string;
  code: string;
  attempts: number;
  expiresAt: number;
  createdAt: string;
};

function challengesPath() {
  const dir = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dir, 'cn-phone-challenges.json');
}

function readChallenges(): PhoneChallenge[] {
  const target = challengesPath();
  if (!existsSync(target)) return [];
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeChallenges(rows: PhoneChallenge[]) {
  const target = challengesPath();
  mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, target);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizeCnOrTwPhone(body.phone);
    const code = String(body.code || '').trim();
    const challengeId = String(body.challengeId || '').trim();
    if (!phone || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: '请输入有效手机号及 6 位数字验证码', code: 'INVALID_INPUT' }, { status: 400 });
    }
    const verified = verifyPhoneCodeChallenge(phone, code);
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error || '验证码已过期或不正确，请重新获取验证码', code: 'INVALID_CODE' }, { status: 400 });
    }

    const pending = readPendingReferralAttribution(request, body.referrerCode ? String(body.referrerCode) : null);
    const referrerUser = (pending?.referrerMemberId ? findLocalCnUserById(pending.referrerMemberId) : null) || ensureLocalCnScootAdminAccount();
    const created = findOrCreateLocalPhoneUser({
      phone,
      displayName: body.nickname || body.displayName || null,
      referrerCode: referrerUser?.referralCode || CAOMI_SCOOT_REFERRAL_CODE,
      referredByMemberId: referrerUser?.id || null,
      referralAttributionId: pending?.attributionId || null,
      referralVisitId: pending?.visitId || null,
    });

    if (created.isNew && pending && referrerUser) {
      appendLocalCnReferralBindingAudit({
        memberId: created.user.id,
        referredByMemberId: referrerUser.id,
        linkId: pending.linkId,
        visitId: pending.visitId,
        attributionId: pending.attributionId,
        source: 'phone_sms',
        result: 'bound',
        reason: 'verified_phone_first_bind',
      });
    }

    const sessionUser: SessionUser = {
      id: created.user.id,
      name: created.user.name,
      email: created.user.email,
      agentLevel: created.user.agentLevel,
      role: created.user.role,
      region: 'CN',
      referralCode: created.user.referralCode,
      platformAdmin: created.user.platformAdmin === true,
      referralSharingEnabled: created.user.referralSharingEnabled !== false,
    };

    const nextPath = String(body.next || '/cn/member').startsWith('/') ? String(body.next || '/cn/member') : '/cn/member';
    const response = NextResponse.json({
      ok: true,
      user: sessionUser,
      token: createSessionToken(sessionUser),
      isNewMember: created.isNew,
      redirectTo: nextPath,
      message: created.isNew ? '手机号验证成功，已完成会员注册与推荐绑定' : '手机号验证登录成功',
    });
    setSessionCookie(response, sessionUser);
    clearPendingReferralAttributionCookie(response, (process.env.NEXT_PUBLIC_APP_URL || '').startsWith('https://'));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '手机号验证失败' }, { status: 500 });
  }
}

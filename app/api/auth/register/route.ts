import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { referralBindingAudit, users } from '@/lib/schema';
import { eq, or } from 'drizzle-orm';
import { createSessionToken, hashPassword, setSessionCookie, toSessionUser } from '@/lib/auth';
import { createReferralCode, resolveReferrerId, sanitizeReferralCode } from '@/lib/referrals';
import { createLocalCnUser, findLocalCnUserById, normalizeCnReferrerCode } from '@/lib/local-cn-users';
import { addMemberHealthRecord } from '@/lib/local-cn-member-workspace';
import {
  appendLocalCnReferralBindingAudit,
  clearPendingReferralAttributionCookie,
  readPendingReferralAttribution,
} from '@/lib/local-cn-referral-attribution';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, phone, email, password, store, wechatId, healthFileName, healthSummary, healthCategory, healthConsent, hasPacemaker, isPregnant, isUnderFive } = body;
    const pendingReferral = readPendingReferralAttribution(request);

    if (!name || !phone || !email || !password) {
      return NextResponse.json(
        { message: '请填写所有必填栏位' },
        { status: 400 }
      );
    }

    if (!/^1\d{10}$/.test(String(phone).replace(/\s+/g, '')) || String(password).length < 6) {
      return NextResponse.json({ message: '请输入 11 位手机号，密码至少 6 位' }, { status: 400 });
    }
    if ((healthFileName || healthSummary) && healthConsent !== true) {
      return NextResponse.json({ message: '上传健康资料前必须取得会员本人授权' }, { status: 400 });
    }
    if (!pendingReferral) {
      return NextResponse.json({ message: '请从邀请链接进入完成会员注册' }, { status: 400 });
    }
    if (body.confirmReferral !== true) {
      return NextResponse.json({ message: '请先确认邀请人后再注册' }, { status: 400 });
    }

    if (!process.env.DATABASE_URL) {
      const referrer = findLocalCnUserById(pendingReferral.referrerMemberId);
      if (!referrer || referrer.referralSharingEnabled === false) {
        return NextResponse.json({ message: '邀请链接已失效，请联系邀请人重新分享' }, { status: 400 });
      }
      const referralCodeValue = createReferralCode(name);
      const user = createLocalCnUser({
        name: String(name).trim(), phone: String(phone).trim(), email: String(email).trim().toLowerCase(),
        passwordHash: hashPassword(password), role: 'member', agentLevel: 1,
        referralCode: referralCodeValue,
        referrerCode: normalizeCnReferrerCode(referrer.referralCode),
        referredByMemberId: referrer.id,
        referralBoundAt: new Date().toISOString(),
        referralSource: 'web_register',
        referralAttributionId: pendingReferral.attributionId,
        referralVisitId: pendingReferral.visitId,
        store: store ? String(store) : null, wechatId: wechatId ? String(wechatId) : null,
      });
      if (!user) return NextResponse.json({ message: 'Email 或手机号已被注册' }, { status: 409 });
      appendLocalCnReferralBindingAudit({
        memberId: user.id,
        referredByMemberId: referrer.id,
        linkId: pendingReferral.linkId,
        visitId: pendingReferral.visitId,
        attributionId: pendingReferral.attributionId,
        source: 'web_register',
        result: 'bound',
        reason: 'first_valid_bind',
      });
      const sessionUser = { id: user.id, name: user.name, email: user.email, agentLevel: user.agentLevel, role: user.role, region: 'CN', referralCode: user.referralCode };
      if (healthFileName || healthSummary) {
        addMemberHealthRecord(sessionUser, {
          fileName: healthFileName,
          advice: healthSummary,
          category: healthCategory,
          source: store ? `${String(store)}建档` : '会员建档',
          consentGranted: healthConsent === true,
          hasPacemaker: hasPacemaker === true,
          isPregnant: isPregnant === true,
          isUnderFive: isUnderFive === true,
        });
      }
      const response = NextResponse.json({ user: sessionUser, token: createSessionToken(sessionUser) }, { status: 201 });
      setSessionCookie(response, sessionUser);
      clearPendingReferralAttributionCookie(response, request.nextUrl.protocol === 'https:');
      return response;
    }

    const existingUsers = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.email, email),
          eq(users.phone, phone)
        )
      )
      .limit(1);

    if (existingUsers.length > 0) {
      return NextResponse.json(
        { message: 'Email 或手机号号码已被注册' },
        { status: 409 }
      );
    }

    const now = new Date();
    const resolvedReferrerId = pendingReferral.referrerMemberId || await resolveReferrerId(sanitizeReferralCode(''));
    if (!resolvedReferrerId) {
      return NextResponse.json({ message: '请从邀请链接进入完成会员注册' }, { status: 400 });
    }
    const newUsers = await db
      .insert(users)
      .values({
        name,
        phone,
        email,
        passwordHash: hashPassword(password),
        referralCode: createReferralCode(name),
        referrerId: resolvedReferrerId || null,
        referredByMemberId: resolvedReferrerId || null,
        referralBoundAt: new Date(),
        referralSource: 'web_register',
        referralAttributionId: pendingReferral.attributionId,
        referralVisitId: pendingReferral.visitId,
        agentLevel: 0,
        role: 'member',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await db.insert(referralBindingAudit).values({
      auditId: `RBA-${Date.now()}-${newUsers[0].id}`,
      memberId: newUsers[0].id,
      referredByMemberId: resolvedReferrerId,
      linkId: pendingReferral.linkId,
      visitId: pendingReferral.visitId,
      attributionId: pendingReferral.attributionId,
      source: 'web_register',
      result: 'bound',
      reason: 'first_valid_bind',
      createdAt: now,
    });

    const sessionUser = toSessionUser(newUsers[0]);
    if (healthFileName || healthSummary) {
      addMemberHealthRecord(sessionUser, {
        fileName: healthFileName,
        advice: healthSummary,
        category: healthCategory,
        source: store ? `${String(store)}建档` : '会员建档',
        consentGranted: healthConsent === true,
        hasPacemaker: hasPacemaker === true,
        isPregnant: isPregnant === true,
        isUnderFive: isUnderFive === true,
      });
    }
    const response = NextResponse.json({ user: sessionUser, token: createSessionToken(sessionUser) });
    setSessionCookie(response, sessionUser);
    clearPendingReferralAttributionCookie(response, request.nextUrl.protocol === 'https:');
    return response;
  } catch (error) {
    console.error('Register error:', error);
    return NextResponse.json(
      { message: '注册时发生错误' },
      { status: 500 }
    );
  }
}

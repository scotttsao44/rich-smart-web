import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { createSessionToken, getRequestSession, toSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { completeLocalWechatOnboarding, updateLocalWechatProfile } from '@/lib/local-cn-users';
import { jsonWithSession } from '@/lib/oauth';
import { bindReferrerIfMissing } from '@/lib/referrals';
import { userIdentities, users } from '@/lib/schema';
import { referralCodeFromLocalCnReferralToken } from '@/lib/local-cn-referral-attribution';

export async function POST(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session) return NextResponse.json({ error: '请先完成微信登录' }, { status: 401 });
  try {
    const body = await request.json();
    const action = String(body.action || 'profile');
    if (!['profile', 'complete'].includes(action)) return NextResponse.json({ error: '不支持的资料操作' }, { status: 400 });
    const referralToken = String(body.referralToken || '').trim();
    const referrerCode = referralToken ? referralCodeFromLocalCnReferralToken(referralToken) || '' : '';

    if (!process.env.DATABASE_URL) {
      const local = action === 'complete'
        ? completeLocalWechatOnboarding(session.id, { ...body, referrerCode })
        : updateLocalWechatProfile(session.id, { name: body.nickName, avatarUrl: body.avatarUrl, referrerCode });
      const user = { id: local.id, name: local.name, email: local.email, agentLevel: local.agentLevel, role: local.role, region: 'CN', referralCode: local.referralCode, platformAdmin: local.platformAdmin === true };
      return jsonWithSession({ user, token: createSessionToken(user), profileAuthorized: Boolean(local.profileAuthorizedAt), onboardingCompleted: Boolean(local.onboardingCompletedAt), phoneBound: Boolean(local.phoneVerifiedAt) }, user);
    }

    const identity = (await db.select().from(userIdentities).where(and(eq(userIdentities.userId, session.id), eq(userIdentities.provider, 'wechat_mini_program'))).limit(1))[0];
    if (!identity) return NextResponse.json({ error: '找不到当前微信身份' }, { status: 404 });
    const metadata = identity.metadata && typeof identity.metadata === 'object' ? identity.metadata as Record<string, unknown> : {};
    const now = new Date();
    if (referrerCode) await bindReferrerIfMissing(session.id, referrerCode);
    if (action === 'complete') {
      const healthGoal = String(body.healthGoal || '').trim();
      if (!healthGoal) return NextResponse.json({ error: '请选择目前最关注的健康方向' }, { status: 400 });
      const birthYear = String(body.birthYear || '').trim();
      if (birthYear && (!/^\d{4}$/.test(birthYear) || Number(birthYear) < 1900 || Number(birthYear) > now.getFullYear())) {
        return NextResponse.json({ error: '出生年份格式不正确' }, { status: 400 });
      }
      await db.update(userIdentities).set({
        metadata: { ...metadata, referrerCode: referrerCode || metadata.referrerCode, questionnaire: { gender: String(body.gender || '').slice(0, 20), birthYear, healthGoal: healthGoal.slice(0, 100), store: String(body.store || '').slice(0, 100) }, onboardingCompletedAt: now.toISOString() },
        updatedAt: now,
      }).where(eq(userIdentities.id, identity.id));
    } else {
      const nickName = String(body.nickName || '').trim().slice(0, 80);
      if (!nickName) return NextResponse.json({ error: '微信昵称授权资料为空，请重新授权' }, { status: 400 });
      const avatarUrl = /^https:\/\//.test(String(body.avatarUrl || '')) ? String(body.avatarUrl).slice(0, 1000) : null;
      await db.update(userIdentities).set({ displayName: nickName || identity.displayName, avatarUrl: avatarUrl || identity.avatarUrl, metadata: { ...metadata, referrerCode: referrerCode || metadata.referrerCode, profileAuthorizedAt: now.toISOString(), onboardingCompletedAt: metadata.onboardingCompletedAt || now.toISOString() }, updatedAt: now }).where(eq(userIdentities.id, identity.id));
      if (nickName) await db.update(users).set({ name: nickName, updatedAt: now }).where(eq(users.id, session.id));
    }
    const row = (await db.select().from(users).where(eq(users.id, session.id)).limit(1))[0];
    if (!row) return NextResponse.json({ error: '找不到当前会员' }, { status: 404 });
    const user = toSessionUser(row);
    return jsonWithSession({ user, token: createSessionToken(user), profileAuthorized: action === 'profile' || Boolean(metadata.profileAuthorizedAt), onboardingCompleted: action === 'profile' || action === 'complete' || Boolean(metadata.onboardingCompletedAt), phoneBound: Boolean(row.phone) }, user);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '会员资料保存失败' }, { status: 400 });
  }
}

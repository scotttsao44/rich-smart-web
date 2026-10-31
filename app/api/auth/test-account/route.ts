import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createSessionToken, getFreshSessionUser, hasPlatformAdminAccess, type SessionUser } from '@/lib/auth';
import { jsonWithSession } from '@/lib/oauth';
import { CAOMI_TEST_ACCOUNT_USER_ID, ensureLocalCnScootAdminAccount, ensureLocalCnTestAccount, type LocalCnUser } from '@/lib/local-cn-users';
import {
  isCnAdminTestAccountOpenWithoutCode,
  isCnPrivateAdminLoginEnabled,
  isAllowedCnTestMiniEnvironment,
  isCnTestAccountEnabled,
  resetLocalCnTestAccountData,
} from '@/lib/local-cn-test-account';

export const dynamic = 'force-dynamic';

function unavailable() {
  return NextResponse.json({ error: '快速入口仅在指定的小程序版本开放' }, { status: 404 });
}

function toSessionUser(user: LocalCnUser): SessionUser & { testAccount: true } {
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
    testAccount: true,
  };
}

function secureCodeMatches(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || 'login');
    if (!isAllowedCnTestMiniEnvironment(request.headers.get('x-caomi-mini-env'))) return unavailable();
    if (action === 'login_admin') {
      if (!isCnPrivateAdminLoginEnabled()) return unavailable();
      const expectedCode = String(process.env.CN_ADMIN_TEST_ACCESS_CODE || '');
      const receivedCode = String(body.accessCode || '');
      if (expectedCode && !secureCodeMatches(receivedCode, expectedCode)) {
        return NextResponse.json({ error: '管理员进入码不正确' }, { status: 403 });
      }
      if (!expectedCode && !isCnAdminTestAccountOpenWithoutCode()) {
        return NextResponse.json({ error: '管理员进入码不正确' }, { status: 403 });
      }
      const user = toSessionUser(ensureLocalCnScootAdminAccount());
      return jsonWithSession({ user, token: createSessionToken(user), testAccount: true, needsProfile: false, needsOnboarding: false, phoneBound: true }, user);
    }
    if (!isCnTestAccountEnabled()) return unavailable();
    if (action === 'login') {
      const user = toSessionUser(ensureLocalCnTestAccount());
      return jsonWithSession({ user, token: createSessionToken(user), testAccount: true, needsProfile: false, needsOnboarding: false, phoneBound: true }, user);
    }
    if (action === 'reset') {
      const current = await getFreshSessionUser(request);
      if (!current || (current.id !== CAOMI_TEST_ACCOUNT_USER_ID && !hasPlatformAdminAccess(current))) {
        return NextResponse.json({ error: '仅当前帐号本人或平台管理员可以执行重置' }, { status: 403 });
      }
      const reset = resetLocalCnTestAccountData();
      const user = toSessionUser(reset.user);
      return jsonWithSession({ user, token: createSessionToken(user), testAccount: true, reset: reset.removed }, user);
    }
    return NextResponse.json({ error: '不支持的帐号操作' }, { status: 400 });
  } catch (error) {
    console.error('可重置帐号操作失败:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '帐号操作失败' }, { status: 500 });
  }
}

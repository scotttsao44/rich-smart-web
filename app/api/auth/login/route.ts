import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, or } from 'drizzle-orm';
import { createSessionToken, hashPassword, setSessionCookie, toSessionUser, verifyPassword } from '@/lib/auth';
import { findLocalCnUser } from '@/lib/local-cn-users';
import { EmailAuthError, isAllowedEmailAuthOrigin, loginEmailMember } from '@/lib/email-auth/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const identifier = String(body.identifier || body.email || body.phone || body.account || body.username || '').trim();
    const password = String(body.password || '');

    if (!identifier) {
      const msg = '请输入手机号或邮箱账号';
      return NextResponse.json(
        { error: msg, message: msg },
        { status: 400 }
      );
    }

    if (!password) {
      const msg = '请输入登录密码，或使用上方手机验证码一键登录';
      return NextResponse.json(
        { error: msg, message: msg },
        { status: 400 }
      );
    }

    const invalidCredMsg = '账号或密码错误，请重新输入或使用手机验证码一键登录';

    if (!process.env.DATABASE_URL) {
      const localUser = findLocalCnUser(identifier);
      if (localUser?.emailRegistrationId) {
        if (!isAllowedEmailAuthOrigin(request.headers.get('origin'), request.nextUrl.origin)) {
          return NextResponse.json({ error: '请求来源无效', message: '请求来源无效' }, { status: 403 });
        }
        const user = loginEmailMember(localUser.email, password);
        const response = NextResponse.json({ user, token: createSessionToken(user) });
        setSessionCookie(response, user);
        return response;
      }
      if (!localUser || !verifyPassword(password, localUser.passwordHash)) {
        return NextResponse.json({ error: invalidCredMsg, message: invalidCredMsg }, { status: 401 });
      }
      const sessionUser = {
        id: localUser.id,
        name: localUser.name,
        email: localUser.email,
        agentLevel: localUser.agentLevel,
        role: localUser.role,
        region: 'CN' as const,
        referralCode: localUser.referralCode,
        platformAdmin: localUser.platformAdmin === true,
        referralSharingEnabled: localUser.referralSharingEnabled !== false,
      };
      const response = NextResponse.json({ user: sessionUser, token: createSessionToken(sessionUser) });
      setSessionCookie(response, sessionUser);
      return response;
    }

    const userResults = await db
      .select()
      .from(users)
      .where(
        or(
          eq(users.email, identifier),
          eq(users.phone, identifier)
        )
      )
      .limit(1);

    const user = userResults[0];

    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: invalidCredMsg, message: invalidCredMsg },
        { status: 401 }
      );
    }

    if (user.passwordHash && !user.passwordHash.startsWith('scrypt$')) {
      await db
        .update(users)
        .set({ passwordHash: hashPassword(password), updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    if (user.status && user.status !== 'active') {
      const msg = '账号已被停用，请联系客服处理';
      return NextResponse.json(
        { error: msg, message: msg },
        { status: 403 }
      );
    }

    const sessionUser = toSessionUser(user);
    const response = NextResponse.json({ user: sessionUser, token: createSessionToken(sessionUser) });
    setSessionCookie(response, sessionUser);
    return response;
  } catch (error) {
    if (error instanceof EmailAuthError) {
      return NextResponse.json({ error: error.message, message: error.message, code: error.code }, { status: error.status });
    }
    console.error('Login error:', error);
    const msg = '登录服务暂时繁忙，请稍后重试或使用手机验证码一键登录';
    return NextResponse.json(
      { error: msg, message: msg },
      { status: 500 }
    );
  }
}

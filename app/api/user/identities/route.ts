import { db } from '@/lib/db';
import { userIdentities, users } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supportedProviders = new Set(['line', 'wechat', 'wechat_mini_program']);

function normalizeProvider(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

export async function GET(req: NextRequest) {
  try {
    const userId = Number(req.nextUrl.searchParams.get('userId'));
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: '缺少有效用户ID' }, { status: 400 });
    }

    const items = await db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, userId));

    return NextResponse.json({ identities: items });
  } catch (error) {
    console.error('读取身份绑定失败:', error);
    return NextResponse.json({ error: '读取身份绑定失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = Number(body.userId);
    const provider = normalizeProvider(body.provider);
    const providerUserId = normalizeText(body.providerUserId);
    const displayName = normalizeText(body.displayName);
    const avatarUrl = normalizeText(body.avatarUrl);

    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: '缺少有效用户ID' }, { status: 400 });
    }

    if (!supportedProviders.has(provider)) {
      return NextResponse.json({ error: '不支持的绑定类型' }, { status: 400 });
    }

    if (!providerUserId) {
      return NextResponse.json({ error: '缺少外部身份ID' }, { status: 400 });
    }

    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (existingUser.length === 0) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const sameIdentity = await db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.provider, provider),
          eq(userIdentities.providerUserId, providerUserId)
        )
      )
      .limit(1);

    if (sameIdentity[0] && sameIdentity[0].userId !== userId) {
      return NextResponse.json({ error: '此身份已绑定其他会员' }, { status: 409 });
    }

    const existingForUser = await db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.userId, userId),
          eq(userIdentities.provider, provider)
        )
      )
      .limit(1);

    const payload = {
      userId,
      provider,
      providerUserId,
      displayName: displayName || null,
      avatarUrl: avatarUrl || null,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      updatedAt: new Date(),
    };

    const result = existingForUser[0]
      ? await db
          .update(userIdentities)
          .set(payload)
          .where(eq(userIdentities.id, existingForUser[0].id))
          .returning()
      : await db
          .insert(userIdentities)
          .values(payload)
          .returning();

    return NextResponse.json({ identity: result[0] });
  } catch (error) {
    console.error('储存身份绑定失败:', error);
    return NextResponse.json({ error: '储存身份绑定失败' }, { status: 500 });
  }
}

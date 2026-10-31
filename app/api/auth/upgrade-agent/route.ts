import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { message: '缺少用户 ID' },
        { status: 400 }
      );
    }

    const updatedUsers = await db
      .update(users)
      .set({ agentLevel: 1 })
      .where(eq(users.id, userId))
      .returning();

    if (updatedUsers.length === 0) {
      return NextResponse.json(
        { message: '用户不存在' },
        { status: 404 }
      );
    }

    const user = updatedUsers[0];
    const { passwordHash, ...userWithoutPassword } = user;

    return NextResponse.json({
      user: {
        id: userWithoutPassword.id,
        name: userWithoutPassword.name || '',
        email: userWithoutPassword.email || '',
        agentLevel: userWithoutPassword.agentLevel,
        region: 'TW',
      },
    });
  } catch (error) {
    console.error('Upgrade agent error:', error);
    return NextResponse.json(
      { message: '升级代理时发生错误' },
      { status: 500 }
    );
  }
}

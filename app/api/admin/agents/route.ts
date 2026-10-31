import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq, gt, desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const agentList = await db.select().from(users)
      .where(gt(users.agentLevel, 0))
      .orderBy(desc(users.agentLevel));
    return NextResponse.json(agentList);
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const { id, agentLevel } = body;
    if (!id || agentLevel === undefined) {
      return NextResponse.json({ error: 'User ID and agentLevel are required' }, { status: 400 });
    }
    await db.update(users).set({ agentLevel }).where(eq(users.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update agent level:', error);
    return NextResponse.json({ error: 'Failed to update agent level' }, { status: 500 });
  }
}

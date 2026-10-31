import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { POST as loginPost } from './login/route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  return NextResponse.json({ user: user || null });
}

export async function POST(request: NextRequest) {
  return loginPost(request);
}

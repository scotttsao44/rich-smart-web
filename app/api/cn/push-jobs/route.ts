import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { runPushSchedule } from '@/lib/cn-push-schedule';

export const dynamic = 'force-dynamic';

// 例行任务入口：POST /api/cn/push-jobs?task=daily|escalate[&dryRun=0][&testOpenid=…]
// 认证：Authorization: Bearer $PUSH_JOB_TOKEN（服务器环境变量），或平台管理员登录。
// 默认 dry-run；真实发送需 dryRun=0 且服务器 PUSH_WAKE_LIVE=1。
function tokenOk(request: NextRequest) {
  const expected = process.env.PUSH_JOB_TOKEN || '';
  const got = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || expected.length < 24 || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const allowed = tokenOk(request) || hasPlatformAdminAccess(await getFreshSessionUser(request));
  if (!allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const task = q.get('task') === 'escalate' ? 'escalate' : 'daily';
  const result = await runPushSchedule({ task, dryRun: q.get('dryRun') !== '0', testOpenid: q.get('testOpenid') || undefined });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

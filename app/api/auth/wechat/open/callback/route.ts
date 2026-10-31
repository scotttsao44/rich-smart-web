import { NextRequest } from 'next/server';
import { finishWechatWebOAuth } from '@/lib/wechat-web-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return finishWechatWebOAuth(request, 'open');
}

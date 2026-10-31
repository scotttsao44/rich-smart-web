import { NextRequest } from 'next/server';
import { startWechatWebOAuth } from '@/lib/wechat-web-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return startWechatWebOAuth(request, 'open');
}

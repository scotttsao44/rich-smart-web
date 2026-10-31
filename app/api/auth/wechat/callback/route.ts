import { NextRequest } from 'next/server';
import { finishWechatWebOAuth, isWechatBrowser } from '@/lib/wechat-web-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const kind = isWechatBrowser(request.headers.get('user-agent') || '') ? 'official' : 'open';
  return finishWechatWebOAuth(request, kind);
}

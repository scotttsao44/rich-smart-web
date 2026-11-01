import { NextRequest, NextResponse } from 'next/server';
import { getWechatJssdkConfig } from '@/lib/wechat-jssdk';

export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = new Set(['rich-smart.com.cn', 'www.rich-smart.com.cn']);

export async function GET(request: NextRequest) {
  const pageUrl = String(request.nextUrl.searchParams.get('url') || '').split('#')[0];
  let host = '';
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    host = '';
  }
  if (!ALLOWED_HOSTS.has(host)) {
    return NextResponse.json({ ok: false, error: 'url not allowed' });
  }
  const config = await getWechatJssdkConfig(pageUrl);
  if (!config) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, ...config });
}

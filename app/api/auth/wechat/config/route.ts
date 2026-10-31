import { jsonWechatWebConfig } from '@/lib/wechat-web-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  return jsonWechatWebConfig();
}

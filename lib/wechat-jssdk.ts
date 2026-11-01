import { createHash, randomBytes } from 'crypto';

// 公众号 JS-SDK：access_token / jsapi_ticket 服务端缓存 7000 秒；失败时返回 null（页面照常可用，只是不配置分享卡片）
type Cached = { value: string; expiresAt: number };
let tokenCache: Cached | null = null;
let ticketCache: Cached | null = null;
let failedUntil = 0;

const TTL_MS = 7000 * 1000;
const FAIL_BACKOFF_MS = 60 * 1000;

async function getAccessToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const appId = process.env.WECHAT_OFFICIAL_APP_ID || '';
  const secret = process.env.WECHAT_OFFICIAL_APP_SECRET || '';
  if (!appId || !secret) return null;
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', secret);
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    console.warn('[wechat-jssdk] cgi-bin/token failed errcode=', data.errcode);
    return null;
  }
  tokenCache = { value: String(data.access_token), expiresAt: Date.now() + TTL_MS };
  return tokenCache.value;
}

async function getJsapiTicket(): Promise<string | null> {
  if (ticketCache && ticketCache.expiresAt > Date.now()) return ticketCache.value;
  const token = await getAccessToken();
  if (!token) return null;
  const url = new URL('https://api.weixin.qq.com/cgi-bin/ticket/getticket');
  url.searchParams.set('access_token', token);
  url.searchParams.set('type', 'jsapi');
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!data.ticket) {
    console.warn('[wechat-jssdk] getticket failed errcode=', data.errcode);
    if (data.errcode === 40001 || data.errcode === 42001) tokenCache = null;
    return null;
  }
  ticketCache = { value: String(data.ticket), expiresAt: Date.now() + TTL_MS };
  return ticketCache.value;
}

export async function getWechatJssdkConfig(pageUrl: string) {
  if (Date.now() < failedUntil) return null;
  try {
    const ticket = await getJsapiTicket();
    if (!ticket) {
      failedUntil = Date.now() + FAIL_BACKOFF_MS;
      return null;
    }
    const nonceStr = randomBytes(8).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000);
    const raw = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${pageUrl}`;
    const signature = createHash('sha1').update(raw).digest('hex');
    return { appId: process.env.WECHAT_OFFICIAL_APP_ID || '', timestamp, nonceStr, signature };
  } catch {
    failedUntil = Date.now() + FAIL_BACKOFF_MS;
    return null;
  }
}

// 服务号接口：只用 cgi-bin/stable_token（force_refresh=false），不调用 cgi-bin/token，
// 以免与 lib/wechat-jssdk.ts 自己缓存的 access_token 互相作废。
type Cached = { value: string; expiresAt: number };
let stableCache: Cached | null = null;

export async function getMpStableToken(): Promise<string | null> {
  if (stableCache && stableCache.expiresAt > Date.now()) return stableCache.value;
  const appid = process.env.WECHAT_OFFICIAL_APP_ID || '';
  const secret = process.env.WECHAT_OFFICIAL_APP_SECRET || '';
  if (!appid || !secret) return null;
  try {
    const res = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid, secret, force_refresh: false }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.access_token) {
      console.warn('[wechat-mp] stable_token failed errcode=', data.errcode);
      return null;
    }
    const ttl = Math.max(60, Number(data.expires_in || 7200) - 300) * 1000;
    stableCache = { value: String(data.access_token), expiresAt: Date.now() + ttl };
    return stableCache.value;
  } catch {
    console.warn('[wechat-mp] stable_token request error');
    return null;
  }
}

export type MpSendResult = { ok: boolean; errcode?: number | string };

async function postWithToken(path: string, body: unknown): Promise<MpSendResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getMpStableToken();
    if (!token) return { ok: false, errcode: 'no_token' };
    try {
      const res = await fetch(`https://api.weixin.qq.com${path}?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      const errcode = Number(data.errcode || 0);
      if (errcode === 0) return { ok: true };
      if ((errcode === 40001 || errcode === 42001) && attempt === 0) {
        stableCache = null;
        continue;
      }
      return { ok: false, errcode };
    } catch {
      return { ok: false, errcode: 'network' };
    }
  }
  return { ok: false, errcode: 'retry_exhausted' };
}

// 客服消息：只能在用户最后一次互动后 48 小时内发送
export function sendMpCustomText(openid: string, content: string) {
  return postWithToken('/cgi-bin/message/custom/send', { touser: openid, msgtype: 'text', text: { content } });
}

export function sendMpTemplate(openid: string, templateId: string, url: string, data: Record<string, string>) {
  const payload: Record<string, { value: string }> = {};
  for (const [k, v] of Object.entries(data)) payload[k] = { value: v };
  return postWithToken('/cgi-bin/message/template/send', { touser: openid, template_id: templateId, url, data: payload });
}

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

export type MpSendResult = { ok: boolean; errcode?: number | string; data?: Record<string, unknown> };

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
      if (errcode === 0) return { ok: true, data };
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

// 临时带参二维码（QR_STR_SCENE，scene_str ≤ 64 字符，有效期最长 30 天）；返回二维码内容 URL（weixin.qq.com/q/…）
export async function createMpTempQr(sceneStr: string, expireSeconds: number) {
  const r = await postWithToken('/cgi-bin/qrcode/create', {
    expire_seconds: Math.min(2592000, Math.max(60, Math.floor(expireSeconds))),
    action_name: 'QR_STR_SCENE',
    action_info: { scene: { scene_str: sceneStr.slice(0, 64) } },
  });
  const url = String(r.data?.url || '');
  if (!r.ok || !/^https?:\/\/weixin\.qq\.com\/q\//.test(url)) return { ok: false as const, errcode: r.errcode ?? 'no_url' };
  return { ok: true as const, url, expireSeconds: Number(r.data?.expire_seconds || expireSeconds) };
}

// 用户是否关注服务号：true / false；查不到（openid 不属于本服务号、接口失败）返回 null
export async function getMpUserSubscribed(openid: string): Promise<boolean | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getMpStableToken();
    if (!token) return null;
    try {
      const res = await fetch(`https://api.weixin.qq.com/cgi-bin/user/info?access_token=${encodeURIComponent(token)}&openid=${encodeURIComponent(openid)}&lang=zh_CN`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json().catch(() => ({}));
      const errcode = Number(data.errcode || 0);
      if (errcode === 0 && (data.subscribe === 0 || data.subscribe === 1)) return data.subscribe === 1;
      if ((errcode === 40001 || errcode === 42001) && attempt === 0) {
        stableCache = null;
        continue;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

// 企业微信自建应用「糙米健康助手」接口（客户联系）
// 凭证：WECOM_CORP_ID + WECOM_APP_SECRET（gettoken，缓存到过期前 5 分钟）；WECOM_AGENT_ID 用于应用消息。
// 所有调用只返回 errcode / 业务字段，不记录 access_token。

type Cached = { value: string; expiresAt: number };
let tokenCache: Cached | null = null;
const BASE = 'https://qyapi.weixin.qq.com/cgi-bin';

export function wecomConfigured() {
  return Boolean(process.env.WECOM_CORP_ID && process.env.WECOM_APP_SECRET);
}

export async function getWecomToken(force = false): Promise<string | null> {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const corpid = process.env.WECOM_CORP_ID || '';
  const secret = process.env.WECOM_APP_SECRET || '';
  if (!corpid || !secret) return null;
  try {
    const res = await fetch(`${BASE}/gettoken?corpid=${encodeURIComponent(corpid)}&corpsecret=${encodeURIComponent(secret)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const data = await res.json().catch(() => ({}));
    if (!data.access_token) {
      console.warn('[wecom] gettoken failed errcode=', data.errcode);
      return null;
    }
    tokenCache = { value: String(data.access_token), expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 7200) - 300) * 1000 };
    return tokenCache.value;
  } catch {
    console.warn('[wecom] gettoken network error');
    return null;
  }
}

export type WecomResult<T = Record<string, unknown>> = { ok: boolean; errcode: number | string; errmsg?: string; data: T };

async function call<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, query: Record<string, string> = {}, body?: unknown): Promise<WecomResult<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getWecomToken(attempt > 0);
    if (!token) return { ok: false, errcode: 'no_token', data: {} as T };
    const qs = new URLSearchParams({ access_token: token, ...query });
    try {
      const res = await fetch(`${BASE}${path}?${qs.toString()}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      const errcode = Number(data.errcode || 0);
      if (errcode === 0) return { ok: true, errcode: 0, data };
      if ((errcode === 40014 || errcode === 42001 || errcode === 40001) && attempt === 0) {
        tokenCache = null;
        continue;
      }
      return { ok: false, errcode, errmsg: String(data.errmsg || '').split(',')[0].slice(0, 80), data };
    } catch {
      return { ok: false, errcode: 'network', data: {} as T };
    }
  }
  return { ok: false, errcode: 'retry_exhausted', data: {} as T };
}

// 成员：user/list 对自建应用常受限（48002），用 department 1 递归 simplelist
export async function listWecomMembers() {
  const r = await call<{ userlist?: Array<{ userid: string; name: string; department?: number[] }> }>('GET', '/user/simplelist', { department_id: '1', fetch_child: '1' });
  return { ...r, members: (r.data.userlist || []).map((u) => ({ userid: String(u.userid), name: String(u.name || '') })) };
}

export async function findWecomUserIdByName(name: string) {
  const r = await listWecomMembers();
  return r.members.find((m) => m.name === name)?.userid || null;
}

// 配置了客户联系功能的成员
export async function getFollowUserList() {
  const r = await call<{ follow_user?: string[] }>('GET', '/externalcontact/get_follow_user_list');
  return { ...r, followUsers: (r.data.follow_user || []).map(String) };
}

// 联系我：type 1 单人，scene 2 二维码；state ≤ 30 字符
export async function addContactWay(input: { userid: string; state: string; remark?: string; skipVerify?: boolean }) {
  const r = await call<{ config_id?: string; qr_code?: string }>('POST', '/externalcontact/add_contact_way', {}, {
    type: 1,
    scene: 2,
    user: [input.userid],
    state: input.state.slice(0, 30),
    remark: (input.remark || '').slice(0, 30) || undefined,
    skip_verify: input.skipVerify !== false,
  });
  return { ...r, configId: String(r.data.config_id || ''), qrCode: String(r.data.qr_code || '') };
}

export async function getContactWay(configId: string) {
  return call('POST', '/externalcontact/get_contact_way', {}, { config_id: configId });
}

export type WecomExternalContact = {
  external_userid: string;
  name?: string;
  type?: number;
  unionid?: string;
  avatar?: string;
};
export type WecomFollowInfo = { userid: string; remark?: string; createtime?: number; state?: string; add_way?: number };

export async function getExternalContact(externalUserId: string) {
  const r = await call<{ external_contact?: WecomExternalContact; follow_user?: WecomFollowInfo[] }>('GET', '/externalcontact/get', { external_userid: externalUserId });
  return { ...r, contact: r.data.external_contact || null, followUsers: r.data.follow_user || [] };
}

export async function listExternalContacts(userid: string) {
  const r = await call<{ external_userid?: string[] }>('GET', '/externalcontact/list', { userid });
  // 84061 = 该成员没有外部联系人
  if (!r.ok && Number(r.errcode) === 84061) return { ...r, ok: true, errcode: 0, ids: [] as string[] };
  return { ...r, ids: (r.data.external_userid || []).map(String) };
}

// 群发助手：创建企业群发任务，成员需在手机企业微信确认后才发出；每位客户每天最多收到 1 条
export async function addMsgTemplate(input: { sender: string; externalUserIds: string[]; text: string; imageMediaId?: string; link?: { title: string; url: string; desc?: string; picurl?: string } }) {
  const attachments: unknown[] = [];
  if (input.link) attachments.push({ msgtype: 'link', link: { title: input.link.title.slice(0, 128), url: input.link.url, desc: input.link.desc?.slice(0, 256), picurl: input.link.picurl } });
  else if (input.imageMediaId) attachments.push({ msgtype: 'image', image: { media_id: input.imageMediaId } });
  const r = await call<{ msgid?: string; fail_list?: string[] }>('POST', '/externalcontact/add_msg_template', {}, {
    chat_type: 'single',
    external_userid: input.externalUserIds,
    sender: input.sender,
    text: { content: input.text.slice(0, 4000) },
    attachments: attachments.length ? attachments : undefined,
  });
  return { ...r, msgid: String(r.data.msgid || ''), failList: (r.data.fail_list || []).map(String) };
}

// 应用消息：发给企业内部成员（如店主本人是企业成员时）
export async function sendWecomAppText(touser: string[], content: string) {
  const agentid = Number(process.env.WECOM_AGENT_ID || 0);
  if (!agentid) return { ok: false, errcode: 'no_agent_id', data: {} } as WecomResult;
  return call('POST', '/message/send', {}, { touser: touser.join('|'), msgtype: 'text', agentid, text: { content: content.slice(0, 2000) }, safe: 0 });
}

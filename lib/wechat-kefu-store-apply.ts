import { findLocalCnUserById, referralOwnerForAttribution } from '@/lib/local-cn-users';
import {
  appendKefuMessage,
  getKefuConversation,
  setKefuMessageDelivery,
  updateKefuConversation,
  type KefuStoreApply,
} from '@/lib/local-cn-wechat-kefu';
import { kefuToSimplified } from '@/lib/wechat-kefu-knowledge';
import { isSimulatedOpenid, notifyKefuHandoff } from '@/lib/wechat-kefu-notify';
import { sendMpCustomText } from '@/lib/wechat-mp-api';

// 门店申请页（/cn/member/store-application）的带参二维码：scene = store_apply[:m会员ID | :r推荐人会员ID]
// 客人扫码关注（subscribe，EventKey=qrscene_<scene>）或已关注扫码（SCAN，EventKey=<scene>）后，
// 立即用客服消息发出门店申请问题模板，并把会话标记为「门店申请收集中」：后续回复按申请字段解析，只追问缺的项，
// 收齐后记录到会话（storeApply + 系统消息 store_apply）并通知客服（KEFU_NOTIFY_OPENIDS），附城市与手机号。
// 不承诺联系时限、不报分润或单次价格；归属只认二维码里的推荐人，没有就留空，不默认官方直属。

export const STORE_APPLY_SCENE = 'store_apply';
const COLLECT_MS = 7 * 24 * 60 * 60 * 1000;
const CORRECT_MS = 24 * 60 * 60 * 1000;
const RE_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const RE_QUESTION = /(多少|什么|怎么|咋|哪|吗|呢|么|几|多久|多长|能不能|可不可以|是不是|有没有|要不要|[?？])/;

export const STORE_APPLY_TEMPLATE = [
  '您好，欢迎咨询「阿富同学」门店合作！',
  '为了让客服同事直接跟进，请回复以下信息（一条消息写完即可）：',
  '1. 所在城市',
  '2. 门店名称与类型（如养生馆、美容院、健康管理中心、社区服务点）',
  '3. 门店面积（大约多少平方米）',
  '4. 联系人称呼与手机号',
  '5. 想合作的方式：投放合作／购机／先了解一下',
  '示例：苏州，XX养生馆（养生馆），80平方米，王女士 138xxxxxxxx，投放合作',
  '收到后客服同事会尽快与您联系；具体合作条件以双方签署的合同为准。',
].join('\n');

const FIELD_LABELS: Record<keyof KefuStoreApply['fields'], string> = {
  city: '所在城市',
  store: '门店名称与类型',
  area: '门店面积',
  contact: '联系人称呼',
  phone: '手机号',
  mode: '想合作的方式（投放合作／购机／了解一下）',
};
const FIELD_ORDER = ['city', 'store', 'area', 'contact', 'phone', 'mode'] as const;

export function parseStoreApplyScene(eventKey?: string | null) {
  const raw = String(eventKey || '').replace(/^qrscene_/, '').trim();
  const m = raw.match(/^store_apply(?::([mr])(\d{1,15}))?$/);
  if (!m) return null;
  return { scene: raw, memberId: m[1] === 'm' ? Number(m[2]) : null, referrerId: m[1] === 'r' ? Number(m[2]) : null };
}

// 归属：二维码带推荐人（r）→ 该推荐人；带登录会员（m）→ 该会员已绑定的推荐人；都没有 → 不动（不默认官方直属）
function sceneAttribution(parsed: NonNullable<ReturnType<typeof parseStoreApplyScene>>) {
  if (parsed.referrerId && referralOwnerForAttribution(parsed.referrerId)) {
    return { referrerId: parsed.referrerId, note: `门店申请码：推荐人会员 ${parsed.referrerId}（二维码参数）` };
  }
  if (parsed.memberId) {
    const user = findLocalCnUserById(parsed.memberId);
    if (user?.referredByMemberId) return { referrerId: user.referredByMemberId, note: `门店申请码：网页登录会员 #${parsed.memberId} 生成，其推荐人会员 ${user.referredByMemberId}` };
  }
  return null;
}

async function sendTemplate(openid: string, deadline: number, allowPassive: boolean) {
  const { message } = appendKefuMessage(openid, { role: 'ai', type: 'text', text: STORE_APPLY_TEMPLATE, tag: 'store_apply_template', delivery: 'none' });
  if (isSimulatedOpenid(openid)) {
    setKefuMessageDelivery(openid, message.id, 'simulated');
    return { ok: true as const, passive: null as string | null };
  }
  const send = sendMpCustomText(openid, STORE_APPLY_TEMPLATE).then((r) => {
    setKefuMessageDelivery(openid, message.id, r.ok ? 'custom' : 'failed', r.ok ? undefined : String(r.errcode));
    return r;
  });
  const ms = Math.max(0, deadline - Date.now());
  const r = await Promise.race([send, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
  // 客服消息发送失败（未超时）时，改用被动回复送出同一份模板，保证客人一定收到
  if (r && !r.ok && !allowPassive) return { ok: false as const, passive: null as string | null };
  if (r && !r.ok && allowPassive) {
    setKefuMessageDelivery(openid, message.id, 'passive', String(r.errcode));
    return { ok: false as const, passive: STORE_APPLY_TEMPLATE };
  }
  return { ok: true as const, passive: null as string | null };
}

// 扫码事件（subscribe / SCAN）或网页按钮触发：开启门店申请收集并发送模板。返回被动回复文字（通常为 null）。
export async function startStoreApply(openid: string, eventKey: string, via: 'subscribe' | 'scan' | 'web_button', deadline: number) {
  const parsed = parseStoreApplyScene(eventKey);
  if (!parsed) return null;
  const attr = sceneAttribution(parsed);
  updateKefuConversation(openid, (c) => {
    c.storeApply = { status: 'collecting', scene: parsed.scene, via, referrerId: attr?.referrerId || null, startedAt: new Date().toISOString(), asks: 0, fields: {} };
    if (!c.tags.includes('store_apply')) c.tags.push('store_apply');
    if (!c.source) c.source = parsed.scene.slice(0, 64);
    if (attr && (c.attribution.status === 'none' || c.attribution.status === 'asked')) c.attribution = { status: 'known', note: attr.note };
  });
  appendKefuMessage(openid, { role: 'system', type: 'event', text: `门店申请${via === 'subscribe' ? '扫码关注' : via === 'scan' ? '扫码（已关注）' : '网页按钮'}（${parsed.scene}），已发送申请问题模板` });
  const r = await sendTemplate(openid, deadline, via !== 'web_button');
  return r.passive;
}

function segmentsOf(text: string) {
  return text
    .split(/[\n，,；;。]+/)
    .map((s) => s.replace(/^\s*(?:\d{1,2}|[一二三四五六])\s*[.、)）．]\s*/, '').trim())
    .filter(Boolean);
}

const RE_STORE_WORD = /(店|馆|院|会所|中心|工作室|堂|驿站|站|公司|门诊|诊所|药房|超市|俱乐部|空间|社区|酒店|养老)/;
const RE_AREA = /(\d+(?:\.\d+)?|[一二三四五六七八九十百千两]+)\s*(?:平方米|平米|平方|㎡|m²|m2|平)/i;
const RE_CONTACT_SUFFIX = /(?<![\u4e00-\u9fa5])([\u4e00-\u9fa5]{1,3}?(?:先生|女士|小姐|老师|总|经理|老板))(?![\u4e00-\u9fa5])/;

export function parseStoreApplyText(raw: string, cities: string[]) {
  const text = kefuToSimplified(String(raw || ''));
  const out: Partial<KefuStoreApply['fields']> = {};
  const digits = text.replace(/[ \t\u3000-]/g, ''); // 保留换行，避免编号（如「5.」）粘到手机号后面
  const phone = digits.match(RE_MOBILE)?.[0];
  if (phone) out.phone = phone;

  const modes: string[] = [];
  if (/投放/.test(text)) modes.push('投放合作');
  if (/(购机|买机|购买(?:机器|设备)|买(?:一台|台|设备|机器)|采购)/.test(text)) modes.push('购机');
  if (/了解/.test(text)) modes.push('了解一下');
  if (modes.length) out.mode = modes.join('／');

  const area = text.match(RE_AREA);
  if (area) out.area = `${area[1]}平方米`;

  for (const seg0 of segmentsOf(text)) {
    let seg = seg0;
    const label = seg.match(/^(所在城市|城市|门店名称与类型|门店名称和类型|门店名称|名称|店名|门店类型|类型|门店面积|面积|联系人称呼|联系人|称呼|手机号|手机|电话|合作方式|想合作的方式|方式)\s*[:：]?\s*/);
    const key = label?.[1] || '';
    if (label) seg = seg.slice(label[0].length).trim();
    const segNoPhone = seg.replace(/1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}/g, '').replace(/\d{3,}/g, '').trim();
    if (!seg) continue;
    if (/城市/.test(key)) { out.city = seg.slice(0, 20); continue; }
    if (/面积/.test(key)) { out.area = out.area || seg.slice(0, 20); continue; }
    if (/方式/.test(key)) { out.mode = out.mode || seg.slice(0, 20); continue; }
    if (/联系人|称呼/.test(key)) { if (segNoPhone) out.contact = segNoPhone.slice(0, 12); continue; }
    if (/名称|店名|类型/.test(key)) { out.store = (out.store && key.includes('类型') && !key.includes('名称') ? `${out.store}（${seg}）` : seg).slice(0, 40); continue; }
    if (/手机|电话/.test(key)) continue;

    // 无标签：逐段判断
    const city = cities.find((x) => seg === x || seg === `${x}市`) || seg.match(/^(?:我在)?([\u4e00-\u9fa5]{2,4}?)市$/)?.[1];
    if (city && !out.city) { out.city = city; continue; }
    const contact = segNoPhone.match(/^(?:我是|我叫|我姓|姓)?([\u4e00-\u9fa5]{1,3}?(?:先生|女士|小姐|老师|总|经理|老板))$/)?.[1] || segNoPhone.match(RE_CONTACT_SUFFIX)?.[1];
    if (contact && !out.contact) { out.contact = contact; if (segNoPhone.replace(contact, '').replace(/^(我是|我叫|我姓|姓|联系人)/, '').trim() === '') continue; }
    if (!out.contact && phone && seg.includes(phone.slice(0, 3)) && /^[\u4e00-\u9fa5]{1,4}$/.test(segNoPhone)) { out.contact = segNoPhone; continue; }
    if (!out.store && RE_STORE_WORD.test(segNoPhone) && !RE_AREA.test(segNoPhone) && segNoPhone.length >= 2 && !/^(投放|购机|了解)/.test(segNoPhone)) {
      out.store = segNoPhone.replace(/^(门店是|店名是|店叫|我们是|我们店是|我开的是|我家是)/, '').slice(0, 40);
      continue;
    }
  }
  if (!out.city) {
    const city = cities.find((x) => text.includes(x)) || text.match(/我在([\u4e00-\u9fa5]{2,4}?)(?:市|这边|附近|开|有|[，,。\s]|$)/)?.[1];
    if (city) out.city = city;
  }
  return out;
}

function missingOf(fields: KefuStoreApply['fields']) {
  return FIELD_ORDER.filter((k) => !fields[k]);
}

function summaryLines(f: KefuStoreApply['fields']) {
  return [
    `城市：${f.city || '未提供'}`,
    `门店：${f.store || '未提供'}`,
    `面积：${f.area || '未提供'}`,
    `联系人：${f.contact || '未提供'}`,
    `手机：${f.phone || '未提供'}`,
    `合作方式：${f.mode || '未提供'}`,
  ];
}

function passive(openid: string, text: string, tag: string) {
  appendKefuMessage(openid, { role: 'ai', type: 'text', text, tag, delivery: 'passive' });
  return text;
}

function submit(openid: string, userText: string, correction: boolean) {
  const conv = updateKefuConversation(openid, (c) => {
    if (!c.storeApply) return;
    c.storeApply.status = 'submitted';
    c.storeApply.submittedAt = new Date().toISOString();
  });
  const sa = conv.storeApply!;
  const f = sa.fields;
  const ref = sa.referrerId ? `推荐人会员 ${sa.referrerId}` : '来源待确认';
  const detail = `${f.city || '城市未填'} ${f.phone || '手机未填'}｜门店：${f.store || '未填'}｜面积：${f.area || '未填'}｜联系人：${f.contact || '未填'}｜方式：${f.mode || '未填'}｜${ref}`;
  appendKefuMessage(openid, { role: 'system', type: 'store_apply', tag: correction ? 'store_apply_update' : 'store_apply', text: `门店申请${correction ? '（更正/补充）' : ''}：${summaryLines(f).join('；')}；${ref}；二维码 ${sa.scene}` });
  appendKefuMessage(openid, { role: 'system', type: 'lead_notify', tag: `store_apply:${f.phone || 'nophone'}`, text: `已通知客服：门店申请（${detail}）` });
  const fresh = getKefuConversation(openid);
  if (fresh) notifyKefuHandoff(fresh, correction ? '门店申请更正（服务号扫码）' : '门店申请（服务号扫码）', userText, { force: true, detail }).catch(() => console.warn('[wechat-kefu] store apply notify error'));
}

// 会话处于门店申请收集中时处理客人文字；返回 null 表示交回原有客服流程（例如客人改问其他问题、要人工）
export function continueStoreApply(openid: string, text: string, opts: { cities: string[]; human: boolean }): string | null {
  const conv = getKefuConversation(openid);
  const sa = conv?.storeApply;
  if (!sa || opts.human) return null;
  const now = Date.now();
  const collecting = sa.status === 'collecting' && now - Date.parse(sa.startedAt) < COLLECT_MS;
  const correcting = sa.status === 'submitted' && sa.submittedAt && now - Date.parse(sa.submittedAt) < CORRECT_MS;
  if (!collecting && !correcting) return null;

  const parsed = parseStoreApplyText(text, opts.cities);
  const gotAny = Object.keys(parsed).length > 0;
  const simple = kefuToSimplified(text);
  if (!gotAny && RE_QUESTION.test(simple)) return null; // 客人在问别的问题，交给原流程回答，收集状态保留
  if (correcting) {
    if (!gotAny || RE_QUESTION.test(simple)) return null;
    updateKefuConversation(openid, (c) => { if (c.storeApply) c.storeApply.fields = { ...c.storeApply.fields, ...parsed }; });
    submit(openid, text, true);
    return passive(openid, `已更新您的门店申请信息：\n${summaryLines(getKefuConversation(openid)!.storeApply!.fields).join('\n')}\n已同步给客服同事。`, 'store_apply_done');
  }

  const unsure = /(不清楚|不确定|不知道|还没定|待定|暂时没有|没想好)/.test(simple);
  const updated = updateKefuConversation(openid, (c) => {
    if (!c.storeApply) return;
    const before = missingOf(c.storeApply.fields);
    c.storeApply.fields = { ...c.storeApply.fields, ...parsed };
    // 客人对上一轮追问的项表示「不确定」：记为待定，不再反复追问
    if (unsure && c.storeApply.asks > 0) {
      for (const k of before) if (!c.storeApply.fields[k] && (k === 'area' || k === 'mode' || k === 'store')) c.storeApply.fields[k] = '待定';
    }
  });
  const fields = updated.storeApply!.fields;
  const missing = missingOf(fields);
  const asks = updated.storeApply!.asks;
  // 齐全就提交；追问过两轮后，只要有手机号就先提交，缺的项由客服电话补问
  if (missing.length === 0 || (asks >= 2 && fields.phone)) {
    submit(openid, text, false);
    return passive(openid, `已收到您的门店申请：\n${summaryLines(fields).join('\n')}\n已转给客服同事，会尽快与您联系。信息有误的话直接回复更正即可。`, 'store_apply_done');
  }
  updateKefuConversation(openid, (c) => { if (c.storeApply) c.storeApply.asks += 1; });
  const head = gotAny ? '收到，谢谢！还差：' : '麻烦补充以下信息（一条消息写完即可）：';
  return passive(openid, `${head}\n${missing.map((k) => `· ${FIELD_LABELS[k]}`).join('\n')}`, 'store_apply_ask');
}

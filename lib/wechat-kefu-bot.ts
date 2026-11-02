import { listLocalCnUsers } from '@/lib/local-cn-users';
import {
  appendKefuMessage,
  claimKefuMessageKey,
  getKefuConversation,
  setKefuMessageDelivery,
  setKefuProcessedPassive,
  updateKefuConversation,
  type KefuConversation,
} from '@/lib/local-cn-wechat-kefu';
import {
  KEFU_ATTRIBUTION_QUESTION,
  KEFU_GREETING,
  KEFU_HANDOFF_REPLY,
  KEFU_HEALTH_BAD_HOST,
  KEFU_HEALTH_BAD_TITLE,
  KEFU_HEALTH_HOSPITAL_SITE,
  KEFU_MEDIA_REPLY,
  KEFU_NOT_MEDICAL,
  KEFU_PHONE,
  KEFU_SEE_DOCTOR,
  KEFU_SYSTEM_PROMPT,
  KEFU_WELCOME,
  isAllowedHealthUrl,
  type KefuDocKey,
  kefuApplyReply,
  kefuBlockedTerm,
  kefuCuratedHealthLinks,
  kefuDocsReply,
  kefuSafetyReply,
  kefuSymptomKeyword,
  kefuTierReply,
  kefuTitleMatches,
  kefuToSimplified,
} from '@/lib/wechat-kefu-knowledge';
import { isSimulatedOpenid, notifyKefuHandoff } from '@/lib/wechat-kefu-notify';
import { sendMpCustomText } from '@/lib/wechat-mp-api';

// 服务号 AI 客服主流程：规则优先 → 症状只给权威科普链接 → 千问回答 → 不确定就转人工。

const PAUSE_MS = 12 * 60 * 60 * 1000;
const AI_CALLS_PER_HOUR = 20;
const inflight = new Map<string, Promise<string | null>>();

const RE_HUMAN = /(人工|真人|转接|找客服|联系客服|客服在吗|投诉|退款|退货|退钱|赔偿|维权|合同|发票|开票|付款失败|支付失败|扣款|重复扣|没收到|骗)/;
const RE_GREETING = /^(您好|你好|hello|hi|嗨|哈喽|在吗|在不在|有人吗|有人在吗|在么|你好呀|您好呀)+$/i;
const RE_SUITABILITY = /(能用吗|可以用吗|能不能用|可不可以用|适合用|适不适合|禁忌|注意事项|注意什么|哪些人不能)/;
const RE_SYMPTOM = /(症状|疼|痛|酸|麻|晕|失眠|睡不着|睡不好|发烧|发热|咳|喘|胸闷|心慌|心悸|血压|血糖|血脂|糖尿病|肿瘤|癌|炎|结节|便秘|腹泻|拉肚子|过敏|湿疹|月经|痛经|乏力|疲劳|怕冷|手脚冰凉|不舒服|难受|生病|疾病|病|能治|治疗|治好|吃什么药|用药|药)/;
const RE_DOCS = /(保险|保单|责任险|使用说明|说明书|使用手册|检测报告|检验报告|测试报告|资质|证书|证照|认证|波长|(?<![A-Za-z])(?:CE|EMC|CNAS)(?![A-Za-z]))/i;
const RE_APPLY = /(怎么申请|如何申请|怎样申请|想申请|要申请|申请机器|申请设备|申请合作|申请流程|申请条件|怎么合作|如何合作|想合作|要合作|加盟|投放机器|怎么拿到机器|想要机器|要台机器)/;
const RE_PRICE = /(多少钱|价格|价钱|费用|收费|次卡|几档|报价|怎么收费)/;
const RE_BUSINESS = /(合作|加盟|申请|代理|次卡|开店|门店|投放|多少钱|价格|费用|购买|买|入驻|机器)/;
// 线索：客人留大陆手机号，或明确想到店体验／找门店／预约 → 通知客服（不暂停 AI）
const RE_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const RE_VISIT = /(要去体验|想去体验|想体验|要体验|去体验|哪里体验|哪里可以体验|哪里能体验|哪能体验|哪儿体验|在哪体验|在哪里体验|去哪体验|门店在哪|店在哪|哪里有门店|哪有门店|哪里有店|有没有门店|附近门店|附近的门店|最近的门店|体验店|预约)/;
const LEAD_THROTTLE_MS = 30 * 60 * 1000;
const KEFU_CITIES = '北京 上海 天津 重庆 广州 深圳 苏州 杭州 南京 无锡 常州 南通 扬州 镇江 徐州 盐城 泰州 淮安 连云港 宿迁 昆山 常熟 张家港 太仓 江阴 宜兴 宁波 温州 嘉兴 湖州 绍兴 金华 义乌 台州 舟山 丽水 衢州 合肥 芜湖 福州 厦门 泉州 漳州 莆田 平潭 济南 青岛 烟台 潍坊 临沂 郑州 洛阳 武汉 长沙 南昌 成都 西安 昆明 贵阳 南宁 海口 三亚 石家庄 太原 呼和浩特 沈阳 大连 长春 哈尔滨 兰州 西宁 银川 乌鲁木齐 拉萨 东莞 佛山 珠海 中山 惠州 汕头'.split(' ');

function clean(text: string) {
  return String(text || '').replace(/[\s，,。.!！?？~～、]+/g, '');
}

function linkMember(conv: KefuConversation) {
  if (conv.memberId !== undefined) return;
  const user = listLocalCnUsers().find((u) => u.wechatOfficialOpenId && u.wechatOfficialOpenId === conv.openid);
  conv.memberId = user ? user.id : null;
  conv.memberName = user ? user.name || null : null;
  if (user && user.referredByMemberId && conv.attribution.status === 'none') {
    conv.attribution = { status: 'known', note: `会员已绑定推荐人 ${user.referredByMemberId}` };
  }
}

async function deliverAsync(openid: string, text: string, tag: string) {
  text = phoneOnce(openid, text);
  const { message } = appendKefuMessage(openid, { role: 'ai', type: 'text', text, tag, delivery: 'none' });
  if (isSimulatedOpenid(openid)) {
    setKefuMessageDelivery(openid, message.id, 'simulated');
    return;
  }
  const r = await sendMpCustomText(openid, text);
  setKefuMessageDelivery(openid, message.id, r.ok ? 'custom' : 'failed', r.ok ? undefined : String(r.errcode));
}

// 客服电话每段对话最多主动提一次：之前的 AI 回复里已给过电话，就把含电话的分句去掉
function phoneOnce(openid: string, text: string) {
  if (!text.includes(KEFU_PHONE)) return text;
  const conv = getKefuConversation(openid);
  if (!conv?.messages.some((m) => m.role === 'ai' && m.text.includes(KEFU_PHONE))) return text;
  const clause = new RegExp(`[，,；;]?[^，,；;。！!？?\\n]*${KEFU_PHONE}[^，,；;。！!？?\\n]*`, 'g');
  return text
    .split('\n')
    .flatMap((line) => {
      if (!line.includes(KEFU_PHONE)) return [line];
      const out = line.replace(clause, '').replace(/([。！？!?])[。！？!?，,；;]+/g, '$1').replace(/^[，,；;。！!？?\s]+/, '').trim();
      return out ? [out] : [];
    })
    .join('\n');
}

function leadInfo(openid: string, simple: string) {
  const conv = getKefuConversation(openid);
  const texts = [simple, ...(conv?.messages || []).filter((m) => m.role === 'user' && m.type === 'text').slice(-8).reverse().map((m) => kefuToSimplified(m.text))];
  const digits = (t: string) => t.replace(/[\s-]/g, '');
  const phoneNow = digits(simple).match(RE_MOBILE)?.[0] || '';
  const phone = phoneNow || texts.map((t) => digits(t).match(RE_MOBILE)?.[0]).find(Boolean) || '';
  let city = '';
  for (const t of texts) {
    city = KEFU_CITIES.find((x) => t.includes(x)) || t.match(/我在([\u4e00-\u9fa5]{2,4}?)(?:市|这边|附近|要|想|的|[，,。\s]|$)/)?.[1] || '';
    if (city) break;
  }
  return { phone, phoneNow, city };
}

// 线索通知：同一对话同一线索 30 分钟内只通知一次；always＝来源待核对等一次性事件，必发
function notifyLead(openid: string, simple: string, text: string, reason: string, always = false) {
  const { phone, city } = leadInfo(openid, simple);
  const key = phone ? `lead:${phone}` : 'lead:visit';
  const conv = getKefuConversation(openid);
  if (!conv) return;
  const last = [...conv.messages].reverse().find((m) => m.role === 'system' && m.type === 'lead_notify' && m.tag === key);
  if (!always && last && Date.now() - Date.parse(last.at) < LEAD_THROTTLE_MS) return;
  const detail = `城市：${city || '未提供'}；手机：${phone || '未提供'}`;
  appendKefuMessage(openid, { role: 'system', type: 'lead_notify', tag: key, text: `已通知客服：${reason}（${detail}）` });
  const fresh = getKefuConversation(openid);
  if (fresh) notifyKefuHandoff(fresh, reason, text, { force: true, detail }).catch(() => console.warn('[wechat-kefu] lead notify error'));
}

function leadReply(phone: string, city: string) {
  if (phone) return `已收到您的联系方式，已转给客服同事，会尽快与您联系，帮您安排${city ? `${city}的` : '就近'}体验。`;
  if (city) return `好的，麻烦留一下您的手机号，客服同事会尽快联系您，帮您安排${city}的体验。`;
  return '想到店体验的话，麻烦留言您的城市和手机号（例如：苏州 138xxxxxxxx），客服同事会尽快联系您安排。';
}

function passive(openid: string, text: string, tag: string) {
  text = phoneOnce(openid, text);
  appendKefuMessage(openid, { role: 'ai', type: 'text', text, tag, delivery: 'passive' });
  return text;
}

function handoff(openid: string, reason: string, userText: string, pause: boolean) {
  const conv = updateKefuConversation(openid, (c) => {
    c.status = 'pending';
    c.handoffReason = reason;
    c.pausedUntil = pause ? new Date(Date.now() + PAUSE_MS).toISOString() : null;
    if (!c.tags.includes('handoff')) c.tags.push('handoff');
  });
  notifyKefuHandoff(conv, reason, userText).catch(() => console.warn('[wechat-kefu] notify error'));
}

function withAttribution(openid: string, text: string, userText: string) {
  const conv = getKefuConversation(openid);
  if (!conv || conv.attribution.status !== 'none' || !RE_BUSINESS.test(userText)) return text;
  updateKefuConversation(openid, (c) => {
    c.attribution = { status: 'asked', askedAt: new Date().toISOString() };
  });
  return `${text}\n\n${KEFU_ATTRIBUTION_QUESTION}`;
}

function dashscopeKey() {
  return String(process.env.DASHSCOPE_API_KEY || '').trim();
}

async function askQwen(conv: KefuConversation | null, userText: string, retryHint?: string): Promise<string | null> {
  const key = dashscopeKey();
  if (!key) return null;
  const base = String(process.env.DASHSCOPE_TEXT_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const history = (conv?.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'ai' || m.role === 'admin') && m.type === 'text')
    .slice(-7, -1)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, 500) }));
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.KEFU_AI_MODEL || 'qwen-plus',
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role: 'system', content: KEFU_SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: userText.slice(0, 500) },
          ...(retryHint ? [{ role: 'system', content: retryHint }] : []),
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    const content = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      console.warn('[wechat-kefu] qwen empty status=', res.status);
      return null;
    }
    return content;
  } catch {
    console.warn('[wechat-kefu] qwen request error');
    return null;
  }
}

type HealthLink = { title: string; source: string; url: string };

function cleanTitle(raw: string) {
  return String(raw || '')
    .replace(/【官方编[码号][:：]?\d+】/g, '')
    .split(/\s+[-|_]\s+|_/)[0]
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

// 症状关键词 + 「科普」联网搜索，只留权威来源、标题对题的科普文章（不要发布会实录、政策通知、广告）
async function searchHealthLinks(keyword: string): Promise<HealthLink[]> {
  const key = dashscopeKey();
  if (!key || !keyword) return [];
  const base = String(process.env.DASHSCOPE_NATIVE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/$/, '');
  const queries = [`${keyword} 科普`, `${keyword} 健康科普 医院`, `${keyword} 健康科普 卫生健康委`];
  const run = async (q: string) => {
    try {
      const res = await fetch(`${base}/services/aigc/text-generation/generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.KEFU_AI_MODEL || 'qwen-plus',
          input: { messages: [{ role: 'system', content: '只输出一个字：好' }, { role: 'user', content: q }] },
          parameters: {
            result_format: 'message',
            max_tokens: 5,
            enable_search: true,
            search_options: { forced_search: true, enable_source: true, search_strategy: 'turbo' },
          },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => ({}));
      const rows = data?.output?.search_info?.search_results;
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };
  const all = (await Promise.all(queries.map(run))).flat();
  const seen = new Set<string>();
  const ranked: Array<HealthLink & { rank: number }> = [];
  for (const r of all) {
    const url = String(r?.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    let host = '';
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      host = u.hostname.toLowerCase();
    } catch {
      continue;
    }
    const site = String(r?.site_name || '').trim();
    const rawTitle = String(r?.title || '');
    const whitelisted = isAllowedHealthUrl(url);
    const hospital = !KEFU_HEALTH_BAD_HOST.test(host) && KEFU_HEALTH_HOSPITAL_SITE.test(site);
    if (!whitelisted && !hospital) continue;
    if (KEFU_HEALTH_BAD_TITLE.test(rawTitle)) continue;
    const title = cleanTitle(rawTitle);
    if (!title || !kefuTitleMatches(title, keyword)) continue;
    const kepu = /(jkkp|kepu|kpzs|kpxc|\/kp\/)/i.test(url) || /科普/.test(rawTitle);
    ranked.push({ title, source: site && site !== '无' ? site.slice(0, 20) : host, url, rank: (whitelisted ? 0 : 2) + (kepu ? 0 : 1) });
  }
  return ranked
    .sort((x, y) => x.rank - y.rank)
    .slice(0, 3)
    .map(({ title, source, url }) => ({ title, source, url }));
}

function healthReply(keyword: string, found: HealthLink[]) {
  const links = [...found];
  if (links.length < 2) {
    for (const c of kefuCuratedHealthLinks(keyword)) {
      if (links.length >= 2) break;
      if (!links.some((l) => l.url === c.url)) links.push(c);
    }
  }
  const topic = keyword ? `关于「${keyword}」，` : '';
  if (!links.length) {
    return [
      `${topic}这类身体状况我们不做判断。暂时没找到与此直接相关的权威科普文章，建议到正规医院相关科室咨询。`,
      `${KEFU_SEE_DOCTOR}。`,
      KEFU_NOT_MEDICAL,
    ].join('\n');
  }
  return [
    `${topic}这类身体状况我们不做判断。以下是权威机构公开的科普文章，请点开阅读：`,
    ...links.map((l, i) => `${i + 1}. ${l.title}（${l.source}）\n${l.url}`),
    `${KEFU_SEE_DOCTOR}。`,
    KEFU_NOT_MEDICAL,
  ].join('\n');
}

function aiCallAllowed(openid: string) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  let allowed = false;
  updateKefuConversation(openid, (c) => {
    c.aiCalls = (c.aiCalls || []).filter((t) => Date.parse(t) > hourAgo);
    if (c.aiCalls.length < AI_CALLS_PER_HOUR) {
      c.aiCalls.push(new Date().toISOString());
      allowed = true;
    }
  });
  return allowed;
}

function raceDeadline<T>(p: Promise<T>, deadline: number): Promise<{ done: true; value: T } | { done: false }> {
  const ms = Math.max(0, deadline - Date.now());
  return Promise.race([
    p.then((value) => ({ done: true as const, value })),
    new Promise<{ done: false }>((resolve) => setTimeout(() => resolve({ done: false }), ms)),
  ]);
}

async function handleText(openid: string, text: string, deadline: number): Promise<string | null> {
  let conv = getKefuConversation(openid);
  const simple = kefuToSimplified(text);
  const c = clean(simple);
  if (conv?.status === 'closed') conv = updateKefuConversation(openid, (x) => { x.status = 'ai'; });

  if (conv && (conv.status === 'pending' || conv.status === 'human') && conv.pausedUntil && Date.parse(conv.pausedUntil) > Date.now()) {
    const fresh = getKefuConversation(openid);
    if (fresh) notifyKefuHandoff(fresh, '人工处理中，客人继续留言', text).catch(() => undefined);
    return null;
  }

  if (conv?.attribution.status === 'asked' && !RE_HUMAN.test(simple) && !RE_VISIT.test(simple) && !RE_MOBILE.test(text.replace(/[\s-]/g, '')) && !/[?？吗呢]$/.test(text.trim()) && c.length <= 60) {
    updateKefuConversation(openid, (x) => {
      x.attribution = { ...x.attribution, status: 'pending_review', answer: text.slice(0, 200) };
      if (!x.tags.includes('attribution')) x.tags.push('attribution');
    });
    notifyLead(openid, simple, text, `客人回答来源（待核对）：${text.slice(0, 30)}`, true);
    return passive(openid, '谢谢您，已记录，客服同事会核对后与您联系。还有其他问题可以继续问我。', 'attribution');
  }

  const lead = leadInfo(openid, simple);
  const wantsVisit = RE_VISIT.test(simple);
  if (lead.phoneNow || wantsVisit) notifyLead(openid, simple, text, lead.phone ? '客人留电话/想体验' : '客人想体验/找门店');

  if (RE_HUMAN.test(simple)) {
    handoff(openid, '客人要求人工 / 售后纠纷', text, true);
    return passive(openid, KEFU_HANDOFF_REPLY, 'handoff');
  }

  if (RE_GREETING.test(c)) return passive(openid, KEFU_GREETING, 'greeting');

  if (RE_DOCS.test(simple)) {
    const keys: KefuDocKey[] = [];
    if (/(保险|保单|责任险)/.test(simple)) keys.push('insurance', 'insurancePolicy');
    if (/(使用说明|说明书|使用手册)/.test(simple)) keys.push('usage');
    if (/(检测报告|检验报告|测试报告|波长|(?<![A-Za-z])CNAS(?![A-Za-z]))/i.test(simple)) keys.push('wavelength', 'emc');
    if (/(?<![A-Za-z])(?:CE|EMC)(?![A-Za-z])/i.test(simple)) keys.push('emc');
    if (/(资质|证书|证照|认证)/.test(simple)) keys.push('emc', 'wavelength', 'insurance', 'insurancePolicy');
    return passive(openid, kefuDocsReply(keys), 'docs');
  }

  if (RE_SUITABILITY.test(simple)) return passive(openid, kefuSafetyReply(), 'safety');

  if (RE_SYMPTOM.test(simple)) {
    updateKefuConversation(openid, (x) => {
      if (!x.tags.includes('health')) x.tags.push('health');
    });
    const task = (async () => {
      const keyword = kefuSymptomKeyword(text);
      const links = aiCallAllowed(openid) ? await searchHealthLinks(keyword) : [];
      return healthReply(keyword, links);
    })();
    const r = await raceDeadline(task, deadline);
    if (r.done) return passive(openid, r.value, 'health');
    task.then((reply) => deliverAsync(openid, reply, 'health')).catch(() => console.warn('[wechat-kefu] health async error'));
    return passive(openid, `这类身体状况的问题，我们不做判断。正在为您查找卫健委等权威机构的公开科普资料，稍后发给您。\n${KEFU_SEE_DOCTOR}。`, 'health_ack');
  }

  if (lead.phoneNow || wantsVisit) return passive(openid, leadReply(lead.phone, lead.city), 'lead');

  if (RE_APPLY.test(simple)) return passive(openid, withAttribution(openid, kefuApplyReply(), simple), 'apply');

  if (RE_PRICE.test(simple)) return passive(openid, withAttribution(openid, kefuTierReply(), simple), 'price');

  if (!dashscopeKey() || !aiCallAllowed(openid)) {
    handoff(openid, dashscopeKey() ? 'AI 调用次数超限' : 'AI 未配置', text, false);
    return passive(openid, KEFU_HANDOFF_REPLY, 'handoff');
  }

  const task = (async () => {
    let answer = await askQwen(getKefuConversation(openid), text);
    let blocked = answer && !answer.includes('[[转人工]]') ? kefuBlockedTerm(answer) : null;
    if (answer && blocked) {
      // 被合规拦截：留存草稿供后台查看，提示换说法后重试一次
      console.warn('[wechat-kefu] ai reply blocked, term=', blocked, '; retrying once');
      appendKefuMessage(openid, { role: 'system', type: 'ai_blocked', text: `AI 草稿被合规拦截（命中「${blocked}」），已自动重写：${answer.slice(0, 400)}` });
      answer = await askQwen(
        getKefuConversation(openid),
        text,
        `你上一版回答里出现了不允许的词「${blocked}」。请重新回答客人的同一个问题，不要出现「${blocked}」以及治疗、治愈、疗效、诊断、康复、疗程、药效等词（否定句也不要写），改用「频率养生」「调理」「康养」「放松体验」等说法；仍按资料回答，不超过 150 字。`,
      );
      blocked = answer && !answer.includes('[[转人工]]') ? kefuBlockedTerm(answer) : null;
      if (answer && blocked) {
        console.warn('[wechat-kefu] ai retry still blocked, term=', blocked);
        appendKefuMessage(openid, { role: 'system', type: 'ai_blocked', text: `AI 重写仍被合规拦截（命中「${blocked}」）：${answer.slice(0, 400)}` });
      }
    }
    if (!answer || answer.includes('[[转人工]]') || blocked) {
      handoff(openid, !answer ? 'AI 无回应' : answer.includes('[[转人工]]') ? 'AI 无把握' : 'AI 回答被合规拦截', text, false);
      return { text: KEFU_HANDOFF_REPLY, tag: 'handoff' };
    }
    return { text: withAttribution(openid, answer.replace(/\*\*/g, ''), simple), tag: 'ai' };
  })();
  const r = await raceDeadline(task, deadline);
  if (r.done) return passive(openid, r.value.text, r.value.tag);
  task.then((v) => deliverAsync(openid, v.text, v.tag)).catch(() => console.warn('[wechat-kefu] ai async error'));
  return null;
}

async function processMessage(msg: Record<string, string>, deadline: number): Promise<string | null> {
  const openid = msg.FromUserName;
  const type = (msg.MsgType || '').toLowerCase();

  if (type === 'event') {
    const event = (msg.Event || '').toLowerCase();
    if (event === 'subscribe') {
      updateKefuConversation(openid, (c) => {
        linkMember(c);
        c.subscribed = true;
        if (msg.EventKey) c.source = String(msg.EventKey).replace(/^qrscene_/, '').slice(0, 64);
      });
      appendKefuMessage(openid, { role: 'system', type: 'event', text: `关注${msg.EventKey ? `（来源：${String(msg.EventKey).replace(/^qrscene_/, '')}）` : ''}` });
      return passive(openid, KEFU_WELCOME, 'welcome');
    }
    if (event === 'unsubscribe') {
      if (getKefuConversation(openid)) {
        updateKefuConversation(openid, (c) => { c.subscribed = false; });
        appendKefuMessage(openid, { role: 'system', type: 'event', text: '取消关注' });
      }
      return null;
    }
    return null;
  }

  let text = '';
  if (type === 'text') text = String(msg.Content || '');
  else if (type === 'voice' && msg.Recognition) text = String(msg.Recognition);

  if (text) {
    appendKefuMessage(openid, { role: 'user', type, text: text.slice(0, 2000), msgKey: msg.MsgId }, linkMember);
    return handleText(openid, text, deadline);
  }

  const label: Record<string, string> = { image: '[图片]', voice: '[语音]', video: '[视频]', shortvideo: '[小视频]', location: '[位置]', link: '[链接]', file: '[文件]' };
  const placeholder = `${label[type] || `[${type || '未知'}]`}${msg.PicUrl ? ` ${msg.PicUrl}` : ''}${msg.Label ? ` ${msg.Label}` : ''}${msg.Url ? ` ${msg.Url}` : ''}`;
  appendKefuMessage(openid, { role: 'user', type: type || 'unknown', text: placeholder.slice(0, 500), msgKey: msg.MsgId }, linkMember);
  handoff(openid, '客人发送了非文字消息', placeholder, false);
  return passive(openid, KEFU_MEDIA_REPLY, 'media');
}

// 返回被动回复的文字（null 表示回 success）。重复推送（微信 5 秒未收到回应会重试）只处理一次。
export async function handleKefuInbound(msg: Record<string, string>, deadline: number): Promise<string | null> {
  const openid = msg.FromUserName;
  if (!openid) return null;
  const key = `${openid}:${msg.MsgId || `${msg.CreateTime}:${msg.Event || ''}`}`;

  const running = inflight.get(key);
  if (running) {
    const r = await raceDeadline(running, deadline);
    return r.done ? r.value : null;
  }
  const existing = claimKefuMessageKey(key);
  if (existing) return existing.passive || null;

  const task = processMessage(msg, deadline).catch(() => {
    console.warn('[wechat-kefu] process error');
    return null;
  });
  inflight.set(key, task);
  try {
    const reply = await task;
    setKefuProcessedPassive(key, reply);
    return reply;
  } finally {
    setTimeout(() => inflight.delete(key), 60_000);
  }
}

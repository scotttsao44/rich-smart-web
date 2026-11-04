import { listLocalCnOrders } from '@/lib/local-cn-orders';
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
  KEFU_NOT_MEDICAL,
  KEFU_PHONE,
  KEFU_SEE_DOCTOR,
  KEFU_SYSTEM_PROMPT,
  KEFU_WELCOME,
  isAllowedHealthUrl,
  type KefuDocKey,
  kefuAfterSaleReply,
  KEFU_RETURN_POLICY,
  KEFU_ORDERS_URL,
  kefuSharedDeviceReply,
  kefuApplyReply,
  kefuBlockedTerm,
  kefuCuratedHealthLinks,
  kefuDocsReply,
  kefuOrderReply,
  kefuSafetyReply,
  kefuSymptomKeyword,
  kefuTierReply,
  kefuTitleMatches,
  kefuToSimplified,
  kefuNormalize,
  kefuMainlandText,
  kefuSafetyAnswer,
  kefuSafetyMatch,
  kefuCompanyReply,
  kefuRepairReply,
  kefuAgencyReply,
  kefuExperiencePriceReply,
  kefuTierPickReply,
  kefuLocationReply,
  KEFU_ABUSE_REPLY,
  KEFU_PRIVACY_REPLY,
  KEFU_LOGIN_REPLY,
  KEFU_CODE_REPLY,
  KEFU_PASSWORD_REPLY,
  KEFU_PHONE_CHANGE_REPLY,
  KEFU_ACCOUNT_DELETE_REPLY,
  KEFU_INVOICE_REPLY,
  KEFU_SHIPPING_FEE_REPLY,
  KEFU_TERM_REPLY,
  KEFU_DEPOSIT_REPLY,
  kefuStoresLine,
  kefuStoresReply,
  KEFU_MEMBER_BENEFIT_REPLY,
  KEFU_REFERRAL_CODE_REPLY,
  KEFU_ADDRESS_CHANGE_REPLY,
  KEFU_BRAND_APPLY_REPLY,
  KEFU_BRAND_FEE_REPLY,
  KEFU_BRAND_REVIEW_REPLY,
  KEFU_BRAND_CONTACT_REPLY,
  KEFU_BOT_IDENTITY_REPLY,
  KEFU_BUY_MACHINE_REPLY,
  KEFU_COMPARE_REPLY,
  KEFU_COMPLAINT_REPLY,
  KEFU_CONTRACT_REPLY,
  KEFU_COVERAGE_REPLY,
  KEFU_DETECT_INTRO,
  KEFU_DISCOUNT_REPLY,
  KEFU_EARNINGS_REPLY,
  KEFU_EFFICACY_REPLY,
  KEFU_FLOW,
  KEFU_HOME_VISIT_REPLY,
  KEFU_INJECTION_REPLY,
  KEFU_INSTALL_REPLY,
  KEFU_LEAD_ASK,
  KEFU_MEDIA_ASK,
  KEFU_MEDICAL_CERT_PREFIX,
  KEFU_MEMBER_CARD_REPLY,
  KEFU_MODEL_REPLY,
  KEFU_PATENT_REPLY,
  KEFU_PER_USE_REPLY,
  KEFU_PRICE_CLARIFY,
  KEFU_PRODUCT_INTRO,
  KEFU_RADIATION_PREFIX,
  KEFU_REFERRAL_REWARD_REPLY,
  KEFU_SHOP_PRICE_REPLY,
  KEFU_SITE_REQUIREMENTS,
  KEFU_SPECS,
  KEFU_STORE_HOURS_REPLY,
  KEFU_THANKS_REPLY,
  KEFU_TRUST_REPLY,
  KEFU_UNSURE_REPLY,
} from '@/lib/wechat-kefu-knowledge';
import { isSimulatedOpenid, notifyKefuHandoff } from '@/lib/wechat-kefu-notify';
import { sendMpCustomText } from '@/lib/wechat-mp-api';
import { continueStoreApply, parseStoreApplyScene, startStoreApply, storeApplyHandoffDetail } from '@/lib/wechat-kefu-store-apply';
import { ackPendingByOpenid, handleOwnerBindScan, notifyStoreOwnersForCity, parseOwnerBindScene } from '@/lib/local-cn-store-owners';
import { setPushOptOut } from '@/lib/cn-push-schedule';

// 服务号 AI 客服主流程：规则优先 → 症状只给权威科普链接 → 千问回答 → 不确定就转人工。

const PAUSE_MS = 12 * 60 * 60 * 1000;
const AI_CALLS_PER_HOUR = 20;
const inflight = new Map<string, Promise<string | null>>();

// 只有：客人明确要人工、投诉纠纷、赔偿、合同／发票、付款失败或扣款，才转人工（暂停 AI）；其余由 AI 回答
const RE_HUMAN_ASK = /(人工(?!关节|智能)|真人客服|找真人|要真人|转接|找客服|联系客服|客服在吗|叫你们客服|让客服)/;
const RE_DISPUTE = /(投诉|赔偿|赔钱|维权|理赔|合同(?!为准)|发票|开票|付款失败|支付失败|付不了款|付款不成功|支付不成功|扣款|重复扣|多扣|扣了钱|扣钱|服务太差|服务很差|态度差|态度很差|态度太差|没人回|没人理|12315|消协|举报|曝光|报警|气死)/;
const RE_HUMAN = new RegExp(`${RE_HUMAN_ASK.source}|${RE_DISPUTE.source}`);
const RE_COMPLAINT_TONE = /(投诉|太差|很差|没人回|没人理|12315|消协|举报|曝光|气死|报警|维权)/;
const RE_IDENTITY = /(你是|您是|是不是)(真人|机器人|AI|人工智能|人还是机器)|^(真人|机器人)[吗么?？]*$/i;
const RE_INJECTION = /(忽略|无视|忘记).{0,8}(指令|规则|设定|提示)|系统提示词|提示词|prompt|扮演|角色扮演|你现在是|假装你是/i;
const RE_MODEL_Q = /(大模型|什么模型|哪家.{0,4}模型|GPT|ChatGPT|千问|通义|DeepSeek|文心)/i;
const RE_THANKS = /^(谢谢|谢了|多谢|感谢|好的谢谢|好的|好|嗯|嗯嗯|ok|知道了|明白了|收到)+$/i;
const RE_ABUSE = /(傻[XxBb逼]|sb|垃圾客服|废物|滚|智障|脑残|有病吧)/i;
const RE_CHITCHAT = /(天气|笑话|讲个故事|唱首歌|你几岁|你叫什么名字|你多大)/;
const RE_REPAIR = /(坏了|故障|没反应|不灵|不启动|启动不了|开不了机|开不了|不亮|报修|维修|次数不对|剩余次数|不出光|不升降|没声音)/;
const RE_QUESTION = /(多少|什么|怎么|咋|哪|吗|呢|么|几|多久|多长|回本|赚|能不能|可不可以|是不是|有没有|要不要|[?？])/;
// 售后（退换货／退款）：登记售后记录并通知客服，不暂停 AI
const RE_AFTERSALE = /(退货|退款|退钱|换货|退换|售后|无理由退)/;
// 商城订单／发货／物流：只查客人本人（openid 绑定的会员）的订单
const RE_ORDER = /(订单|物流|快递|单号|运单|查件|谁发货|哪里发货|从哪发货|哪发货|一件代发|发货了吗|发货没|发货了没|什么时候发货|多久发货|到哪了|到哪里了|什么时候到|多久到|多久能到|多久能收到|多久收到|几天到|几天能到|几天能收到|没收到|还没到|还没收到)/;
const AFTERSALE_THROTTLE_MS = 30 * 60 * 1000;
const RE_GREETING = /^(您好|你好|hello|hi|嗨|哈喽|在吗|在不在|有人吗|有人在吗|在么|你好呀|您好呀)+$/i;
const RE_SUITABILITY = /(能用吗|可以用吗|能不能用|可不可以用|适合用|适不适合|禁忌|注意事项|注意什么|哪些人不能)/;
const RE_SYMPTOM = /(症状|疼|痛|酸痛|腰酸|麻木|晕|失眠|睡不着|睡不好|发烧|发热|咳|喘|胸闷|心慌|心悸|血压|血糖|血脂|糖尿病|肿瘤|癌|炎|结节|便秘|腹泻|拉肚子|过敏|湿疹|月经|痛经|乏力|疲劳|怕冷|手脚冰凉|不舒服|难受|生病|疾病|病|能治|治疗|治好|吃什么药|用药|药)/;
// 只有客人明确要完整保单／保单条款时才发保单 PDF（特别约定第 4 条限制宣传使用，且 PDF 含个人姓名与地址）
const RE_FULL_POLICY = /(保单原件|完整保单|保单完整|完整版保单|保单全文|保单条款|保险条款|电子保单)/;
const RE_DOCS = /(保险|保单|责任险|使用说明|说明书|使用手册|检测报告|检验报告|测试报告|资质|证书|证照|认证|波长|(?<![A-Za-z])(?:CE|EMC|CNAS)(?![A-Za-z]))/i;
const RE_AGENCY = /(代理|加盟|独家|区域合作|香港|澳门|台湾|海外|国外)/;
const RE_APPLY = /(放一台|放台|店里放|门店放|放机器|再加一台|加一台|多放|怎么申请|如何申请|怎样申请|想申请|要申请|申请机器|申请设备|申请合作|申请流程|申请条件|怎么合作|如何合作|想合作|要合作|加盟|投放机器|怎么拿到机器|想要机器|要台机器)/;
const RE_SHARED = /(共享设备|投放合作)/;
const RE_PRICE = /(多少钱|价格|价钱|费用|收费|次卡|几档|报价|怎么收费|怎么算|贵|便宜|优惠|打折|折扣|多少次|续)/;
// 只在门店合作类问题后追问来源（不在普通顾客问价、问产品时追问）
const RE_BUSINESS = /(合作|加盟|申请|代理|次卡|开店|门店放|店里放|放一台|投放|入驻|我开|我们店|开.{0,4}(店|馆|院))/;
const BUSINESS_TAGS = new Set(['apply', 'shared_device', 'price_tier', 'install', 'site']);
// 线索：客人留大陆手机号，或明确想到店体验／找门店／预约 → 通知客服（不暂停 AI）
const RE_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const RE_VISIT = /(怎么体验|如何体验|有店吗|有门店吗|有没有店|哪里有店|在哪里能用|门店地址|店的地址|带家人|一起去体验|要去体验|想去体验|想体验|要体验|去体验|哪里体验|哪里可以体验|哪里能体验|哪能体验|哪儿体验|在哪体验|在哪里体验|去哪体验|门店在哪|店在哪|哪里有门店|哪有门店|哪里有店|有没有门店|附近门店|附近的门店|最近的门店|体验店|预约)/;
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
  const texts = [simple, ...(conv?.messages || []).filter((m) => m.role === 'user' && (m.type === 'text' || m.type === 'location')).slice(-8).reverse().map((m) => kefuToSimplified(m.text))];
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
// 「留电话」只认本条消息里的手机号（或客人刚确认沿用的号码）；历史号码只标注「待确认」
function notifyLead(openid: string, simple: string, text: string, reason: string, always = false, confirmedPhone = '') {
  const info = leadInfo(openid, simple);
  const { city } = info;
  const phone = info.phoneNow || confirmedPhone;
  const earlier = !phone && info.phone ? `本条未留（之前留过尾号 ${info.phone.slice(-4)}，待客人确认）` : '';
  const key = phone ? `lead:${phone}` : 'lead:visit';
  const conv = getKefuConversation(openid);
  if (!conv) return;
  const last = [...conv.messages].reverse().find((m) => m.role === 'system' && m.type === 'lead_notify' && m.tag === key);
  if (!always && last && Date.now() - Date.parse(last.at) < LEAD_THROTTLE_MS) return;
  const detail = `城市：${city || '未提供'}；手机：${phone || earlier || '未提供'}`;
  appendKefuMessage(openid, { role: 'system', type: 'lead_notify', tag: key, text: `已通知客服：${reason}（${detail}）` });
  const fresh = getKefuConversation(openid);
  if (fresh) notifyKefuHandoff(fresh, reason, text, { force: true, detail }).catch(() => console.warn('[wechat-kefu] lead notify error'));
  // 按城市通知该城市所有体验点／门店的店主（曹总已由上面的转人工通知收到，这里不重复抄送）；只在客人留了手机号时通知店主
  if (city && phone) {
    const test = String(process.env.KEFU_NOTIFY_OPENIDS || '').split(',').map((x) => x.trim()).includes(openid);
    notifyStoreOwnersForCity(city, { type: 'lead', phone, source: `服务号客服（${reason}）`, test, simulated: isSimulatedOpenid(openid) }, { copyToAdmins: false })
      .catch(() => console.warn('[wechat-kefu] store owner notify error'));
  }
}

const RE_YES = /^(是|是的|对|对的|可以|好|好的|嗯|嗯嗯|没错|行|ok|用这个|就这个|就用这个|还是这个)$/i;

// phoneNow：本条消息里的手机号；knownPhone：之前留过的号码（只请客人确认，不当作已留）
function leadReply(phoneNow: string, city: string, knownPhone = '') {
  if (!phoneNow && knownPhone) return `想${city ? `在${city}` : ''}体验的话，还是用尾号 ${knownPhone.slice(-4)} 的手机号联系您吗？是的话回复「是」，或直接留言新的手机号。`;
  const phone = phoneNow;
  if (phone) return `已收到您的联系方式，已转给客服同事，会尽快与您联系，帮您安排${city ? `${city}的` : '就近'}体验。`;
  if (city) return `好的，麻烦留一下您的手机号，客服同事会尽快联系您，帮您安排${city}的体验。`;
  return '想到店体验的话，麻烦留言您的城市和手机号（例如：苏州 138xxxxxxxx），客服同事会尽快联系您安排。';
}

function passive(openid: string, text: string, tag: string) {
  text = phoneOnce(openid, text);
  appendKefuMessage(openid, { role: 'ai', type: 'text', text, tag, delivery: 'passive' });
  return text;
}

// force：客人明确要人工／投诉时一定通知（不受 10 分钟节流影响）；门店申请期间附上已收集的申请信息
function handoff(openid: string, reason: string, userText: string, pause: boolean, force = false) {
  const detail = force ? storeApplyHandoffDetail(openid, KEFU_CITIES) : null;
  const conv = updateKefuConversation(openid, (c) => {
    c.status = 'pending';
    c.handoffReason = reason;
    c.pausedUntil = pause ? new Date(Date.now() + PAUSE_MS).toISOString() : null;
    if (!c.tags.includes('handoff')) c.tags.push('handoff');
  });
  notifyKefuHandoff(conv, reason, userText, { force, ...(detail ? { detail } : {}) }).catch(() => console.warn('[wechat-kefu] notify error'));
}

// 只按微信服务号 openid 精确匹配会员，绝不按客人报的订单号／手机号查别人的订单
function memberIdForOpenid(openid: string) {
  if (isSimulatedOpenid(openid)) return null;
  const user = listLocalCnUsers().find((u) => u.wechatOfficialOpenId && u.wechatOfficialOpenId === openid);
  return user ? user.id : null;
}

function ownOrders(openid: string) {
  const memberId = memberIdForOpenid(openid);
  if (!memberId) return null;
  return listLocalCnOrders(memberId)
    .filter((o) => o.userId === memberId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// 问具体订单（到哪了／物流／单号／没收到）才列出本人订单；泛问谁发货、多久到只答规则＋订单入口
const RE_ORDER_STATUS = /(订单|物流|快递|单号|运单|查件|发货了吗|发货没|发货了没|到哪了|到哪里了|没收到|还没到|还没收到)/;
function orderReply(openid: string, simple: string) {
  if (!RE_ORDER_STATUS.test(simple)) return kefuOrderReply(null);
  return kefuOrderReply(ownOrders(openid));
}

// 售后登记：写入售后记录（会话标签 aftersale + 系统消息），通知客服；不改会话状态、不暂停 AI
function registerAfterSale(openid: string, text: string) {
  updateKefuConversation(openid, (c) => {
    if (!c.tags.includes('aftersale')) c.tags.push('aftersale');
  });
  const orders = ownOrders(openid) || [];
  const recent = orders.slice(0, 3).map((o) => o.orderNo).join('、');
  const detail = `售后诉求：${text.slice(0, 60)}；${recent ? `本人近期订单：${recent}` : '未查到本人订单（服务号未绑定会员或无订单）'}`;
  const conv = getKefuConversation(openid);
  if (!conv) return;
  const last = [...conv.messages].reverse().find((m) => m.role === 'system' && m.type === 'aftersale');
  appendKefuMessage(openid, { role: 'system', type: 'aftersale', tag: 'aftersale', text: `售后登记：${detail}` });
  if (last && Date.now() - Date.parse(last.at) < AFTERSALE_THROTTLE_MS) return;
  const fresh = getKefuConversation(openid);
  if (fresh) notifyKefuHandoff(fresh, '售后登记（退换货／退款）', text, { force: true, detail }).catch(() => console.warn('[wechat-kefu] aftersale notify error'));
}

function withAttribution(openid: string, text: string, userText: string, tag = 'apply') {
  const conv = getKefuConversation(openid);
  if (!conv || conv.attribution.status !== 'none' || !BUSINESS_TAGS.has(tag) || !RE_BUSINESS.test(userText)) return text;
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

function lastAiTag(conv: KefuConversation | null) {
  return conv ? [...conv.messages].reverse().find((m) => m.role === 'ai')?.tag || '' : '';
}

function healthTagged(openid: string) {
  updateKefuConversation(openid, (x) => {
    if (!x.tags.includes('health')) x.tags.push('health');
  });
}

// 价格路由：先分清问的是哪一种费用；含糊的「多少钱」看上文，仍不清楚就问一个澄清问题
function priceReply(simple: string, prevTag: string): { text: string; tag: string } | null {
  if (/(一次|每次|单次).{0,6}(多少|几块|合多少)|合多少钱|算一下.{0,6}一次/.test(simple) && /(次卡|算|合)/.test(simple)) return { text: KEFU_PER_USE_REPLY, tag: 'price_tier' };
  if (/押金|保证金/.test(simple)) return { text: KEFU_DEPOSIT_REPLY, tag: 'contract' };
  if (/(用不完|过期|退|转让)/.test(simple) && /(次卡|机器|设备)/.test(simple)) return { text: KEFU_CONTRACT_REPLY, tag: 'contract' };
  if (/(月卡|年卡)/.test(simple)) return { text: KEFU_MEMBER_CARD_REPLY, tag: 'price_member' };
  if (/(便宜|优惠|打折|折扣|活动)/.test(simple)) return { text: KEFU_DISCOUNT_REPLY, tag: 'price_tier' };
  if (/(哪一档|哪档|选哪|买哪)/.test(simple)) return { text: kefuTierPickReply(), tag: 'price_tier' };
  if (/(续|再买|快用完)/.test(simple) && /(次卡|次数)/.test(simple)) return { text: `${kefuTierReply()}\n续购次卡请留言门店名称和手机号，客服同事帮您安排。`, tag: 'price_tier' };
  if (/(次卡|几档|[ABC] ?档|多少次)/i.test(simple)) return { text: kefuTierReply(), tag: 'price_tier' };
  if (/(买|购买).{0,6}(机器|设备|一台|阿富)|(机器|设备|一台).{0,6}(卖|售价|多少钱)/.test(simple)) return { text: KEFU_BUY_MACHINE_REPLY, tag: 'price_machine' };
  if (/(商城|商品|东西)/.test(simple) && /(多少钱|价格|价钱|费用|收费|贵|便宜)/.test(simple)) return { text: KEFU_SHOP_PRICE_REPLY, tag: 'price_shop' };
  if (/(体验|到店|用一次|做一次|照一次|检测)/.test(simple)) return { text: kefuExperiencePriceReply(), tag: 'price_exp' };
  if (/(贵)/.test(simple)) return { text: `${kefuExperiencePriceReply()}\n如果您是门店想合作，次卡是 A 档 5,000 元 / 277 次、B 档 8,000 元 / 444 次、C 档 15,000 元 / 833 次。`, tag: 'price_exp' };
  if (!/(多少钱|价格|价钱|费用|收费|报价|怎么收费|怎么算)/.test(simple)) return null;
  if (BUSINESS_TAGS.has(prevTag) || prevTag === 'contract') return { text: kefuTierReply(), tag: 'price_tier' };
  if (['lead', 'lead_confirm', 'visit', 'flow', 'price_exp'].includes(prevTag)) return { text: kefuExperiencePriceReply(), tag: 'price_exp' };
  if (['shop', 'order', 'aftersale'].includes(prevTag)) return { text: KEFU_SHOP_PRICE_REPLY, tag: 'price_shop' };
  return { text: KEFU_PRICE_CLARIFY, tag: 'price_clarify' };
}

async function handleText(openid: string, text: string, deadline: number): Promise<string | null> {
  let conv = getKefuConversation(openid);
  const simple = kefuNormalize(text);
  const c = clean(simple);
  if (conv?.status === 'closed') conv = updateKefuConversation(openid, (x) => { x.status = 'ai'; });

  if (conv && (conv.status === 'pending' || conv.status === 'human') && conv.pausedUntil && Date.parse(conv.pausedUntil) > Date.now()) {
    const fresh = getKefuConversation(openid);
    if (fresh) notifyKefuHandoff(fresh, '人工处理中，客人继续留言', text).catch(() => undefined);
    return null;
  }

  // 门店申请页扫码后的申请收集：解析字段、只追问缺的项，收齐后记录并通知客服
  const storeApplyReply = continueStoreApply(openid, text, { cities: KEFU_CITIES, human: RE_HUMAN.test(simple) });
  if (storeApplyReply !== null) return storeApplyReply;

  // 客人确认沿用之前留过的手机号（上一条 AI 回复是「还是用尾号 xxxx 联系您吗？」）
  const lastAi = conv ? [...conv.messages].reverse().find((m) => m.role === 'ai') : undefined;
  const prevTag = lastAi?.tag || '';
  if (prevTag === 'lead_confirm' && RE_YES.test(c)) {
    const known = leadInfo(openid, simple);
    if (known.phone) {
      notifyLead(openid, simple, text, '客人确认用之前留的手机号/想体验', false, known.phone);
      return passive(openid, leadReply(known.phone, known.city), 'lead');
    }
  }

  // 回答「您问的是哪一种费用」的数字
  if (prevTag === 'price_clarify' && /^[123一二三]$/.test(c)) {
    const n = '1一'.includes(c) ? 1 : '2二'.includes(c) ? 2 : 3;
    if (n === 1) return passive(openid, kefuExperiencePriceReply(), 'price_exp');
    if (n === 2) return passive(openid, withAttribution(openid, kefuTierReply(), '次卡', 'price_tier'), 'price_tier');
    return passive(openid, KEFU_SHOP_PRICE_REPLY, 'price_shop');
  }

  // 来源回答：问句（多少钱、怎么…）不当作来源
  if (conv?.attribution.status === 'asked' && !RE_HUMAN.test(simple) && !RE_VISIT.test(simple) && !RE_QUESTION.test(simple) && !RE_MOBILE.test(text.replace(/[\s-]/g, '')) && c.length <= 60) {
    updateKefuConversation(openid, (x) => {
      x.attribution = { ...x.attribution, status: 'pending_review', answer: text.slice(0, 200) };
      if (!x.tags.includes('attribution')) x.tags.push('attribution');
    });
    notifyLead(openid, simple, text, `客人回答来源（待核对）：${text.slice(0, 30)}`, true);
    return passive(openid, '谢谢您，已记录，客服同事会核对后与您联系。还有其他问题可以继续问我。', 'attribution');
  }

  const lead = leadInfo(openid, simple);
  const wantsVisit = RE_VISIT.test(simple) || (/^(在哪|在哪里|怎么去|地址|地址呢|在哪呢|哪里)$/.test(c) && ['lead', 'lead_confirm', 'visit', 'flow', 'price_exp'].includes(prevTag));
  if (lead.phoneNow || wantsVisit) notifyLead(openid, simple, text, lead.phoneNow ? '客人留电话/想体验' : '客人想体验/找门店');

  if (RE_IDENTITY.test(simple) && !RE_HUMAN_ASK.test(simple.replace(/真人|人工智能/g, ''))) return passive(openid, KEFU_BOT_IDENTITY_REPLY, 'identity');

  // 合同年限是一般问题，AI 直接回答（不转人工）
  if (/(几年|多少年|年限|期限|多长时间|多久)/.test(simple) && /(合同|合作|签)/.test(simple) && !RE_HUMAN_ASK.test(simple) && !RE_COMPLAINT_TONE.test(simple) && !/(发票|开票|赔|扣)/.test(simple)) return passive(openid, KEFU_TERM_REPLY, 'contract');
  if (RE_HUMAN.test(simple)) {
    handoff(openid, RE_DISPUTE.test(simple) ? '投诉纠纷／赔偿／合同发票／付款' : '客人要求人工', text, true, true);
    // 开发票：仍转人工开具，但先把开票规则告诉客人
    if (/(发票|开票)/.test(simple) && !RE_COMPLAINT_TONE.test(simple) && !RE_HUMAN_ASK.test(simple)) return passive(openid, KEFU_INVOICE_REPLY, 'handoff');
    return passive(openid, RE_COMPLAINT_TONE.test(simple) ? KEFU_COMPLAINT_REPLY : KEFU_HANDOFF_REPLY, 'handoff');
  }

  if (RE_INJECTION.test(simple)) {
    const medical = /(治|病|药|疗效|医生)/.test(simple);
    return passive(openid, medical ? `${KEFU_NOT_MEDICAL}\n${KEFU_INJECTION_REPLY}` : KEFU_INJECTION_REPLY, 'guard');
  }
  if (RE_MODEL_Q.test(simple)) return passive(openid, KEFU_MODEL_REPLY, 'guard');

  if (RE_GREETING.test(c)) return passive(openid, KEFU_GREETING, 'greeting');
  if (RE_THANKS.test(c)) return passive(openid, KEFU_THANKS_REPLY, 'thanks');
  if (RE_ABUSE.test(c)) return passive(openid, KEFU_ABUSE_REPLY, 'calm');
  if (RE_CHITCHAT.test(simple) && !/(阿富|机器|设备|体验|门店)/.test(simple)) return passive(openid, `这个我不太擅长哈～我是「糙米量子」AI 客服，可以帮您介绍阿富同学、到店体验、门店合作和商城订单，有问题随时问我。`, 'chitchat');

  // 次卡／合作／设备相关的「能退吗」以合同为准；商城退换货走售后登记
  if ((RE_AFTERSALE.test(simple) || /(能退吗|可以退吗|能不能退)/.test(simple)) && /(次卡|合作|设备|机器|押金)/.test(simple)) return passive(openid, KEFU_CONTRACT_REPLY, 'contract');
  // 只问退换货规则（没有订单号、没说质量问题、没说要申请）：直接答规则，不登记售后
  if ((RE_AFTERSALE.test(simple) || /(能退吗|可以退吗|能不能退|能换吗)/.test(simple)) && /(谁出|谁承担|几天|多少天|政策|规定|规则|能退|可以退|能不能退|能换|吗|么)/.test(simple) && !/(\d{6,}|质量|破损|坏|发错|少发|我要|申请|帮我|已经|怎么还没|没到账|投诉)/.test(simple) && !/(次卡|合作|设备|机器|押金)/.test(simple) && !['order', 'aftersale'].includes(prevTag)) {
    return passive(openid, `${KEFU_RETURN_POLICY}\n要申请的话，请在「我的订单」${KEFU_ORDERS_URL} 找到订单号，回复订单号和原因即可。`, 'aftersale');
  }
  if (RE_AFTERSALE.test(simple) || /(质量问题|有破损|坏的|发错|少发)/.test(simple) || (/(能退吗|可以退吗|能不能退)/.test(simple) && ['order', 'shop', 'aftersale'].includes(prevTag))) {
    registerAfterSale(openid, text);
    return passive(openid, kefuAfterSaleReply(ownOrders(openid)), 'aftersale');
  }

  if (RE_ORDER.test(simple)) return passive(openid, orderReply(openid, simple), 'order');

  // 门店设备报修：登记并通知客服（不暂停 AI）
  if (/(谁来修|谁修|怎么修|保修|售后怎么)/.test(simple)) return passive(openid, '售后：一般故障 24 小时内响应，48 小时内修复或提供备用设备。机器有问题，直接在这里留言门店名称和故障情况就能报修。', 'install');
  if (RE_REPAIR.test(simple) && /(机器|设备|扫码|语音|阿富|屏幕|照射头|次数|我们店|店里)/.test(simple)) {
    notifyLead(openid, simple, text, '门店设备报修', true);
    return passive(openid, kefuRepairReply(), 'repair');
  }

  // 会员／登录／推荐码／品牌入驻／商城细节：固定口径
  if (/(验证码)/.test(simple) && /(收不到|没收到|没有收到|不来|发不出)/.test(simple)) return passive(openid, KEFU_CODE_REPLY, 'member');
  if (/(忘记密码|忘了密码|密码忘|找回密码|重置密码)/.test(simple)) return passive(openid, KEFU_PASSWORD_REPLY, 'member');
  if (/(换|改|更换).{0,4}(手机号|手机|号码)/.test(simple) && !lead.phoneNow) return passive(openid, KEFU_PHONE_CHANGE_REPLY, 'member');
  if (/(会员).{0,6}(权益|有什么|好处|福利)/.test(simple)) return passive(openid, KEFU_MEMBER_BENEFIT_REPLY, 'member');
  if (/(注册|登录|登陆)/.test(simple) && /(怎么|如何|在哪|哪里|电脑|会员)/.test(simple) && !/(入驻|品牌)/.test(simple)) return passive(openid, KEFU_LOGIN_REPLY, 'member');
  if (/(推荐码|邀请码|推荐人)/.test(simple) && !/(奖励|提成|佣金)/.test(simple) && !/(官方直属|忘|没填|绑定)/.test(simple)) return passive(openid, KEFU_REFERRAL_CODE_REPLY, 'referral');
  if (/(支付宝|货到付款|信用卡|花呗|怎么付款|付款方式|支付方式)/.test(simple) && !RE_DISPUTE.test(simple)) return passive(openid, `商城目前只支持微信支付（支付宝、货到付款暂未开通），下单后用微信支付付款即可。商城：https://rich-smart.com.cn/cn/shop`, 'shop');
  if (/(包邮|运费|邮费)/.test(simple) && !/(退|换)/.test(simple)) return passive(openid, KEFU_SHIPPING_FEE_REPLY, 'shop');
  if (/注销/.test(simple)) return passive(openid, KEFU_ACCOUNT_DELETE_REPLY, 'privacy');
  if (/(改地址|修改地址|地址填错|换地址|地址写错)/.test(simple)) return passive(openid, KEFU_ADDRESS_CHANGE_REPLY, 'shop');
  if (/(品牌方).{0,6}(电话|联系方式|联系)/.test(simple)) return passive(openid, KEFU_BRAND_CONTACT_REPLY, 'shop');
  if (/(入驻|上架)/.test(simple) || (prevTag === 'brand' && /(审核|多久|收费|费用|要钱)/.test(simple))) {
    if (/(收费|费用|要钱|多少钱|免费)/.test(simple)) return passive(openid, KEFU_BRAND_FEE_REPLY, 'brand');
    if (/(多久|几天|审核时间|多长时间)/.test(simple)) return passive(openid, KEFU_BRAND_REVIEW_REPLY, 'brand');
    if (/个人/.test(simple)) return passive(openid, `个人不能入驻。${KEFU_BRAND_APPLY_REPLY.replace(/个人不能入驻。$/, '')}`, 'brand');
    return passive(openid, KEFU_BRAND_APPLY_REPLY, 'brand');
  }

  if (/(保额|赔多少|保多少钱|保了多少)/.test(simple)) return passive(openid, KEFU_COVERAGE_REPLY, 'docs');
  if (/(注册证|医疗器械|械字号|医疗认证)/.test(simple)) return passive(openid, `${KEFU_MEDICAL_CERT_PREFIX}\n${kefuDocsReply(['emc', 'wavelength', 'insurance'])}`, 'docs');
  if (/(辐射|电磁)/.test(simple)) return passive(openid, `${KEFU_RADIATION_PREFIX}\n${kefuDocsReply(['emc', 'wavelength'])}`, 'docs');
  if (/专利/.test(simple)) return passive(openid, KEFU_PATENT_REPLY, 'docs');
  if (/(国家认证|权威认证|有没有认证|正规吗)/.test(simple)) return passive(openid, kefuDocsReply(['emc', 'wavelength', 'insurance']), 'docs');
  if (/(数据|资料|报告|隐私|信息|电话|号码).{0,10}(泄露|别人|外泄|卖|给别人|安全|删除|删掉|注销)|(删除|删掉|注销).{0,6}(资料|数据|账号|信息)|别人能看到/.test(simple)) {
    if (/(删除|删掉|注销)/.test(simple)) return passive(openid, KEFU_ACCOUNT_DELETE_REPLY, 'privacy');
    return passive(openid, KEFU_PRIVACY_REPLY, 'privacy');
  }
  if (RE_DOCS.test(simple) || (/^(那)?(检测报告|保险|证书|说明书)呢?$/.test(c))) {
    const keys: KefuDocKey[] = [];
    if (/(保险|保单|责任险)/.test(simple)) keys.push('insurance');
    if (RE_FULL_POLICY.test(simple)) keys.push('insurance', 'insurancePolicy');
    if (/(使用说明|说明书|使用手册)/.test(simple)) keys.push('usage');
    if (/(检测报告|检验报告|测试报告|波长|(?<![A-Za-z])CNAS(?![A-Za-z]))/i.test(simple)) keys.push('wavelength', 'emc');
    if (/(?<![A-Za-z])(?:CE|EMC)(?![A-Za-z])/i.test(simple)) keys.push('emc');
    if (/(资质|证书|证照|认证)/.test(simple)) keys.push('emc', 'wavelength', 'insurance');
    if (/波长/.test(simple)) return passive(openid, `远红外波长 8–14 μm，峰值波长 9.4 μm。\n${kefuDocsReply(['wavelength'])}`, 'docs');
    return passive(openid, kefuDocsReply(keys), 'docs');
  }

  if (/(什么公司|哪家公司|公司名|备案|官网|网址|富智慧|台湾公司|台湾的|外国公司|成立|老板|法人|创始人|董事长|公司在哪|公司地址|总部|传销)/.test(simple)) {
    if (/备案/.test(simple) && !/公司/.test(simple)) return passive(openid, kefuCompanyReply(simple), 'company');
    if (/传销/.test(simple)) return passive(openid, KEFU_TRUST_REPLY, 'trust');
    return passive(openid, kefuCompanyReply(simple), 'company');
  }
  if (/商城.{0,4}(在哪|在哪里|入口|链接|网址)/.test(simple)) return passive(openid, `商城入口：${'https://rich-smart.com.cn/cn/shop'}\n付款用微信支付；商品由品牌方／工厂一件代发，发货后物流单号会显示在「我的订单」里。`, 'shop');
  if (/(客服电话|电话多少|联系电话|打电话|热线)/.test(simple) && !lead.phoneNow) return passive(openid, `客服电话：${KEFU_PHONE}，也可以直接在这里留言。`, 'contact');

  // 安全／禁忌：只按《使用前注意事项》原文；注意事项没写到的人群如实说没写，请咨询医生
  const safetyFollow = ['safety'].includes(prevTag) && /^(那)?.{0,8}(呢|吗|可以吗|能用吗)?$/.test(c);
  const safetyHit = kefuSafetyMatch(simple);
  const asksSafety = RE_SUITABILITY.test(simple) || /(能.{0,4}用吗|可以.{0,4}用吗|能用|可以用|能不能|可以照|能照|正常吗|会不会烫|烫不烫|注意什么|要注意|带在身上|能洗澡|洗澡|能来试试|能试)/.test(simple);
  if ((asksSafety || safetyFollow) && (safetyHit.listed.length || safetyHit.unlisted.length)) {
    return passive(openid, kefuSafetyAnswer(simple) || kefuSafetyReply(), 'safety');
  }
  if (/(皮肤|局部).{0,4}(红|发红|起疹)|红了/.test(simple)) return passive(openid, `如果使用后皮肤发红或不适，请先停止使用；不适持续的话请及时就医。下次使用可以调低档位、拉开照射距离（约 20–50 cm），觉得灼热就挪开位置。\n${KEFU_NOT_MEDICAL}`, 'safety');
  if (RE_SUITABILITY.test(simple)) return passive(openid, kefuSafetyReply(), 'safety');

  if (/(脱衣服|隔着衣服|穿着衣服|穿衣服)/.test(simple)) return passive(openid, '不用脱衣服，隔一层薄棉质衣物就可以，照射头距离约 20–50 cm。', 'product');
  if (/(照射面积|面积多大|照多大)/.test(simple)) return passive(openid, '单次照射面积约 300×200 mm，照射头可电动升降、角度可调。', 'product');
  if (/(唤醒词|喊什么)/.test(simple)) return passive(openid, '唤醒词就是「阿富同学」，喊它可以语音调档和调节升降。', 'product');
  // 一般效果问题（不针对具体病症）：固定口径
  if (/(有什么效果|什么作用|有什么用|有用吗|管用吗|见效|多久有效|有效果吗|减肥|瘦|代替吃药|替代吃药|能治病|治病吗|治好)/.test(simple) && !kefuSymptomKeyword(text).match(/腰|颈|失眠|血压|膝|疼|痛|冰凉/)) {
    if (/(客人问|顾客问|我该怎么回答|怎么回复客人)/.test(simple)) return passive(openid, `可以这样回答客人：「${KEFU_NOT_MEDICAL}每个人体验感受不一样，可以先体验 15 分钟感受一下。」不要说能治病或改善某种疾病。`, 'efficacy');
    if (/(癌|肿瘤)/.test(simple)) return passive(openid, kefuSafetyAnswer(simple) || KEFU_EFFICACY_REPLY, 'safety');
    if (/(吃药|药)/.test(simple)) return passive(openid, `不能代替吃药。${KEFU_EFFICACY_REPLY.replace(/^.*?\n/, `${KEFU_NOT_MEDICAL}\n`)}`, 'efficacy');
    return passive(openid, KEFU_EFFICACY_REPLY, 'efficacy');
  }

  if (RE_SYMPTOM.test(simple) && !/(机器|设备|扫码|次数)/.test(simple)) {
    if (/(癌|肿瘤)/.test(simple)) return passive(openid, kefuSafetyAnswer(simple) || KEFU_EFFICACY_REPLY, 'safety');
    healthTagged(openid);
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

  // 质疑与对比
  if (/(骗|智商税|靠谱吗|靠不靠谱|真的假的|是真的吗|可信|坑人|割韭菜)/.test(simple)) return passive(openid, KEFU_TRUST_REPLY, 'trust');
  if (/(区别|比|不一样|差别|哪个好|有啥不同|有什么不同)/.test(simple) && /(灯|暖宝宝|艾灸|按摩|理疗|汗蒸|针灸|拔罐|别的|其他|红外)/.test(simple)) return passive(openid, KEFU_COMPARE_REPLY, 'compare');

  // 检测系统
  if (/(头带|3D|9D|18D|343|检测)/i.test(simple) && !/(检测报告|检验报告)/.test(simple)) {
    if (/(一个机器|同一个|一样吗|是一个|一起的)/.test(simple)) return passive(openid, '不是同一台：健康仪是远红外生育光波＋旋磁的非接触体验设备；检测系统是另外戴头带采集生物电信号，生成 343 项指标的评估报告（3D／9D／18D 三个版本），结果只作日常健康管理参考，不用于临床。', 'detect');
    return passive(openid, KEFU_DETECT_INTRO, 'detect');
  }
  if (/^(要多久|多久|多长时间|几分钟)$/.test(c) && prevTag === 'detect') return passive(openid, `检测一次约 15–30 分钟，非侵入；现场出即时报告。${KEFU_LEAD_ASK}`, 'detect');

  // 产品介绍／规格／流程
  if (/踩/.test(simple)) return passive(openid, `不是哦～阿富同学是银灰色立式设备，照射头在上方、电动升降，坐着或躺着体验，人不用站上去，也不接触机器。\n${KEFU_PRODUCT_INTRO.split('\n').slice(1, 4).join('\n')}`, 'product');
  if (/(多大|尺寸|大小|占地|多重|重量|功率|耗电|几瓦|频率范围|多少赫兹|Hz|参数|规格|小一点|家用|家里)/i.test(simple)) {
    if (/(家用|家里|小一点)/.test(simple)) return passive(openid, `门店用的是立式机（约 120×61.5×47 cm）；另有家用台式版，目前以门店合作为主，家用版的价格和购买方式请留电话由专人对接。也可以先到合作门店体验，${KEFU_LEAD_ASK}`, 'product');
    if (/(频率范围|多少赫兹|赫兹|Hz)/i.test(simple) && !/(电压|电源|插电)/.test(simple)) return passive(openid, '频率范围我这边没有准确数字，不乱报。可以对外说明的是：远红外 8–14 μm、峰值波长 9.4 μm（有 CNAS 波长检测报告），另有旋磁。需要更多参数的话留言您的手机号，客服同事确认后告诉您。', 'product');
    return passive(openid, KEFU_SPECS, 'product');
  }
  if (/(照射面积|面积多大)/.test(simple)) return passive(openid, '单次照射面积约 300×200 mm，照射头可电动升降、角度可调。', 'product');
  if (/(升降|角度|调高|调低)/.test(simple)) return passive(openid, '可以。照射头可以电动升降、调整角度，也可以喊「阿富同学」用语音调档和升降。', 'product');
  if (/(档位|几个档|几档)/.test(simple) && !/次卡/.test(simple)) return passive(openid, '设备有 1–15 档，可以喊「阿富同学」语音调档。（如果您问的是门店次卡的 A／B／C 档，回复「次卡」我再告诉您。）', 'product');
  if (/(语音|唤醒词|喊什么|怎么叫)/.test(simple)) return passive(openid, '可以语音控制：喊「阿富同学」就能调档和调节升降。', 'product');
  if (/(联网|wifi|网络|4G|信号)/i.test(simple)) return passive(openid, '机器内置 4G 流量卡与定位模组，门店不用另外配 Wi-Fi，顾客微信扫码就能开机。', 'product');
  if (/(脱衣服|隔着衣服|穿衣服|衣服)/.test(simple)) return passive(openid, '不用脱衣服，隔一层薄棉质衣物就可以，照射头距离约 20–50 cm。', 'product');
  if (/(坐着|躺着|姿势)/.test(simple)) return passive(openid, '坐着或躺着都可以，照射头可以电动升降、调角度来配合您的姿势。', 'product');
  if (/(多久|多长时间|几分钟)/.test(simple) && /(一次|用|照|体验)/.test(simple) && !/(预约|提前|到|安装|装好|审核)/.test(simple)) return passive(openid, '默认单次 15 分钟。', 'product');
  if (/(生育光波|远红外).{0,6}(什么意思|是什么|什么)/.test(simple)) return passive(openid, '远红外生育光波指的是 8–14 μm 波段的远红外线，阿富同学的峰值波长是 9.4 μm（有 CNAS 波长检测报告）。它和旋磁一起用于日常的频率养生、放松体验。', 'product');
  if (/(原理|怎么工作|什么技术)/.test(simple)) return passive(openid, `阿富同学用的是远红外生育光波（8–14 μm，峰值 9.4 μm）＋旋磁，非接触照射，坐着或躺着、隔一层薄衣物即可。\n${KEFU_NOT_MEDICAL}`, 'product');
  if (/(流程|怎么用|如何使用|使用方法|步骤)/.test(simple)) return passive(openid, KEFU_FLOW, 'flow');
  if (/(是什么|是啥|干什么|做什么用|介绍一下)/.test(simple) && /(阿富|健康仪|机器|设备|频率密码|这个)/.test(simple)) return passive(openid, KEFU_PRODUCT_INTRO, 'product');

  // 体验／门店
  if (/(上门|到家)/.test(simple)) return passive(openid, KEFU_HOME_VISIT_REPLY, 'visit');
  if (/(几点|营业时间|开门|关门)/.test(simple)) return passive(openid, KEFU_STORE_HOURS_REPLY, 'visit');
  if (/(体验|到店).{0,6}(要钱|免费|收费)|免费吗/.test(simple)) return passive(openid, kefuExperiencePriceReply(), 'price_exp');
  if (/(提前|多久).{0,4}预约/.test(simple)) return passive(openid, `提前多久预约要看门店安排，我这边没有统一规定。${KEFU_LEAD_ASK}`, 'lead');

  const cityOnly = !lead.phoneNow && lead.city && c.length <= 8 && ['lead', 'lead_confirm', 'visit', 'price_exp', 'flow'].includes(prevTag);
  if (lead.phoneNow && (BUSINESS_TAGS.has(prevTag) || ['agency', 'earnings', 'contract', 'brand'].includes(prevTag))) {
    return passive(openid, `已收到您的联系方式，已转给客服同事，会尽快与您联系${prevTag === 'brand' ? '品牌入驻' : '门店合作'}的事。`, 'lead');
  }
  if (lead.phoneNow || wantsVisit || cityOnly) {
    const ask = !lead.phoneNow && lead.phone;
    let reply = leadReply(lead.phoneNow, lead.city, lead.phone);
    // 找门店：给出可公开的门店（店名＋城市），再请留电话安排最近体验点
    if (!lead.phoneNow && !lead.phone) reply = kefuStoresReply(lead.city);
    else if (ask) reply = `${kefuStoresLine(lead.city)}\n${reply}`;
    return passive(openid, reply, ask ? 'lead_confirm' : 'lead');
  }

  // 代理／加盟／海外
  if (RE_AGENCY.test(simple) && !/(商城|入驻)/.test(simple)) return passive(openid, kefuAgencyReply(simple), 'agency');

  // 收益／推荐奖励（不出现分润相关字眼）
  if (/(赚|收益|回本|利润|挣)/.test(simple)) return passive(openid, KEFU_EARNINGS_REPLY, 'earnings');
  if (/(奖励|提成|佣金|返利|返现)/.test(simple) && /(推荐|介绍|转发|拉人|朋友)/.test(simple)) return passive(openid, KEFU_REFERRAL_REWARD_REPLY, 'referral');

  // 合作细节
  if (/(押金|保证金)/.test(simple)) return passive(openid, KEFU_DEPOSIT_REPLY, 'contract');
  if (/(搬|挪|换.{0,2}店|转移)/.test(simple) && /(机器|设备)/.test(simple)) return passive(openid, `设备所有权归公司，门店在合作期内有使用权；能不能换到另一家店使用以合同为准。${KEFU_CONTRACT_REPLY.replace(/^这个以双方签署的合同为准，我这边不替合同下结论。/, '')}`, 'contract');
  if (/(场地|要求|条件)/.test(simple) && /(场地|放|门店|店|合作|申请)/.test(simple) && !/(入驻)/.test(simple)) return passive(openid, KEFU_SITE_REQUIREMENTS, 'site');
  if (/(多久|几天).{0,6}(装|安装|到货|送到)|装好/.test(simple) && !/(商城|快递|商品)/.test(simple)) return passive(openid, KEFU_INSTALL_REPLY, 'install');
  if (/(归谁|归门店|所有权|属于谁|是谁的)/.test(simple)) return passive(openid, `设备所有权归${'公司'}（苏州糙米量子科技有限公司），门店取得合作期内的使用权，具体以合同为准。`, 'apply');
  if (/(店员|员工|几个人).{0,6}(看|照看|管)|几台/.test(simple)) return passive(openid, '零耗材、不依赖技师，一名店员就能照看多台；顾客扫码自助开机，单次 15 分钟。', 'apply');
  if (/个人.{0,4}(申请|合作|投放|拿机器)/.test(simple)) return passive(openid, '门店合作面向公司、门店等实体申请，个人海外／代购暂不开放。如果您有门店或公司，留言城市、门店名称和手机号，客服同事联系您。', 'apply');

  if (RE_SHARED.test(simple)) return passive(openid, withAttribution(openid, kefuSharedDeviceReply(), simple, 'shared_device'), 'shared_device');
  if (RE_APPLY.test(simple) || /(我开|开了|是开).{0,6}(店|馆|院|会所)/.test(simple)) return passive(openid, withAttribution(openid, kefuApplyReply(), simple, 'apply'), 'apply');

  const price = priceReply(simple, prevTag);
  if (price) return passive(openid, withAttribution(openid, price.text, simple, price.tag), price.tag);
  if (/^(那)?([ABC]) ?档呢?$/i.test(c)) return passive(openid, kefuTierReply(), 'price_tier');

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
    if (answer && answer.includes('[[转人工]]')) {
      handoff(openid, 'AI 判断需人工（纠纷／合同／付款）', text, false);
      return { text: KEFU_HANDOFF_REPLY, tag: 'handoff' };
    }
    if (!answer || blocked || answer.includes('[[不确定]]')) {
      notifyLead(openid, simple, text, !answer ? 'AI 无回应，客人问题待回复' : 'AI 没有准确资料，客人问题待回复');
      return { text: KEFU_UNSURE_REPLY, tag: 'unsure' };
    }
    return { text: kefuMainlandText(answer.replace(/\*\*/g, '').replace(/^#+\s*/gm, '')), tag: 'ai' };
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
      // 门店申请页的带参二维码：不发通用欢迎语，直接发门店申请问题模板（客服消息）
      if (parseStoreApplyScene(msg.EventKey)) return startStoreApply(openid, String(msg.EventKey), 'subscribe', deadline);
      if (parseOwnerBindScene(msg.EventKey)) return passive(openid, handleOwnerBindScan(openid, String(msg.EventKey)) || KEFU_WELCOME, 'owner_bind');
      return passive(openid, KEFU_WELCOME, 'welcome');
    }
    if (event === 'scan' && parseOwnerBindScene(msg.EventKey)) {
      updateKefuConversation(openid, (c) => { c.subscribed = true; });
      appendKefuMessage(openid, { role: 'system', type: 'event', text: '扫码绑定店主通知' });
      return passive(openid, handleOwnerBindScan(openid, String(msg.EventKey)) || '已收到。', 'owner_bind');
    }
    if (event === 'scan' && parseStoreApplyScene(msg.EventKey)) {
      updateKefuConversation(openid, (c) => {
        linkMember(c);
        c.subscribed = true;
      });
      return startStoreApply(openid, String(msg.EventKey), 'scan', deadline);
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
    const short = text.trim();
    // 店主回复「收到」确认通知；回复「退订」停止分层唤醒推送
    if (/^(收到|收到了|已收到|1)$/.test(short)) {
      const acked = ackPendingByOpenid(openid);
      if (acked >= 0) return passive(openid, acked > 0 ? '已确认收到，谢谢！' : '收到，明天继续为你推送简报。', 'owner_ack');
    }
    if (/^(退订|TD|td)$/.test(short)) {
      setPushOptOut(openid, true);
      return passive(openid, '已为你停止此类提醒。需要帮助时直接留言即可。', 'push_optout');
    }
    return handleText(openid, text, deadline);
  }

  const label: Record<string, string> = { image: '[图片]', voice: '[语音]', video: '[视频]', shortvideo: '[小视频]', location: '[位置]', link: '[链接]', file: '[文件]' };
  const placeholder = `${label[type] || `[${type || '未知'}]`}${msg.PicUrl ? ` ${msg.PicUrl}` : ''}${msg.Label ? ` ${msg.Label}` : ''}${msg.Url ? ` ${msg.Url}` : ''}`;
  appendKefuMessage(openid, { role: 'user', type: type || 'unknown', text: placeholder.slice(0, 500), msgKey: msg.MsgId }, linkMember);
  if (type === 'location') {
    const lbl = String(msg.Label || '');
    const city = KEFU_CITIES.find((x) => lbl.includes(x)) || lbl.match(/(?:省)?([\u4e00-\u9fa5]{2,4}?)市/)?.[1] || '';
    notifyLead(openid, lbl, placeholder, '客人发送位置/找门店');
    return passive(openid, kefuLocationReply(lbl, city), 'lead');
  }
  const prev = lastAiTag(getKefuConversation(openid));
  if (['aftersale', 'repair', 'order', 'handoff'].includes(prev)) {
    notifyLead(openid, '', placeholder, `客人在${prev === 'repair' ? '报修' : '售后'}对话中发送了${label[type] || '非文字消息'}`, true);
  }
  return passive(openid, KEFU_MEDIA_ASK, 'media');
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

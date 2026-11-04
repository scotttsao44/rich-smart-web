// 服务号「2 店主」「7 代理」登记后的资料收集：一次只问一项，已知的跳过；全部为自报，待后台确认。
// 只写自填资料（cn-experience-points.json profiles），绝不改推荐归属／分润／门店申请。
import { findLatestProfile, findOpenProfile, geocodeStoreProfile, listExperiencePointViews, submitStoreProfile, upsertStoreProfile, type StoreProfile } from './local-cn-experience-points';
import { experiencePointsWithOwners } from './local-cn-store-owners';
import { listLocalCnUsers } from './local-cn-users';
import { registerWechatPhoto } from './store-profile-photos';

export const STORE_PROFILE_URL = 'https://rich-smart.com.cn/cn/member/store-profile';
export const EXPERIENCE_POINTS_URL = 'https://rich-smart.com.cn/cn/experience-points';

type Step = 'address' | 'businessModel' | 'hours' | 'photos';
const STEPS: Step[] = ['address', 'businessModel', 'hours', 'photos'];
const ASK: Record<Step, string> = {
  address: '请回复门店主营业地点的完整地址（省市区＋街道门牌，例如：苏州市姑苏区某某路 12 号 2 楼）。',
  businessModel: '门店是哪种类型？回复：美容院／养生馆／社区店／其他（可直接写）。',
  hours: '营业时间是？（例如：每天 9:00–21:00）',
  photos: '最后请发 2–3 张现场照片：门头、机器摆放位置、店内环境。发完回复「好了」。',
};
const RE_SKIP = /^(跳过|略过|不填|没有|暂无|不方便|下一个|下一项|pass)$/i;
const RE_DONE = /^(好了|好|完成|发完了|没有了|就这些|结束|ok|OK|可以了)$/;
const RE_QUIT = /^(算了|不填了|退出|取消|以后再说)$/;

function memberIdOf(openid: string) {
  return listLocalCnUsers().find((u) => u.wechatOfficialOpenId && u.wechatOfficialOpenId === openid)?.id || null;
}
const okPhotos = (p: StoreProfile) => p.photos.filter((x) => x.status !== 'failed').length;

function nextStep(p: StoreProfile): Step | null {
  for (const s of STEPS) {
    if (p.skipped.includes(s)) continue;
    if (s === 'photos' ? okPhotos(p) >= 2 : String(p[s] || '').trim()) continue;
    return s;
  }
  return null;
}

function normalizeModel(t: string) {
  if (/美容|美业|皮肤/.test(t)) return '美容院';
  if (/养生|中医|理疗|艾灸|推拿|足疗|调理/.test(t)) return '养生馆';
  if (/社区|便民|驿站/.test(t)) return '社区店';
  return t.replace(/^(其他|其它)[:：,，\s]*/, '').slice(0, 20) || '其他';
}

export function ownerSummary(p: StoreProfile) {
  return [
    `门店：${p.storeName || '—'}（${p.city || '城市未填'}）`,
    `地址：${p.address || (p.skipped.includes('address') ? '跳过' : '—')}`,
    `类型：${p.businessModel || '—'}`,
    `营业时间：${p.hours || '—'}`,
    `照片：${okPhotos(p)} 张`,
    p.memberId ? `会员 #${p.memberId}` : '未绑定会员',
    '店主自报，待后台确认：/cn/ops/experience-points',
  ].join('；');
}

// 店主登记后开始：返回下一题（全部已知则返回 null）
export function startOwnerInfo(openid: string, storeName: string, city: string) {
  const memberId = memberIdOf(openid);
  const existing = findOpenProfile({ memberId, openid, kind: 'owner' }) || findLatestProfile({ memberId, openid, kind: 'owner' });
  if (existing?.status === 'submitted') return null; // 已提交待审核：不再追问，改资料走网页
  const base = existing && existing.status !== 'rejected' ? existing : null;
  // 已知资料不再问：已通过的自填资料，或后台已设本会员为负责人的体验点
  const owned = memberId ? experiencePointsWithOwners().find((x) => x.ownerMemberIds.includes(memberId)) : null;
  const ownedView = owned ? listExperiencePointViews().find((v) => v.id === owned.id) : null;
  const known = base && base.status === 'approved'
    ? { address: base.address, businessModel: base.businessModel, hours: base.hours }
    : ownedView ? { address: ownedView.address, businessModel: ownedView.businessModel, hours: ownedView.hours } : {};
  const fresh = !findOpenProfile({ memberId, openid, kind: 'owner' });
  const p = upsertStoreProfile({ memberId, openid, kind: 'owner', source: 'kefu' }, {
    storeName: base?.storeName || ownedView?.name || storeName,
    city: base?.city || ownedView?.city || city,
    ...(fresh ? Object.fromEntries(Object.entries(known).filter(([, v]) => v)) : {}),
  });
  if (p.address && p.lat === null) void geocodeStoreProfile(p.id);
  const step = nextStep(p);
  return step ? `为了在地图上准确显示门店、方便客人导航，再补几项资料（每项都可回复「跳过」）：\n${ASK[step]}` : null;
}

export type InfoResult = { reply: string; done: boolean; profile?: StoreProfile };

export function ownerInfoStep(openid: string, text: string): InfoResult | null {
  const memberId = memberIdOf(openid);
  const p = findOpenProfile({ memberId, openid, kind: 'owner' });
  if (!p || p.status !== 'collecting') return null;
  const t = text.trim();
  if (/[?？]|吗$|么$/.test(t)) return null; // 客人在提问：跳出收集，正常回答
  const step = nextStep(p);
  if (!step || RE_QUIT.test(t)) return finishOwner(p.id);
  if (RE_SKIP.test(t) || (step === 'photos' && RE_DONE.test(t))) {
    const next = upsertStoreProfile({ memberId, openid, kind: 'owner', source: 'kefu' }, { skipped: [step] });
    const ns = nextStep(next);
    return ns ? { reply: ASK[ns], done: false } : finishOwner(p.id);
  }
  let patch: Partial<StoreProfile> = {};
  if (step === 'address') {
    const addr = t.replace(/\s+/g, ' ').slice(0, 120);
    if (addr.length < 6 || !/(路|街|号|道|巷|弄|大厦|广场|村|镇|楼|室|园|区|县|里|城)/.test(addr)) return { reply: `地址需要写到街道和门牌号，方便地图定位。${ASK.address}`, done: false };
    patch = { address: addr };
  } else if (step === 'businessModel') patch = { businessModel: normalizeModel(t) };
  else if (step === 'hours') patch = { hours: t.slice(0, 40) };
  else if (step === 'photos') return { reply: `请直接发送照片（门头、机器位置、店内），发完回复「好了」；不方便可回复「跳过」。`, done: false };
  const next = upsertStoreProfile({ memberId, openid, kind: 'owner', source: 'kefu' }, patch);
  if (patch.address) void geocodeStoreProfile(next.id);
  const ns = nextStep(next);
  return ns ? { reply: `收到。${ASK[ns]}`, done: false } : finishOwner(next.id);
}

function finishOwner(id: string): InfoResult {
  const p = submitStoreProfile(id);
  return { reply: `资料已提交，后台确认后会更新到体验点页面（${EXPERIENCE_POINTS_URL}）。以后要补充或修改，可登录这里填写：${STORE_PROFILE_URL}　感谢您！`, done: true, profile: p };
}

// 图片消息：收集照片阶段登记 MediaId 并异步下载
export function ownerInfoImage(openid: string, mediaId: string): InfoResult | null {
  const memberId = memberIdOf(openid);
  const p = findOpenProfile({ memberId, openid, kind: 'owner' });
  if (!p || p.status !== 'collecting' || !mediaId) return null;
  try {
    const { profile } = registerWechatPhoto(p.id, mediaId);
    const n = okPhotos(profile);
    if (n >= 3) return finishOwner(p.id);
    const step = nextStep(profile);
    if (step && step !== 'photos') return { reply: `已收到第 ${n} 张照片。${ASK[step]}`, done: false };
    return { reply: n >= 2 ? `已收到第 ${n} 张照片。还有的话继续发，发完回复「好了」。` : `已收到第 ${n} 张照片，再发 1–2 张（门头／机器位置／店内）。`, done: false };
  } catch {
    return finishOwner(p.id);
  }
}

// 代理登记后：问覆盖区域
export function startAgentInfo(openid: string, company: string, city: string) {
  const memberId = memberIdOf(openid);
  const p = upsertStoreProfile({ memberId, openid, kind: 'agent', source: 'kefu' }, { company, city });
  if (p.coverage) return null;
  return `请问您主要覆盖哪些区域？（例如：苏州吴中区、园区；可回复「跳过」）\n也可以登录网页填写：${STORE_PROFILE_URL}`;
}
export function agentInfoStep(openid: string, text: string): InfoResult | null {
  const memberId = memberIdOf(openid);
  const p = findOpenProfile({ memberId, openid, kind: 'agent' });
  if (!p || p.status !== 'collecting') return null;
  const t = text.trim();
  if (/[?？]|吗$|么$/.test(t)) return null;
  const patch: Partial<StoreProfile> = RE_SKIP.test(t) || RE_QUIT.test(t) ? { skipped: ['coverage'] } : { coverage: t.slice(0, 120) };
  upsertStoreProfile({ memberId, openid, kind: 'agent', source: 'kefu' }, patch);
  const done = submitStoreProfile(p.id);
  return { reply: `${patch.coverage ? `已记录覆盖区域：${patch.coverage}。` : ''}身份待后台确认，负责渠道合作的同事会联系您。资料可登录这里补充修改：${STORE_PROFILE_URL}`, done: true, profile: done };
}
export function agentSummary(p: StoreProfile) {
  return [`城市：${p.city || '—'}`, `公司／称呼：${p.company || '—'}`, `覆盖区域：${p.coverage || '—'}`, p.memberId ? `会员 #${p.memberId}` : '未绑定会员', '代理自报，待后台确认：/cn/ops/experience-points'].join('；');
}

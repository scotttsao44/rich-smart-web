import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { SessionUser } from './auth';
import { isKefuAdminEligible } from './auth';
import { findLocalCnUserById, getFrozenReferrerCode, getFrozenReferrerMemberId, listLocalCnUsers, localCnPromotionQualification } from './local-cn-users';
import { ownerEligibility } from './local-cn-store-owners';
import { findLatestProfile } from './local-cn-experience-points';
import { commerceSnapshot, getWallet, listLocalCnOrders } from './local-cn-commerce';
import { getReferralEngagement } from './local-cn-referral-engagement';
import { ensureLocalCnReferralLink, referralDisplayName } from './local-cn-referral-attribution';

type MemberWorkspace = {
  profile: Record<string, unknown>;
  metrics: Array<{ label: string; value: string }>;
  referralCode: string;
  referralPath?: string;
  referralRelation?: Record<string, unknown>;
  referrals: Array<Record<string, unknown>>;
  appointments: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  commissions: Array<Record<string, unknown>>;
  health: Array<Record<string, unknown>>;
  isDemoData: boolean;
};


function resolveMemberRoleLabel(input: {
  platformAdmin?: boolean;
  kefuAdminEligible?: boolean;
  storeOwner?: boolean;
  agent?: boolean;
}) {
  if (input.platformAdmin || input.kefuAdminEligible) return '平台主管';
  if (input.agent) return '代理';
  if (input.storeOwner) return '店主';
  return '会员';
}

function memberIdentityFlags(user: SessionUser, localUser: ReturnType<typeof findLocalCnUserById>) {
  const kefuAdminEligible = isKefuAdminEligible(localUser?.wechatOfficialOpenId);
  const platformAdmin = user.platformAdmin === true || localUser?.platformAdmin === true;
  const storeOwner = Boolean(localUser && ownerEligibility(localUser.id).eligible);
  const agentProfile = localUser
    ? findLatestProfile({ memberId: localUser.id, openid: localUser.wechatOfficialOpenId, kind: 'agent' })
    : null;
  const agent = Boolean(agentProfile && (agentProfile.status === 'approved' || agentProfile.status === 'submitted'));
  const role = resolveMemberRoleLabel({ platformAdmin, kefuAdminEligible, storeOwner, agent });
  return { role, platformAdmin, kefuAdminEligible, opsEligible: platformAdmin || kefuAdminEligible, storeOwner, agent };
}

function file(userId: number) {
  const dir = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dir, `workspace-member-${userId}.json`);
}

function seededData(user: SessionUser): MemberWorkspace {
  return {
    profile: (() => { const flags = memberIdentityFlags(user, findLocalCnUserById(user.id)); return { id: user.id, name: user.name, email: user.email, role: flags.role, store: '尚未指定', wechatBound: false, platformAdmin: flags.platformAdmin, kefuAdminEligible: flags.kefuAdminEligible, opsEligible: flags.opsEligible, memberSince: new Date().toISOString().slice(0, 10) }; })(),
    metrics: [],
    referralCode: user.referralCode || `RS-CN-${Math.abs(user.id)}`,
    referrals: [],
    appointments: [],
    orders: [],
    commissions: [],
    health: [],
    isDemoData: false,
  };
}

function readOrCreate(user: SessionUser) {
  const target = file(user.id);
  if (!existsSync(target)) {
    const data = seededData(user);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(data, null, 2));
    return data;
  }
  try { return JSON.parse(readFileSync(target, 'utf8')) as MemberWorkspace; }
  catch { return seededData(user); }
}

function writeWorkspace(userId: number, data: MemberWorkspace) {
  const target = file(userId);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(data, null, 2));
}

export function addMemberHealthRecord(
  user: SessionUser,
  input: {
    label?: unknown; value?: unknown; advice?: unknown; category?: unknown; fileName?: unknown; source?: unknown;
    dValue?: unknown; consentGranted?: unknown; hasPacemaker?: unknown; isPregnant?: unknown; isUnderFive?: unknown;
  },
) {
  const data = readOrCreate(user);
  if (input.consentGranted !== true) throw new Error('保存健康资料前必须取得会员本人授权');
  const dValue = input.dValue === '' || input.dValue == null ? null : Number(input.dValue);
  if (dValue != null && (!Number.isFinite(dValue) || dValue < 0)) throw new Error('D 值格式不正确');
  const contraindications = [
    input.hasPacemaker === true ? '心脏起搏器' : '',
    input.isPregnant === true ? '孕妇' : '',
    input.isUnderFive === true ? '5 岁以下' : '',
  ].filter(Boolean);
  const recommendationBlocked = (dValue != null && dValue < 0.425) || contraindications.length > 0;
  const recordedAt = new Date();
  const followUpDate = (days: number) => new Date(recordedAt.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  const record = {
    id: `H${Date.now()}`,
    recordedAt: recordedAt.toISOString(),
    label: String(input.label || '健康检测'),
    value: dValue == null ? String(input.value || '报告已上传') : `D 值 ${dValue}`,
    advice: recommendationBlocked
      ? `本次资料不生成商品推荐，请先咨询专业医疗人员${contraindications.length ? `（${contraindications.join('、')}）` : ''}`
      : String(input.advice || '可根据本次检测结果查看健康管理商品'),
    category: recommendationBlocked ? '' : String(input.category || '健康优选'),
    fileName: String(input.fileName || ''),
    source: String(input.source || '会员建档'),
    dValue,
    contraindications,
    recommendationBlocked,
    consentGranted: true,
    consentGrantedAt: recordedAt.toISOString(),
    followUp30At: followUpDate(30),
    followUp90At: followUpDate(90),
  };
  data.health = [record, ...(data.health || [])];
  writeWorkspace(user.id, data);
  return record;
}

export function deleteMemberHealthRecord(user: SessionUser, recordId: string) {
  const data = readOrCreate(user);
  const before = data.health.length;
  data.health = data.health.filter((record) => String(record.id || '') !== recordId);
  if (data.health.length === before) return false;
  writeWorkspace(user.id, data);
  return true;
}

function money(value: number) { return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

function rewardStatus(status?: string) {
  if (status === 'available') return '可提现';
  if (status === 'paid') return '已支付';
  if (status === 'cancelled') return '已取消';
  if (status === 'reversal') return '已冲正';
  return '待确认收益';
}

function currentWalletStatus(entries: Array<{ status: string }>) {
  if (entries.some((entry) => entry.status === 'reversal')) return 'reversal';
  if (entries.some((entry) => entry.status === 'cancelled')) return 'cancelled';
  if (entries.some((entry) => entry.status === 'available')) return 'available';
  if (entries.some((entry) => entry.status === 'paid')) return 'paid';
  return entries[0]?.status;
}

function orderStatus(status: string, paymentStatus: string) {
  if (paymentStatus === 'refunded') return '已退款';
  if (paymentStatus === 'pending') return '待付款';
  if (status === 'completed') return '已完成';
  if (status === 'delivered') return '已送达';
  if (status === 'shipped') return '已发货';
  return '已付款';
}

export function getMemberWorkspace(user: SessionUser) {
  const data = readOrCreate(user);
  const localUser = findLocalCnUserById(user.id);
  const promotionQualification = localCnPromotionQualification(localUser);
  const referralSharingEnabled = user.referralSharingEnabled !== false && localUser?.referralSharingEnabled !== false && promotionQualification.status === 'granted';
  const referralCode = (localUser?.referralCode || user.referralCode || data.referralCode).toUpperCase();
  const referralLink = referralSharingEnabled ? ensureLocalCnReferralLink(user.id) : null;
  const directReferrerId = getFrozenReferrerMemberId(localUser);
  const state = commerceSnapshot();
  const wallet = getWallet(user.id);
  const referralOrders = state.orders.filter((order) => String(order.referralCode || '').toUpperCase() === referralCode);
  const walletByOrder = new Map<number, typeof wallet.entries>();
  wallet.entries.forEach((entry) => walletByOrder.set(entry.orderId, [...(walletByOrder.get(entry.orderId) || []), entry]));
  const recommendedOrders = referralOrders.map((order) => {
    const rewards = walletByOrder.get(order.id) || [];
    const reward = rewards.reduce((sum, entry) => sum + entry.amount, 0);
    const currentStatus = currentWalletStatus(rewards);
    return {
      id: order.orderNo,
      orderId: order.id,
      buyer: order.shippingName || '会员',
      product: order.items.map((item) => item.productName).join('、'),
      amount: money(Number(order.totalAmount)),
      reward: money(reward),
      status: orderStatus(order.status, order.paymentStatus),
      rewardStatus: rewardStatus(currentStatus),
    };
  });
  const allUsers = listLocalCnUsers();
  const linkedMembers = allUsers.filter((candidate) => getFrozenReferrerCode(candidate).toUpperCase() === referralCode && candidate.id !== user.id);
  const level1Codes = new Set(linkedMembers.map((m) => m.referralCode.toUpperCase()));
  const level2Members = allUsers.filter(
    (candidate) =>
      candidate.id !== user.id &&
      !linkedMembers.some((m) => m.id === candidate.id) &&
      level1Codes.has(getFrozenReferrerCode(candidate).toUpperCase()),
  );
  const referralMap = new Map<string, Record<string, unknown>>();
  linkedMembers.forEach((candidate) => referralMap.set(String(candidate.id), {
    id: candidate.id,
    name: candidate.name,
    referralCode: candidate.referralCode,
    referrerCode: getFrozenReferrerCode(candidate),
    relation: '直接推荐（一级）',
    level: 1,
    stage: '已注册',
    joinedAt: candidate.createdAt.slice(0, 10),
    orders: 0,
    amount: money(0),
    reward: money(0),
    rewardStatus: '待产生',
  }));
  level2Members.forEach((candidate) => {
    const parentMember = linkedMembers.find((m) => m.referralCode.toUpperCase() === getFrozenReferrerCode(candidate).toUpperCase());
    referralMap.set(String(candidate.id), {
      id: candidate.id,
      name: candidate.name,
      referralCode: candidate.referralCode,
      referrerCode: getFrozenReferrerCode(candidate),
      parentName: parentMember?.name || '',
      relation: `二级推荐（由 ${parentMember?.name || getFrozenReferrerCode(candidate)} 邀请）`,
      level: 2,
      stage: '已注册',
      joinedAt: candidate.createdAt.slice(0, 10),
      orders: 0,
      amount: money(0),
      reward: money(0),
      rewardStatus: '待产生',
    });
  });
  referralOrders.forEach((order) => {
    const key = String(order.userId || order.shippingName || order.orderNo);
    const current = referralMap.get(key) || { id: key, name: order.shippingName || '会员', relation: '直接推荐', level: 1, stage: '已成交', joinedAt: order.createdAt.slice(0, 10), orders: 0, amount: money(0), reward: money(0), rewardStatus: '待确认收益' };
    const related = walletByOrder.get(order.id) || [];
    const orderReward = related.reduce((sum, entry) => sum + entry.amount, 0);
    const total = Number(String(current.amount || '0').replace(/[^0-9.-]/g, '')) + Number(order.totalAmount);
    const totalReward = Number(String(current.reward || '0').replace(/[^0-9.-]/g, '')) + orderReward;
    referralMap.set(key, { ...current, stage: '已成交', orders: Number(current.orders || 0) + 1, amount: money(total), reward: money(totalReward), rewardStatus: rewardStatus(currentWalletStatus(related)) });
  });
  const ownOrders = listLocalCnOrders(user.id).map((order) => ({ id: order.orderNo, buyer: user.name, product: order.items[0]?.productName || '商城订单', amount: `¥${order.totalAmount}`, reward: '¥0.00', status: order.status === 'pending_payment' ? '待付款' : order.status, rewardStatus: '不计推荐分润' }));
  const referrals = Array.from(referralMap.values());
  const referralEngagement = getReferralEngagement(user, '30d');
  const commissions = wallet.entries.filter((entry) => entry.sourceType !== 'withdrawal').map((entry) => ({
    id: entry.id,
    entryId: entry.id,
    orderId: entry.orderId,
    type: entry.sourceType === 'brand_referral' ? '品牌推荐收益' : entry.sourceType === 'active_rank' ? '近30天品牌销售贡献收益' : entry.sourceType === 'sale' ? '商品收益' : '会员推荐收益',
    amount: money(entry.amount),
    status: rewardStatus(entry.status),
    sourceOrder: entry.orderNo,
    product: entry.productName,
    ruleSnapshot: entry.ruleSnapshot,
    expectedReleaseAt: entry.expectedReleaseAt,
    createdAt: entry.createdAt,
  }));
  return {
    ...data,
    profile: (() => { const flags = memberIdentityFlags(user, localUser); return { ...data.profile, role: flags.role, name: localUser?.name || user.name, email: localUser?.email || user.email, store: localUser?.store || data.profile.store, wechatBound: Boolean(localUser?.wechatId || localUser?.wechatMiniOpenId || localUser?.wechatOfficialOpenId || localUser?.wechatOpenPlatformOpenId || localUser?.wechatUnionId || data.profile.wechatBound), platformAdmin: flags.platformAdmin, kefuAdminEligible: flags.kefuAdminEligible, opsEligible: flags.opsEligible, referralSharingEnabled, promotionQualification }; })(),
    referralCode: referralSharingEnabled ? referralCode : '',
    referralPath: referralLink?.path || '',
    referralRelation: directReferrerId ? {
      referredByMemberId: directReferrerId,
      referrerName: referralDisplayName(directReferrerId),
      referrerCode: findLocalCnUserById(directReferrerId)?.referralCode || localUser?.referrerCode || '',
      boundAt: localUser?.referralBoundAt || localUser?.createdAt || '',
      source: localUser?.referralSource || 'legacy_referrer_code',
    } : null,
    referrals,
    appointments: referralEngagement.details.appointments,
    referralEngagement,
    orders: recommendedOrders,
    commissions,
    purchases: ownOrders,
    metrics: [
      { label: '直接推荐', value: String(referrals.filter((row) => Number(row.level) === 1).length) },
      { label: '推荐预约', value: String(referralEngagement.metrics.referralAppointments) },
      { label: '推荐订单', value: String(recommendedOrders.length) },
      { label: '可提现收益', value: money(wallet.summary.available) },
    ],
  };
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { hasPlatformAdminAccess, type SessionUser } from './auth';
import { CAOMI_TEST_ACCOUNT_USER_ID, listLocalCnUsers } from './local-cn-users';
import { hasOrganizationMembership } from './local-cn-organization-members';

export type StoreApplicationStatus =
  | 'pending_review'
  | 'revision_required'
  | 'rejected'
  | 'pending_deposit'
  | 'pending_equipment'
  | 'pending_partner_split'
  | 'active';

export type StoreParticipant = {
  userId: number;
  name: string;
  role: string;
  shareRate: number;
  depositContribution: number;
  confirmed: boolean;
};

// 预购次数（次卡）线上付款：付款后只记待灌入次数；后台绑定设备后，由管理员确认灌入（目前无机器端自动加次接口）
export type StorePrepayCreditStatus = 'awaiting_equipment' | 'pending_credit' | 'credited';
export type StorePrepay = {
  tier: string;
  amountYuan: number;
  uses: number;
  status: 'unpaid' | 'paid';
  orderNo: string;
  transactionId?: string;
  paidAt?: string;
  expiresAt?: string;
  creditStatus?: StorePrepayCreditStatus;
  creditEquipmentNo?: string;
  creditedAt?: string;
  creditedBy?: number;
};

export type StoreApplication = {
  id: string;
  name: string;
  address: string;
  contactName: string;
  contactPhone: string;
  applicationDocument: string;
  applicationDocumentName: string;
  depositAmount: number;
  applicantId: number;
  applicantName: string;
  participants: StoreParticipant[];
  equipmentShareRate: number;
  status: StoreApplicationStatus;
  reviewNote: string;
  equipmentNo: string;
  transactions: Array<{
    id: string;
    amount: number;
    occurredAt: string;
    splitVersion: string;
    shares: Array<{ userId: number; name: string; role: string; rate: number; amount: number }>;
  }>;
  prepay?: StorePrepay;
  referrerMemberId?: number | null;
  referralSource?: string;
  createdAt: string;
  updatedAt: string;
};

const CAOMI_EQUIPMENT_USER_ID = -106;
function targetFile() {
  const dir = process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dir, 'cn-store-applications.json');
}

function normalizeApplication(row: StoreApplication): StoreApplication {
  const legacyParticipants = Array.isArray(row.participants) ? row.participants : [];
  const hasEquipmentRate = Number.isFinite(Number((row as StoreApplication & { equipmentShareRate?: number }).equipmentShareRate));
  const legacyEquipmentParticipant = hasEquipmentRate ? null : legacyParticipants.find((participant) => participant.role.includes('设备'));
  const equipmentShareRate = hasEquipmentRate ? Number(row.equipmentShareRate) : Number(legacyEquipmentParticipant?.shareRate || 0);
  return {
    ...row,
    equipmentShareRate,
    participants: legacyParticipants.map((participant) => legacyEquipmentParticipant?.userId === participant.userId
      ? { ...participant, role: participant.userId === row.applicantId ? '门店负责人' : '门店合伙人', shareRate: 0 }
      : participant),
    status: (row.status as string) === 'pending_participants' ? 'pending_review' : row.status,
    transactions: Array.isArray(row.transactions) ? row.transactions : [],
  };
}

function readAll(): StoreApplication[] {
  if (!existsSync(targetFile())) return [];
  try {
    const parsed = JSON.parse(readFileSync(targetFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed.map(normalizeApplication) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: StoreApplication[]) {
  mkdirSync(path.dirname(targetFile()), { recursive: true });
  writeFileSync(targetFile(), JSON.stringify(rows, null, 2));
}

export function memberDirectory(user: SessionUser) {
  const local = listLocalCnUsers()
    .filter((row) => row.id !== CAOMI_TEST_ACCOUNT_USER_ID)
    .map((row) => ({ id: row.id, name: row.name, email: row.email, phone: row.phone }));
  const current = { id: user.id, name: user.name, email: user.email, phone: '' };
  const rows = [current, ...local];
  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}

export function listStoreApplications(user: SessionUser) {
  const rows = readAll();
  if (hasPlatformAdminAccess(user)) return rows;
  return rows.filter((row) => row.applicantId === user.id || row.participants.some((participant) => participant.userId === user.id) || hasOrganizationMembership('store', row.id, user.id));
}

export function createStoreApplication(user: SessionUser, input: Record<string, unknown>) {
  if (!String(input.name || '').trim() || !String(input.address || '').trim()) throw new Error('请填写门店名称与地址');
  const legacyParticipants = Array.isArray(input.participants) ? input.participants as Array<{ userId?: unknown; depositContribution?: unknown }> : [];
  const legacyApplicant = legacyParticipants.find((participant) => Number(participant.userId) === user.id);
  const depositAmount = Number(input.depositAmount ?? legacyApplicant?.depositContribution ?? 0);
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) throw new Error('设备预付金必须大于 0');
  const now = new Date().toISOString();
  const attribution = (input.attribution || {}) as { referrerMemberId?: unknown; referralSource?: unknown };
  const referrerMemberId = Number(attribution.referrerMemberId) > 0 ? Number(attribution.referrerMemberId) : null;
  const row: StoreApplication = {
    id: `SA${Date.now()}`,
    name: String(input.name).trim(),
    address: String(input.address).trim(),
    contactName: String(input.contactName || user.name).trim(),
    contactPhone: String(input.contactPhone || '').trim(),
    applicationDocument: String(input.applicationDocument || '').trim(),
    applicationDocumentName: String(input.applicationDocumentName || '').trim(),
    depositAmount,
    applicantId: user.id,
    applicantName: user.name,
    participants: [{ userId: user.id, name: user.name, role: '门店负责人', shareRate: 0, depositContribution: depositAmount, confirmed: true }],
    equipmentShareRate: 0,
    status: 'pending_review',
    reviewNote: '',
    equipmentNo: '',
    transactions: [],
    ...(referrerMemberId ? { referrerMemberId, referralSource: String(attribution.referralSource || '').slice(0, 60) } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const rows = readAll();
  rows.unshift(row);
  writeAll(rows);
  return row;
}

function assertApplicant(user: SessionUser, row: StoreApplication) {
  if (row.applicantId !== user.id) throw new Error('仅门店申请人可设置合伙成员与分润');
}

function configurePartnerSplit(row: StoreApplication, input: Record<string, unknown>) {
  if (!['pending_partner_split', 'active'].includes(row.status)) throw new Error('设备绑定后才能设置合伙分润');
  if (!row.participants.every((participant) => participant.confirmed)) throw new Error('所有合伙人确认参与后才能启用分润');
  const shares = Array.isArray(input.shares) ? input.shares as Array<{ userId?: unknown; shareRate?: unknown }> : [];
  row.participants = row.participants.map((participant) => ({
    ...participant,
    shareRate: Number(shares.find((share) => Number(share.userId) === participant.userId)?.shareRate),
  }));
  if (row.participants.some((participant) => !Number.isFinite(participant.shareRate) || participant.shareRate < 0)) throw new Error('请填写每位合伙人的分润比例');
  const partnerTotal = row.participants.reduce((sum, participant) => sum + participant.shareRate, 0);
  const expected = Number((100 - row.equipmentShareRate).toFixed(6));
  if (Math.abs(partnerTotal - expected) > 0.001) throw new Error(`合伙人分润必须合计 ${expected}%（设备方固定 ${row.equipmentShareRate}%）`);
  row.status = 'active';
}

export function updateStoreApplication(user: SessionUser, id: string, action: string, input: Record<string, unknown>) {
  const rows = readAll();
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const row = rows[index];

  if (action === 'add_participant') {
    assertApplicant(user, row);
    if (!['pending_partner_split', 'active'].includes(row.status)) throw new Error('设备绑定后才能邀请合伙人');
    const account = memberDirectory(user).find((member) => member.id === Number(input.userId));
    if (!account) throw new Error('找不到该会员，请先请对方完成平台注册');
    if (row.participants.some((participant) => participant.userId === account.id)) throw new Error('该会员已在门店成员中');
    row.participants.push({
      userId: account.id,
      name: account.name,
      role: String(input.role || '门店合伙人').trim().slice(0, 50),
      shareRate: 0,
      depositContribution: 0,
      confirmed: account.id === user.id,
    });
    row.status = 'pending_partner_split';
  } else if (action === 'remove_participant') {
    assertApplicant(user, row);
    const targetId = Number(input.userId);
    if (targetId === row.applicantId) throw new Error('不可移除门店申请人');
    row.participants = row.participants.filter((participant) => participant.userId !== targetId);
    row.status = 'pending_partner_split';
  } else if (action === 'confirm') {
    if (row.status !== 'pending_partner_split') throw new Error('该门店目前不需要成员确认');
    if (!row.participants.some((participant) => participant.userId === user.id)) throw new Error('无权确认该门店');
    row.participants = row.participants.map((participant) => participant.userId === user.id ? { ...participant, confirmed: true } : participant);
  } else if (action === 'configure_split') {
    assertApplicant(user, row);
    configurePartnerSplit(row, input);
  } else if (action === 'record_usage') {
    if (row.status !== 'active') throw new Error('门店启用后才能登记设备使用费');
    if (!row.participants.some((participant) => participant.userId === user.id && participant.confirmed)) throw new Error('仅已确认的门店成员可登记设备使用费');
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('设备使用费必须大于 0');
    const equipmentAmount = Number((amount * row.equipmentShareRate / 100).toFixed(2));
    const participantShares = row.participants.map((participant) => ({
      userId: participant.userId,
      name: participant.name,
      role: participant.role,
      rate: participant.shareRate,
      amount: Number((amount * participant.shareRate / 100).toFixed(2)),
    }));
    const allocated = equipmentAmount + participantShares.reduce((sum, share) => sum + share.amount, 0);
    if (participantShares.length) participantShares[participantShares.length - 1].amount = Number((participantShares[participantShares.length - 1].amount + amount - allocated).toFixed(2));
    row.transactions = [{
      id: `DU${Date.now()}`,
      amount,
      occurredAt: new Date().toISOString(),
      splitVersion: row.updatedAt,
      shares: [{ userId: CAOMI_EQUIPMENT_USER_ID, name: '糙米设备方', role: '设备方', rate: row.equipmentShareRate, amount: equipmentAmount }, ...participantShares],
    }, ...(row.transactions || [])];
  } else {
    if (!hasPlatformAdminAccess(user)) throw new Error('仅平台可执行审核操作');
    if (action === 'approve') {
      if (row.status !== 'pending_review') throw new Error('该申请目前不可审核通过');
      const equipmentShareRate = Number(input.equipmentShareRate);
      if (!Number.isFinite(equipmentShareRate) || equipmentShareRate < 0 || equipmentShareRate > 100) throw new Error('请核定 0% 至 100% 的设备方比例');
      row.equipmentShareRate = equipmentShareRate;
      // 已线上付清预购次数（次卡）的申请，审核通过后直接进入设备配置
      row.status = row.prepay?.status === 'paid' ? 'pending_equipment' : 'pending_deposit';
    } else if (action === 'revision') row.status = 'revision_required';
    else if (action === 'reject') row.status = 'rejected';
    else if (action === 'confirm_deposit') {
      if (row.status !== 'pending_deposit') throw new Error('申请尚未进入设备预付金确认阶段');
      row.status = 'pending_equipment';
    } else if (action === 'activate') {
      if (row.status !== 'pending_equipment') throw new Error('确认设备预付金后才能配置设备');
      const equipmentNo = String(input.equipmentNo || '').trim();
      if (!equipmentNo) throw new Error('请填写设备编号');
      row.equipmentNo = equipmentNo;
      row.status = 'pending_partner_split';
      if (row.prepay?.status === 'paid' && row.prepay.creditStatus !== 'credited') {
        row.prepay = { ...row.prepay, creditStatus: 'pending_credit', creditEquipmentNo: equipmentNo };
      }
    } else if (action === 'mark_credited') {
      if (row.prepay?.status !== 'paid') throw new Error('该申请尚未付款');
      if (!row.equipmentNo) throw new Error('请先绑定设备，再确认灌入次数');
      row.prepay = { ...row.prepay, creditStatus: 'credited', creditEquipmentNo: row.equipmentNo, creditedAt: new Date().toISOString(), creditedBy: user.id };
    } else throw new Error('不支持的操作');
    row.reviewNote = String(input.reviewNote || row.reviewNote || '').trim();
  }

  row.updatedAt = new Date().toISOString();
  rows[index] = row;
  writeAll(rows);
  return row;
}

export function getStoreApplicationById(id: string) {
  return readAll().find((row) => row.id === id) || null;
}

/** 选定档位、发起付款时记录（未付款）；已付款的申请不再覆盖。 */
export function setStoreApplicationPrepayPending(id: string, prepay: { tier: string; amountYuan: number; uses: number; orderNo: string }) {
  const rows = readAll();
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const row = rows[index];
  if (row.prepay?.status === 'paid') return row;
  row.prepay = { ...prepay, status: 'unpaid' };
  row.depositAmount = prepay.amountYuan;
  row.updatedAt = new Date().toISOString();
  rows[index] = row;
  writeAll(rows);
  return row;
}

/** 微信支付确认到账后记录：档位、次数、有效期（付款日起 3 个月）；幂等。 */
export function markStoreApplicationPrepayPaid(id: string, paid: { tier: string; amountYuan: number; uses: number; orderNo: string; transactionId: string; paidAt: string; expiresAt: string }) {
  const rows = readAll();
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const row = rows[index];
  if (row.prepay?.status === 'paid') return { row, changed: false };
  const creditStatus: StorePrepayCreditStatus = row.equipmentNo ? 'pending_credit' : 'awaiting_equipment';
  row.prepay = { ...paid, status: 'paid', creditStatus, ...(row.equipmentNo ? { creditEquipmentNo: row.equipmentNo } : {}) };
  row.depositAmount = paid.amountYuan;
  if (row.status === 'pending_deposit') row.status = 'pending_equipment';
  row.updatedAt = new Date().toISOString();
  rows[index] = row;
  writeAll(rows);
  return { row, changed: true };
}

// 店主通知用：已开通（active）的门店申请，只读
export function listActiveStoreApplicationsForNotify() {
  return readAll().filter((row) => row.status === 'active');
}

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { hasPlatformAdminAccess, type SessionUser } from './auth';
import { createLocalBrandMarketplaceRepository, appendBrandMarketplaceAudit } from './local-brand-page-repository';
import type { LocalCnBrand, LocalCnBrandProduct } from './local-cn-brand-marketplace';
import { findLocalCnUserById } from './local-cn-users';
import { listLocalCnMemberIdentities } from './local-cn-member-identities';
import { revokeBrandPilotAccessForMember } from './local-cn-brand-demo-access';
import { readBrandDocumentOwnership, brandDocumentDirectory } from './brand-document-ownership.server';
import { isUnifiedSocialCreditCode, normalizeUsccCandidate } from './cn-business-license-ocr';

// 品牌认领链接 + 公司主体变更申请（本地 JSON 模式）
// - 认领链接：随机 token（只存 sha256），一次性、7 天有效、可撤销、全部写审计
// - 主体变更：品牌方提交后为待审核；只有平台管理员在服务端核准后才写入品牌资料

const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ClaimStatus = 'pending' | 'claimed' | 'revoked' | 'expired';
type ChangeStatus = 'pending' | 'approved' | 'rejected';

type BrandClaim = {
  id: string;
  brandId: number;
  brandName: string;
  tokenHash: string;
  status: ClaimStatus;
  createdBy: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: number | null;
  claimedAt: string | null;
  claimedBy: number | null;
  previousOwner: { accountUserId: number | null; applicantUserId: number | null } | null;
};

type EntityChange = {
  id: string;
  brandId: number;
  brandName: string;
  requestedBy: number;
  requestedByName: string;
  companyName: string;
  registrationNo: string;
  licenseToken: string;
  licenseName: string;
  contactName: string;
  phone: string;
  status: ChangeStatus;
  reviewNote: string;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  previous: { companyName: string; registrationNo: string; businessLicenseDocument: string; businessLicenseName: string; contactName: string; phone: string } | null;
};

type ClaimAudit = { id: string; action: string; actorId: number | null; brandId: number; refId: string; detail: string; createdAt: string };

type State = { schemaVersion: 1; claims: BrandClaim[]; entityChanges: EntityChange[]; audit: ClaimAudit[] };

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}
function filePath() {
  return path.join(dataDir(), 'cn-brand-claims.json');
}
function readState(): State {
  if (!existsSync(filePath())) return { schemaVersion: 1, claims: [], entityChanges: [], audit: [] };
  const parsed = JSON.parse(readFileSync(filePath(), 'utf8'));
  return {
    schemaVersion: 1,
    claims: Array.isArray(parsed.claims) ? parsed.claims : [],
    entityChanges: Array.isArray(parsed.entityChanges) ? parsed.entityChanges : [],
    audit: Array.isArray(parsed.audit) ? parsed.audit : [],
  };
}
function writeState(state: State) {
  mkdirSync(dataDir(), { recursive: true });
  const temporary = `${filePath()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filePath());
}
function withWrite<T>(operation: (state: State) => T): T {
  if (process.env.DATABASE_URL) throw new Error('品牌认领目前仅支持本地资料模式');
  const state = readState();
  const result = operation(state);
  writeState(state);
  return result;
}
function marketplace() {
  return createLocalBrandMarketplaceRepository<LocalCnBrand, LocalCnBrandProduct>(path.resolve(dataDir()));
}
function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
function sameDigest(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function nowIso() {
  return new Date().toISOString();
}
function text(value: unknown, max = 120) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}
function addAudit(state: State, row: Omit<ClaimAudit, 'id' | 'createdAt'>) {
  state.audit.unshift({ id: `BCA-${Date.now()}-${randomBytes(3).toString('hex')}`, createdAt: nowIso(), ...row });
  state.audit = state.audit.slice(0, 1000);
}
function requireAdmin(user: SessionUser | null | undefined) {
  if (!hasPlatformAdminAccess(user)) throw new Error('仅平台管理员可操作');
}
function effectiveStatus(claim: BrandClaim): ClaimStatus {
  return claim.status === 'pending' && new Date(claim.expiresAt).getTime() <= Date.now() ? 'expired' : claim.status;
}
function publicClaim(claim: BrandClaim) {
  return {
    id: claim.id,
    brandId: claim.brandId,
    brandName: claim.brandName,
    status: effectiveStatus(claim),
    createdAt: claim.createdAt,
    expiresAt: claim.expiresAt,
    claimedAt: claim.claimedAt,
    claimedBy: claim.claimedBy,
    revokedAt: claim.revokedAt,
  };
}
function findClaimByToken(state: State, token: string) {
  const raw = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return null;
  const hash = digest(raw);
  return state.claims.find((row) => sameDigest(row.tokenHash, hash)) || null;
}

export function hasRealWechatIdentity(memberId: number) {
  const user = findLocalCnUserById(memberId);
  if (!user) return false;
  const identities = (listLocalCnMemberIdentities().identities || []) as Array<{ memberId?: number; source?: string; appId?: string }>;
  if (identities.some((row) => Number(row.memberId) === memberId && String(row.source || '').startsWith('wechat') && row.appId)) return true;
  const openIds = [user.wechatOfficialOpenId, user.wechatOpenPlatformOpenId, user.wechatMiniOpenId].filter(Boolean).map(String);
  return openIds.some((id) => !id.startsWith('wx_quick_'));
}

function isPilotLikeMember(memberId: number) {
  const user = findLocalCnUserById(memberId);
  if (!user) return false;
  return /^brand-(pilot|demo)-.+@/i.test(String(user.email || '')) || /^RS-CN-(PILOT|DEMO)-/i.test(String(user.referralCode || ''));
}

// ---------- 认领链接（管理员） ----------

export function createBrandClaimLink(admin: SessionUser | null | undefined, brandIdInput: number) {
  requireAdmin(admin);
  const brandId = Number(brandIdInput);
  const brand = marketplace().readState().brands.find((row) => row.id === brandId);
  if (!brand) throw new Error('找不到品牌');
  if (brand.status !== 'approved') throw new Error('仅已核准的品牌可建立认领链接');
  const token = randomBytes(32).toString('base64url');
  return withWrite((state) => {
    for (const row of state.claims) {
      if (row.brandId === brandId && effectiveStatus(row) === 'pending') {
        row.status = 'revoked';
        row.revokedAt = nowIso();
        row.revokedBy = admin!.id;
        addAudit(state, { action: 'claim_link.revoked', actorId: admin!.id, brandId, refId: row.id, detail: '建立新认领链接时自动撤销旧链接' });
      }
    }
    const claim: BrandClaim = {
      id: `BCL-${Date.now()}-${randomBytes(4).toString('hex')}`,
      brandId,
      brandName: text(brand.brandName),
      tokenHash: digest(token),
      status: 'pending',
      createdBy: admin!.id,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + CLAIM_TTL_MS).toISOString(),
      revokedAt: null,
      revokedBy: null,
      claimedAt: null,
      claimedBy: null,
      previousOwner: null,
    };
    state.claims.unshift(claim);
    addAudit(state, { action: 'claim_link.created', actorId: admin!.id, brandId, refId: claim.id, detail: '平台建立一次性品牌认领链接（7 天有效）' });
    return { claim: publicClaim(claim), token };
  });
}

export function revokeBrandClaimLink(admin: SessionUser | null | undefined, claimId: string) {
  requireAdmin(admin);
  return withWrite((state) => {
    const claim = state.claims.find((row) => row.id === claimId);
    if (!claim) throw new Error('找不到认领链接');
    if (effectiveStatus(claim) !== 'pending') throw new Error('该认领链接已使用、过期或撤销');
    claim.status = 'revoked';
    claim.revokedAt = nowIso();
    claim.revokedBy = admin!.id;
    addAudit(state, { action: 'claim_link.revoked', actorId: admin!.id, brandId: claim.brandId, refId: claim.id, detail: '平台管理员撤销品牌认领链接' });
    return publicClaim(claim);
  });
}

export function listBrandClaimLinks(admin: SessionUser | null | undefined) {
  requireAdmin(admin);
  return readState().claims.map(publicClaim);
}

// ---------- 认领（品牌方） ----------

export function inspectBrandClaim(token: string) {
  const claim = findClaimByToken(readState(), token);
  if (!claim) return null;
  const brand = marketplace().readState().brands.find((row) => row.id === claim.brandId);
  return {
    status: effectiveStatus(claim),
    expiresAt: claim.expiresAt,
    brandId: claim.brandId,
    brandName: text(brand?.brandName || claim.brandName),
    logoUrl: brand?.logoUrl || '',
    claimedBy: claim.claimedBy,
  };
}

export function describeClaimant(user: SessionUser | null | undefined) {
  if (!user?.id) return { loggedIn: false };
  const owned = marketplace().readState().brands.filter((row) => row.accountUserId === user.id || row.applicantUserId === user.id);
  return {
    loggedIn: true,
    memberId: user.id,
    name: text(user.name || '', 60),
    hasWechat: hasRealWechatIdentity(user.id),
    isPilot: user.demoAccount === true || isPilotLikeMember(user.id),
    isAdmin: hasPlatformAdminAccess(user),
    ownedBrandIds: owned.map((row) => row.id),
  };
}

export function claimBrandWithToken(user: SessionUser | null | undefined, token: string) {
  if (!user?.id || user.region !== 'CN') throw new Error('请先用微信登录后再认领');
  if (hasPlatformAdminAccess(user)) throw new Error('平台管理员账号不能认领品牌，请使用品牌方本人的微信登录');
  if (user.demoAccount === true || isPilotLikeMember(user.id)) throw new Error('当前是品牌测试账号，请使用品牌方本人的微信登录');
  if (!hasRealWechatIdentity(user.id)) throw new Error('请先用微信授权登录（微信内打开或用微信扫码），再确认认领');
  const state = readState();
  const claim = findClaimByToken(state, token);
  if (!claim) throw new Error('认领链接无效，请向平台索取新的链接');
  const status = effectiveStatus(claim);
  if (status === 'claimed') throw new Error(claim.claimedBy === user.id ? '您已认领该品牌，可直接进入品牌工作台' : '该认领链接已被使用，如有疑问请联系平台');
  if (status === 'revoked') throw new Error('该认领链接已被平台撤销，请向平台索取新的链接');
  if (status === 'expired') throw new Error('该认领链接已过期，请向平台索取新的链接');

  const now = nowIso();
  const actor = { id: user.id, name: text(user.name || '品牌方', 60) };
  const transfer = marketplace().withWrite((market) => {
    const brand = market.brands.find((row) => row.id === claim.brandId);
    if (!brand) throw new Error('找不到品牌');
    if (brand.status !== 'approved') throw new Error('该品牌目前不可认领，请联系平台');
    const otherBrand = market.brands.find((row) => row.id !== brand.id && (row.accountUserId === user.id || row.applicantUserId === user.id));
    if (otherBrand) throw new Error('该微信账号已绑定其他品牌，请换一个微信或联系平台');
    const previousOwner = { accountUserId: brand.accountUserId ?? null, applicantUserId: brand.applicantUserId ?? null };
    brand.accountUserId = user.id;
    brand.applicantUserId = user.id;
    brand.updatedAt = now;
    appendBrandMarketplaceAudit(market, actor, 'brand', brand.id, 'brand_claimed', `品牌方以微信会员 ${user.id} 认领品牌（原负责人 ${previousOwner.accountUserId ?? '-'}）；商品与品牌资料保持不变`);
    return previousOwner;
  });

  withWrite((next) => {
    const row = next.claims.find((item) => item.id === claim.id)!;
    row.status = 'claimed';
    row.claimedAt = now;
    row.claimedBy = user.id;
    row.previousOwner = transfer;
    addAudit(next, { action: 'claim_link.claimed', actorId: user.id, brandId: claim.brandId, refId: claim.id, detail: `微信会员 ${user.id} 认领品牌；原负责人 ${transfer.accountUserId ?? '-'} 已移除品牌权限；认领者上线 ${findLocalCnUserById(user.id)?.referredByMemberId ?? '待确认'}` });
  });

  const previousIds = Array.from(new Set([transfer.accountUserId, transfer.applicantUserId].filter((id): id is number => Boolean(id) && id !== user.id)));
  for (const id of previousIds) {
    try { revokeBrandPilotAccessForMember(user.id, id, claim.brandId); } catch (error) { console.error('Revoke pilot access after claim failed:', error); }
  }
  return { brandId: claim.brandId, brandName: claim.brandName, previousOwnerIds: previousIds };
}

// ---------- 公司主体变更 ----------

function ownedApprovedBrand(userId: number) {
  return marketplace().readState().brands.find((row) => row.status === 'approved' && (row.accountUserId === userId || row.applicantUserId === userId)) || null;
}

function publicChange(row: EntityChange) {
  return { ...row };
}

export function getMyEntityChangeOverview(user: SessionUser | null | undefined) {
  if (!user?.id) throw new Error('请先登录');
  const brand = ownedApprovedBrand(user.id);
  if (!brand) return { brand: null, requests: [] };
  return {
    brand: {
      id: brand.id,
      brandName: text(brand.brandName),
      companyName: text(brand.companyName),
      registrationNo: text(brand.registrationNo || ''),
      hasLicense: Boolean(brand.businessLicenseDocument),
    },
    requests: readState().entityChanges.filter((row) => row.brandId === brand.id && row.requestedBy === user.id).map(publicChange),
  };
}

export function submitEntityChange(user: SessionUser | null | undefined, input: Record<string, unknown>) {
  if (!user?.id) throw new Error('请先登录');
  const brand = ownedApprovedBrand(user.id);
  if (!brand) throw new Error('当前账号没有已开通的品牌，无法变更公司主体');
  const companyName = text(input.companyName, 100);
  const registrationNo = normalizeUsccCandidate(text(input.registrationNo, 40));
  const licenseToken = text(input.licenseToken, 220);
  const licenseName = text(input.licenseName, 160) || '营业执照';
  const contactName = text(input.contactName, 40);
  const phone = text(input.phone, 20).replace(/[\s-]/g, '');
  if (companyName.length < 4) throw new Error('请填写完整的公司名称（与营业执照一致）');
  if (!isUnifiedSocialCreditCode(registrationNo)) throw new Error('统一社会信用代码格式不正确，请核对营业执照上的 18 位代码');
  if (!contactName) throw new Error('请填写联系人');
  if (!/^1[3-9]\d{9}$/.test(phone)) throw new Error('请填写正确的 11 位手机号');
  if (!licenseToken) throw new Error('请上传营业执照');
  const ownership = readBrandDocumentOwnership(licenseToken);
  if (ownership.source !== 'metadata' || ownership.ownerId !== user.id || !licenseToken.startsWith('license-') || !existsSync(path.join(brandDocumentDirectory(), licenseToken))) {
    throw new Error('营业执照文件无效，请重新上传');
  }
  return withWrite((state) => {
    if (state.entityChanges.some((row) => row.brandId === brand.id && row.status === 'pending')) {
      throw new Error('已有一笔主体变更正在审核中，请等待平台审核结果');
    }
    const row: EntityChange = {
      id: `BEC-${Date.now()}-${randomBytes(4).toString('hex')}`,
      brandId: brand.id,
      brandName: text(brand.brandName),
      requestedBy: user.id,
      requestedByName: text(user.name || '', 60),
      companyName,
      registrationNo,
      licenseToken,
      licenseName,
      contactName,
      phone,
      status: 'pending',
      reviewNote: '',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: nowIso(),
      previous: null,
    };
    state.entityChanges.unshift(row);
    addAudit(state, { action: 'entity_change.submitted', actorId: user.id, brandId: brand.id, refId: row.id, detail: '品牌方提交公司主体变更，待平台审核' });
    return publicChange(row);
  });
}

export function listEntityChangesForAdmin(admin: SessionUser | null | undefined) {
  requireAdmin(admin);
  const brands = marketplace().readState().brands;
  return readState().entityChanges.map((row) => {
    const brand = brands.find((item) => item.id === row.brandId);
    return {
      ...publicChange(row),
      current: brand ? { companyName: text(brand.companyName), registrationNo: text(brand.registrationNo || ''), businessLicenseDocument: brand.businessLicenseDocument || '', businessLicenseName: brand.businessLicenseName || '' } : null,
    };
  });
}

function licenseDraft(token: string): Record<string, string> {
  try {
    const metadata = JSON.parse(readFileSync(path.join(brandDocumentDirectory(), '.metadata', `${token}.json`), 'utf8'));
    return metadata?.draft && typeof metadata.draft === 'object' ? metadata.draft : {};
  } catch {
    return {};
  }
}

export function reviewEntityChange(admin: SessionUser | null | undefined, id: string, decision: 'approved' | 'rejected', noteInput: unknown) {
  requireAdmin(admin);
  const note = text(noteInput, 300);
  if (decision !== 'approved' && decision !== 'rejected') throw new Error('审核结果不正确');
  if (decision === 'rejected' && !note) throw new Error('退回时必须填写原因');
  const state = readState();
  const change = state.entityChanges.find((row) => row.id === id);
  if (!change) throw new Error('找不到主体变更申请');
  if (change.status !== 'pending') throw new Error('该申请已处理，请刷新后再操作');
  const now = nowIso();
  const actor = { id: admin!.id, name: text(admin!.name || '平台', 60) };
  let previous: EntityChange['previous'] = null;
  if (decision === 'approved') {
    const draft = licenseDraft(change.licenseToken);
    previous = marketplace().withWrite((market) => {
      const brand = market.brands.find((row) => row.id === change.brandId);
      if (!brand) throw new Error('找不到品牌');
      if (brand.accountUserId !== change.requestedBy && brand.applicantUserId !== change.requestedBy) throw new Error('提交人已不是该品牌负责人，无法核准');
      const before = {
        companyName: brand.companyName || '',
        registrationNo: brand.registrationNo || '',
        businessLicenseDocument: brand.businessLicenseDocument || '',
        businessLicenseName: brand.businessLicenseName || '',
        contactName: brand.contactName || '',
        phone: brand.phone || '',
      };
      brand.companyName = change.companyName;
      brand.registrationNo = change.registrationNo;
      brand.businessLicenseDocument = change.licenseToken;
      brand.businessLicenseName = change.licenseName;
      brand.contactName = change.contactName;
      brand.phone = change.phone;
      // 原主体的执照登记信息不再适用：以新执照识别结果覆盖，识别不到的留空
      brand.legalRepresentative = text(draft.legalRepresentative || '', 60);
      brand.companyType = text(draft.companyType || '', 60);
      brand.registeredCapital = text(draft.registeredCapital || '', 60);
      brand.establishmentDate = text(draft.establishmentDate || '', 40);
      brand.companyAddress = text(draft.companyAddress || '', 200);
      brand.businessScope = String(draft.businessScope || '').slice(0, 2000);
      const otherDocs = (brand.brandDocuments || []).filter((doc) => doc.kind !== 'license');
      brand.brandDocuments = [{ token: change.licenseToken, name: change.licenseName, kind: 'license' }, ...otherDocs];
      brand.updatedAt = now;
      appendBrandMarketplaceAudit(market, actor, 'brand', brand.id, 'entity_change_approved', `核准公司主体变更：${before.companyName || '-'} → ${change.companyName}`);
      return before;
    });
  } else {
    marketplace().withWrite((market) => {
      appendBrandMarketplaceAudit(market, actor, 'brand', change.brandId, 'entity_change_rejected', `退回公司主体变更：${note}`);
    });
  }
  return withWrite((next) => {
    const row = next.entityChanges.find((item) => item.id === id)!;
    row.status = decision;
    row.reviewNote = note;
    row.reviewedBy = admin!.id;
    row.reviewedAt = now;
    row.previous = previous;
    addAudit(next, { action: decision === 'approved' ? 'entity_change.approved' : 'entity_change.rejected', actorId: admin!.id, brandId: row.brandId, refId: row.id, detail: decision === 'approved' ? '平台核准公司主体变更并写入品牌资料' : `平台退回：${note}` });
    return publicChange(row);
  });
}

import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { EXPERIENCE_POINT_DIRECTORY, KEFU_PUBLIC_PHONE, type ExperiencePoint, type GeoStatus } from './cn-experience-points';
import { geocodeCn } from './cn-geocode';
import { experiencePointsWithOwners } from './local-cn-store-owners';
import { listActiveStoreApplicationsForNotify } from './local-cn-store-applications';
import { findLocalCnUserById, isLocalCnAttributionPending } from './local-cn-users';

// 体验点地址／导航资料 + 店主／代理自填资料（cn-experience-points.json）
// - overrides：后台对底稿（EXPERIENCE_POINT_DIRECTORY）的修改（地址、坐标、电话、营业时间、显示开关、照片）
// - added：后台通过的店主自报门店（新体验点）
// - profiles：店主／代理自填（服务号对话或 /cn/member/store-profile），状态 collecting→submitted→approved/rejected
// 自填资料只做比对与标记，绝不改会员的推荐归属、分润或门店申请资料。

export type PointOverride = Partial<Pick<ExperiencePoint, 'city' | 'kefuLabel' | 'publicAddress' | 'district' | 'lat' | 'lng' | 'geoStatus' | 'publicPhone' | 'hours' | 'visible' | 'businessModel' | 'geoNote'>> & {
  photos?: string[]; // 已批准公开的照片 ref（profileId/photoId）
  updatedAt?: string;
  updatedBy?: number;
};

export type ProfilePhoto = { id: string; file: string; status: 'ok' | 'downloading' | 'failed'; source: 'wechat' | 'upload'; at: string; mediaId?: string };

export type StoreProfile = {
  id: string;
  kind: 'owner' | 'agent';
  memberId: number | null;
  openid: string | null;
  storeName: string;
  city: string;
  address: string;
  district: string;
  lat: number | null;
  lng: number | null;
  geoStatus: GeoStatus;
  geoHint: string;
  businessModel: string;
  hours: string;
  photos: ProfilePhoto[];
  company: string; // 代理：公司／称呼
  coverage: string; // 代理：覆盖区域
  declaredReferrer: string; // 自填推荐人（只比对，不写入归属）
  skipped: string[];
  status: 'collecting' | 'submitted' | 'approved' | 'rejected';
  source: 'kefu' | 'web';
  flags: string[];
  pointId: string | null;
  reviewNote: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
};

type State = { schemaVersion: 1; overrides: Record<string, PointOverride>; added: Array<ExperiencePoint & { photos?: string[] }>; profiles: StoreProfile[] };

export type ExperiencePointView = {
  id: string;
  city: string;
  district: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  geoStatus: GeoStatus;
  phone: string;
  phoneIsStore: boolean;
  hours: string;
  businessModel: string;
  visible: boolean;
  photos: string[]; // 公开照片 URL
  geoNote: string;
  source: string;
  base: boolean;
};

const MAX_PHOTOS = 6;

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}
function stateFile() {
  return path.join(dataDir(), 'cn-experience-points.json');
}
export function profilePhotoDir(profileId: string) {
  return path.join(dataDir(), 'store-profile-photos', profileId.replace(/[^a-z0-9_-]/gi, ''));
}

function readState(): State {
  try {
    if (!existsSync(stateFile())) return { schemaVersion: 1, overrides: {}, added: [], profiles: [] };
    const p = JSON.parse(readFileSync(stateFile(), 'utf8'));
    return {
      schemaVersion: 1,
      overrides: p.overrides && typeof p.overrides === 'object' ? p.overrides : {},
      added: Array.isArray(p.added) ? p.added : [],
      profiles: Array.isArray(p.profiles) ? p.profiles : [],
    };
  } catch {
    return { schemaVersion: 1, overrides: {}, added: [], profiles: [] };
  }
}
function writeState(state: State) {
  mkdirSync(path.dirname(stateFile()), { recursive: true });
  const tmp = `${stateFile()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, stateFile());
}
function mutate<T>(fn: (s: State) => T): T {
  const s = readState();
  const out = fn(s);
  writeState(s);
  return out;
}
const now = () => new Date().toISOString();
const newId = (p: string) => `${p}${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

export function photoUrl(ref: string) {
  const [p, f] = ref.split('/');
  return `/api/cn/experience-points/photo?p=${encodeURIComponent(p || '')}&f=${encodeURIComponent(f || '')}`;
}

function toView(point: ExperiencePoint & { photos?: string[] }, o: PointOverride | undefined, base: boolean): ExperiencePointView {
  const m = { ...point, ...(o || {}) } as ExperiencePoint & PointOverride;
  const lat = Number.isFinite(Number(m.lat)) && m.lat !== null && m.lat !== undefined ? Number(m.lat) : null;
  const lng = Number.isFinite(Number(m.lng)) && m.lng !== null && m.lng !== undefined ? Number(m.lng) : null;
  const address = String(m.publicAddress || '').trim();
  const geoStatus: GeoStatus = !address ? 'missing' : (m.geoStatus || (lat !== null ? 'approximate' : 'missing'));
  const storePhone = String(m.publicPhone || '').trim();
  return {
    id: point.id,
    city: m.city,
    district: String(m.district || ''),
    name: m.kefuLabel,
    address,
    lat,
    lng,
    geoStatus,
    phone: storePhone || KEFU_PUBLIC_PHONE,
    phoneIsStore: Boolean(storePhone),
    hours: String(m.hours || ''),
    businessModel: String(m.businessModel || ''),
    visible: m.visible !== false,
    photos: (m.photos || []).map(photoUrl),
    geoNote: String(m.geoNote || ''),
    source: String(point.source || ''),
    base,
  };
}

export function listExperiencePointViews(state = readState()): ExperiencePointView[] {
  return [
    ...EXPERIENCE_POINT_DIRECTORY.map((p) => toView(p, state.overrides[p.id], true)),
    ...state.added.map((p) => toView(p, state.overrides[p.id], false)),
  ];
}

// 对外（页面＋客服）：visible 且有地址（precise／approximate）
export function listPublicExperiencePoints() {
  return listExperiencePointViews().filter((p) => p.visible && p.geoStatus !== 'missing' && p.address);
}

const EDITABLE: Array<keyof PointOverride> = ['city', 'kefuLabel', 'publicAddress', 'district', 'lat', 'lng', 'geoStatus', 'publicPhone', 'hours', 'visible', 'businessModel', 'geoNote', 'photos'];

export function updateExperiencePoint(id: string, patch: Record<string, unknown>, by: number) {
  return mutate((s) => {
    const known = EXPERIENCE_POINT_DIRECTORY.some((p) => p.id === id) || s.added.some((p) => p.id === id);
    if (!known) throw new Error('找不到该体验点');
    const o: PointOverride = { ...(s.overrides[id] || {}) };
    for (const k of EDITABLE) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (k === 'lat' || k === 'lng') {
        const n = v === '' || v === null ? undefined : Number(v);
        if (n !== undefined && (!Number.isFinite(n) || (k === 'lat' ? n < 3 || n > 54 : n < 73 || n > 136))) throw new Error(`${k === 'lat' ? '纬度' : '经度'}不在中国范围内`);
        (o as Record<string, unknown>)[k] = n;
      } else if (k === 'visible') o.visible = Boolean(v);
      else if (k === 'geoStatus') {
        if (!['precise', 'approximate', 'missing'].includes(String(v))) throw new Error('定位状态不正确');
        o.geoStatus = String(v) as GeoStatus;
      } else if (k === 'publicPhone') {
        const t = String(v || '').trim();
        // 只收门店座机／400／前台号码；手机号视为个人号码，拒收
        if (t && /^1[3-9]\d{9}$/.test(t.replace(/[\s-]/g, '')) && t.replace(/[\s-]/g, '') !== KEFU_PUBLIC_PHONE) throw new Error('门店电话请填门店座机或 400 电话，不要填个人手机号');
        o.publicPhone = t.slice(0, 30);
      } else if (k === 'photos') o.photos = Array.isArray(v) ? v.map(String).filter((x) => /^[a-z0-9_-]+\/[a-z0-9_-]+$/i.test(x)).slice(0, MAX_PHOTOS) : [];
      else (o as Record<string, unknown>)[k] = String(v ?? '').trim().slice(0, k === 'geoNote' ? 300 : 120);
    }
    o.updatedAt = now();
    o.updatedBy = by;
    s.overrides[id] = o;
    return listExperiencePointViews(s).find((p) => p.id === id);
  });
}

export async function geocodeAddressForAdmin(address: string, city: string) {
  return geocodeCn(address, city);
}

// ── 店主／代理自填 ──
function emptyProfile(kind: StoreProfile['kind'], memberId: number | null, openid: string | null, source: StoreProfile['source']): StoreProfile {
  const t = now();
  return {
    id: newId('sp'), kind, memberId, openid, storeName: '', city: '', address: '', district: '', lat: null, lng: null, geoStatus: 'missing', geoHint: '',
    businessModel: '', hours: '', photos: [], company: '', coverage: '', declaredReferrer: '', skipped: [], status: 'collecting', source, flags: [], pointId: null,
    reviewNote: '', createdAt: t, updatedAt: t, submittedAt: null, reviewedAt: null,
  };
}

export function listStoreProfiles() {
  return readState().profiles.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function getStoreProfile(id: string) {
  return readState().profiles.find((p) => p.id === id) || null;
}
// 当前未结案（collecting／submitted）的资料，按会员或 openid 找
export function findOpenProfile(q: { memberId?: number | null; openid?: string | null; kind?: StoreProfile['kind'] }) {
  return readState().profiles
    .filter((p) => (!q.kind || p.kind === q.kind) && (p.status === 'collecting' || p.status === 'submitted'))
    .filter((p) => (q.memberId && p.memberId === q.memberId) || (q.openid && p.openid === q.openid))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}
export function findLatestProfile(q: { memberId?: number | null; openid?: string | null; kind?: StoreProfile['kind'] }) {
  return readState().profiles
    .filter((p) => (!q.kind || p.kind === q.kind) && ((q.memberId && p.memberId === q.memberId) || (q.openid && p.openid === q.openid)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}

const PROFILE_TEXT: Array<keyof StoreProfile> = ['storeName', 'city', 'address', 'district', 'businessModel', 'hours', 'company', 'coverage', 'declaredReferrer'];

export function upsertStoreProfile(q: { memberId: number | null; openid: string | null; kind: StoreProfile['kind']; source: StoreProfile['source'] }, patch: Partial<StoreProfile>) {
  return mutate((s) => {
    let row = s.profiles
      .filter((p) => p.kind === q.kind && (p.status === 'collecting' || p.status === 'submitted'))
      .find((p) => (q.memberId && p.memberId === q.memberId) || (q.openid && p.openid === q.openid));
    if (!row) {
      row = emptyProfile(q.kind, q.memberId, q.openid, q.source);
      s.profiles.push(row);
    }
    if (q.memberId && !row.memberId) row.memberId = q.memberId;
    if (q.openid && !row.openid) row.openid = q.openid;
    for (const k of PROFILE_TEXT) {
      if (patch[k] === undefined) continue;
      const v = String(patch[k] ?? '').trim().slice(0, k === 'address' || k === 'coverage' ? 120 : 60);
      (row as Record<string, unknown>)[k] = v;
      if (k === 'address') { row.lat = null; row.lng = null; row.geoStatus = v ? 'approximate' : 'missing'; row.geoHint = ''; }
    }
    if (Array.isArray(patch.skipped)) row.skipped = Array.from(new Set([...row.skipped, ...patch.skipped.map(String)]));
    if (patch.lat !== undefined && patch.lng !== undefined) { row.lat = patch.lat; row.lng = patch.lng; }
    if (patch.geoHint !== undefined) row.geoHint = String(patch.geoHint).slice(0, 200);
    if (patch.district && !row.district) row.district = String(patch.district).slice(0, 20);
    if (row.status === 'submitted') row.flags = crossCheck(row);
    row.updatedAt = now();
    return { ...row };
  });
}

export function addProfilePhoto(profileId: string, photo: Omit<ProfilePhoto, 'id' | 'at'>) {
  return mutate((s) => {
    const row = s.profiles.find((p) => p.id === profileId);
    if (!row) throw new Error('资料不存在');
    if (row.photos.filter((x) => x.status !== 'failed').length >= MAX_PHOTOS) throw new Error(`最多 ${MAX_PHOTOS} 张照片`);
    const item: ProfilePhoto = { ...photo, id: newId('ph'), at: now() };
    row.photos.push(item);
    row.updatedAt = now();
    return { profile: { ...row }, photo: item };
  });
}
export function setProfilePhotoStatus(profileId: string, photoId: string, status: ProfilePhoto['status'], file?: string) {
  mutate((s) => {
    const ph = s.profiles.find((p) => p.id === profileId)?.photos.find((x) => x.id === photoId);
    if (ph) { ph.status = status; if (file) ph.file = file; }
  });
}
export function removeProfilePhoto(profileId: string, photoId: string) {
  return mutate((s) => {
    const row = s.profiles.find((p) => p.id === profileId);
    if (!row) return null;
    row.photos = row.photos.filter((x) => x.id !== photoId);
    row.updatedAt = now();
    return { ...row };
  });
}

// 后台用：自填与系统记录比对（只标记，不改系统资料）
function crossCheck(row: StoreProfile): string[] {
  const flags: string[] = [];
  const user = row.memberId ? findLocalCnUserById(row.memberId) : null;
  if (!user) flags.push('未绑定会员（只有服务号 openid），无法核对推荐归属');
  if (user) {
    if (isLocalCnAttributionPending(user)) flags.push('系统推荐归属：待核对');
    const ref = Number(user.referredByMemberId) > 0 ? findLocalCnUserById(Number(user.referredByMemberId)) : null;
    const declared = row.declaredReferrer.replace(/\s/g, '');
    if (declared) {
      const sysNames = [ref?.name, ref?.referralCode, user.referrerCode].filter(Boolean).map((x) => String(x).replace(/\s/g, ''));
      if (!sysNames.length) flags.push(`自填推荐人「${row.declaredReferrer}」，系统没有推荐人记录`);
      else if (!sysNames.some((n) => n && (n.includes(declared) || declared.includes(n)))) flags.push(`自填推荐人「${row.declaredReferrer}」与系统归属（${ref?.name || user.referrerCode || '—'}）不一致`);
    }
    if (row.kind === 'owner' && !user.selfIdentity?.confirmed) flags.push('店主身份为自报，待后台确认');
    if (row.kind === 'agent' && !user.selfIdentity?.confirmed) flags.push('代理身份为自报，待后台确认（区域、资格以代理协议为准）');
  }
  if (row.kind === 'owner' && row.storeName) {
    const name = row.storeName.replace(/\s/g, '');
    const owners = experiencePointsWithOwners();
    for (const p of listExperiencePointViews()) {
      const n = p.name.replace(/[（(].*?[)）]/g, '').replace(/\s/g, '');
      if (n.length >= 2 && (name.includes(n) || n.includes(name))) {
        const ids = owners.find((o) => o.id === p.id)?.ownerMemberIds || [];
        flags.push(ids.length && row.memberId && !ids.includes(row.memberId) ? `与已有体验点「${p.name}」重名，系统负责人不是本会员` : `与已有体验点「${p.name}」重名，请确认是否同一家`);
      }
    }
    for (const a of listActiveStoreApplicationsForNotify()) {
      const n = String(a.name || '').replace(/\s/g, '');
      if (n.length >= 2 && (name.includes(n) || n.includes(name)) && row.memberId && a.applicantId !== row.memberId && !a.participants.some((x) => x.userId === row.memberId)) {
        flags.push(`与已开通门店「${a.name}」重名，该门店申请人／合伙人不是本会员`);
      }
    }
  }
  if (row.city && row.address && !row.address.includes(row.city)) flags.push(`填写城市「${row.city}」与地址不一致`);
  return Array.from(new Set(flags));
}

export function submitStoreProfile(id: string) {
  return mutate((s) => {
    const row = s.profiles.find((p) => p.id === id);
    if (!row) throw new Error('资料不存在');
    row.status = 'submitted';
    row.submittedAt = now();
    row.updatedAt = now();
    row.flags = crossCheck(row);
    return { ...row };
  });
}

// 地址定位（异步，不阻塞回复）；结果标 approximate
export async function geocodeStoreProfile(id: string) {
  const row = getStoreProfile(id);
  if (!row?.address) return null;
  const hit = await geocodeCn(row.address, row.city);
  if (!hit) return null;
  return mutate((s) => {
    const r = s.profiles.find((p) => p.id === id);
    if (!r || r.address !== row.address) return null;
    r.lat = hit.lat;
    r.lng = hit.lng;
    r.geoStatus = 'approximate';
    r.geoHint = `自动定位：${hit.name}（${hit.address}）`;
    if (!r.district && hit.district) r.district = hit.district;
    if (!r.city && hit.city) r.city = hit.city.replace(/市$/, '');
    return { ...r };
  });
}

// 后台审核：通过 → 新建体验点或并入已有体验点（只改体验点地址资料，不动归属／分润）
export function reviewStoreProfile(id: string, action: 'approve' | 'reject', opts: { pointId?: string; note?: string; photoIds?: string[]; visible?: boolean }, by: number) {
  return mutate((s) => {
    const row = s.profiles.find((p) => p.id === id);
    if (!row) throw new Error('资料不存在');
    row.reviewedAt = now();
    row.reviewNote = String(opts.note || '').slice(0, 200);
    if (action === 'reject') { row.status = 'rejected'; return { ...row }; }
    if (row.kind !== 'owner') { row.status = 'approved'; return { ...row }; }
    const photos = row.photos.filter((p) => p.status === 'ok' && (!opts.photoIds || opts.photoIds.includes(p.id))).map((p) => `${row.id}/${p.id}`);
    const fields: PointOverride = {
      ...(row.address ? { publicAddress: row.address, geoStatus: row.lat !== null ? 'approximate' : 'missing' } : {}),
      ...(row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : {}),
      ...(row.district ? { district: row.district } : {}),
      ...(row.hours ? { hours: row.hours } : {}),
      ...(row.businessModel ? { businessModel: row.businessModel } : {}),
      ...(photos.length ? { photos } : {}),
      geoNote: `店主自报（${row.submittedAt?.slice(0, 10) || ''}）后台通过；坐标为自动定位，确认后可改 precise`,
      updatedAt: now(),
      updatedBy: by,
    };
    const target = opts.pointId && (EXPERIENCE_POINT_DIRECTORY.some((p) => p.id === opts.pointId) || s.added.some((p) => p.id === opts.pointId)) ? opts.pointId : '';
    if (target) {
      const cur = listExperiencePointViews(s).find((v) => v.id === target);
      if (cur && cur.address && cur.address === row.address) { delete fields.publicAddress; delete fields.geoStatus; delete fields.lat; delete fields.lng; delete fields.geoNote; }
      if (fields.photos) fields.photos = Array.from(new Set([...(s.overrides[target]?.photos || []), ...fields.photos])).slice(-MAX_PHOTOS);
      s.overrides[target] = { ...(s.overrides[target] || {}), ...fields };
      row.pointId = target;
    } else {
      const pid = `owner-${row.id}`;
      if (!s.added.some((p) => p.id === pid)) {
        s.added.push({ id: pid, city: row.city || '', kefuLabel: row.storeName || '合作体验点', operator: row.storeName || '', publicAddress: row.address, source: `店主自报 ${row.id}`, visible: opts.visible !== false });
      }
      s.overrides[pid] = { ...(s.overrides[pid] || {}), ...fields, visible: opts.visible !== false };
      row.pointId = pid;
    }
    row.status = 'approved';
    return { ...row };
  });
}

// 照片是否可公开：已通过并被体验点引用
export function isPhotoPublic(profileId: string, photoId: string) {
  const s = readState();
  const ref = `${profileId}/${photoId}`;
  return Object.values(s.overrides).some((o) => (o.photos || []).includes(ref));
}

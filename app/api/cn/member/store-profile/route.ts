import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { findLocalCnUserById } from '@/lib/local-cn-users';
import {
  findLatestProfile,
  findOpenProfile,
  geocodeStoreProfile,
  getStoreProfile,
  photoUrl,
  removeProfilePhoto,
  submitStoreProfile,
  upsertStoreProfile,
  type StoreProfile,
} from '@/lib/local-cn-experience-points';
import { PHOTO_MAX_BYTES, saveUploadedPhoto } from '@/lib/store-profile-photos';
import { notifyStoreProfileSubmitted } from '@/lib/store-profile-notify';

// 店主／代理自填门店资料：只写自填资料（店主自报，待后台确认），不改会员推荐归属、分账或门店申请。
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };

function member(request: NextRequest) {
  const session = getRequestSession(request);
  if (!session || !(session.id > 0) || session.role !== 'member') return null;
  const user = findLocalCnUserById(session.id);
  return { id: session.id, openid: user?.wechatOfficialOpenId || null, identity: user?.selfIdentity || null };
}

const kindOf = (v: unknown): StoreProfile['kind'] => (v === 'agent' ? 'agent' : 'owner');

function view(p: StoreProfile | null) {
  if (!p) return null;
  return {
    id: p.id, kind: p.kind, storeName: p.storeName, city: p.city, address: p.address, district: p.district,
    businessModel: p.businessModel, hours: p.hours, company: p.company, coverage: p.coverage, declaredReferrer: p.declaredReferrer,
    status: p.status, reviewNote: p.status === 'rejected' ? p.reviewNote : '', submittedAt: p.submittedAt, updatedAt: p.updatedAt,
    photos: p.photos.filter((x) => x.status !== 'failed').map((x) => ({ id: x.id, status: x.status, url: x.status === 'ok' ? photoUrl(`${p.id}/${x.id}`) : '' })),
  };
}

export async function GET(request: NextRequest) {
  const m = member(request);
  if (!m) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  const q = { memberId: m.id, openid: m.openid };
  const owner = findOpenProfile({ ...q, kind: 'owner' }) || findLatestProfile({ ...q, kind: 'owner' });
  const agent = findOpenProfile({ ...q, kind: 'agent' }) || findLatestProfile({ ...q, kind: 'agent' });
  const t = m.identity?.type;
  return NextResponse.json({ identity: t === 'agent' || t === 'owner' ? t : '', owner: view(owner), agent: view(agent) }, { headers: noStore });
}

function editable(m: NonNullable<ReturnType<typeof member>>, kind: StoreProfile['kind']) {
  // 已通过／已退回的资料保留存档；再次填写开新的一份
  return findOpenProfile({ memberId: m.id, openid: m.openid, kind });
}

export async function POST(request: NextRequest) {
  const m = member(request);
  if (!m) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  const type = request.headers.get('content-type') || '';
  try {
    if (type.startsWith('multipart/form-data')) {
      const form = await request.formData();
      const kind = kindOf(form.get('kind'));
      const file = form.get('photo');
      if (!(file instanceof Blob)) return NextResponse.json({ error: '请选择照片' }, { status: 400, headers: noStore });
      if (file.size > PHOTO_MAX_BYTES) return NextResponse.json({ error: '图片太大（上限 6MB）' }, { status: 400, headers: noStore });
      const row = editable(m, kind) || upsertStoreProfile({ memberId: m.id, openid: m.openid, kind, source: 'web' }, {});
      saveUploadedPhoto(row.id, Buffer.from(await file.arrayBuffer()));
      return NextResponse.json({ ok: true, profile: view(getStoreProfile(row.id)) }, { headers: noStore });
    }
    const body = await request.json().catch(() => ({}));
    const kind = kindOf(body.kind);
    const s = (k: string, max = 60) => (typeof body[k] === 'string' ? body[k].trim().slice(0, max) : undefined);
    const patch: Partial<StoreProfile> = kind === 'owner'
      ? { storeName: s('storeName'), city: s('city', 20), address: s('address', 120), businessModel: s('businessModel', 20), hours: s('hours'), declaredReferrer: s('declaredReferrer', 30) }
      : { city: s('city', 20), company: s('company'), coverage: s('coverage', 120), declaredReferrer: s('declaredReferrer', 30) };
    Object.keys(patch).forEach((k) => (patch as Record<string, unknown>)[k] === undefined && delete (patch as Record<string, unknown>)[k]);
    const prev = editable(m, kind);
    // 地址没改时保留原定位
    if (prev && patch.address === prev.address) delete patch.address;
    if (kind === 'owner' && body.submit) {
      const addr = patch.address ?? prev?.address ?? '';
      if (!(patch.storeName ?? prev?.storeName) || addr.length < 6) return NextResponse.json({ error: '请填写门店名称和完整地址（省市区＋街道门牌）' }, { status: 400, headers: noStore });
    }
    if (kind === 'agent' && body.submit && !(patch.city ?? prev?.city)) return NextResponse.json({ error: '请填写所在城市' }, { status: 400, headers: noStore });
    let row = upsertStoreProfile({ memberId: m.id, openid: m.openid, kind, source: 'web' }, patch);
    if (body.submit) { row = submitStoreProfile(row.id); void notifyStoreProfileSubmitted(row); }
    if (kind === 'owner' && row.address && row.lat === null) void geocodeStoreProfile(row.id);
    return NextResponse.json({ ok: true, profile: view(row) }, { headers: noStore });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '保存失败' }, { status: 400, headers: noStore });
  }
}

export async function DELETE(request: NextRequest) {
  const m = member(request);
  if (!m) return NextResponse.json({ error: '请先登录' }, { status: 401, headers: noStore });
  const kind = kindOf(request.nextUrl.searchParams.get('kind'));
  const photoId = request.nextUrl.searchParams.get('photo') || '';
  const row = editable(m, kind);
  if (!row || !photoId) return NextResponse.json({ error: '找不到照片' }, { status: 404, headers: noStore });
  return NextResponse.json({ ok: true, profile: view(removeProfilePhoto(row.id, photoId)) }, { headers: noStore });
}

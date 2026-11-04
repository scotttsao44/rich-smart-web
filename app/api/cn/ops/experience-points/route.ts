import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { geocodeAddressForAdmin, listExperiencePointViews, listStoreProfiles, reviewStoreProfile, updateExperiencePoint } from '@/lib/local-cn-experience-points';
import { findLocalCnUserById } from '@/lib/local-cn-users';

export const dynamic = 'force-dynamic';

function payload() {
  const profiles = listStoreProfiles().slice(0, 200).map((p) => ({
    ...p,
    openid: p.openid ? `…${p.openid.slice(-4)}` : null,
    memberName: p.memberId ? findLocalCnUserById(p.memberId)?.name || `会员 ${p.memberId}` : '',
    photos: p.photos.map((ph) => ({ ...ph, mediaId: undefined, url: ph.status === 'ok' ? `/api/cn/experience-points/photo?p=${p.id}&f=${ph.id}` : '' })),
  }));
  return { points: listExperiencePointViews(), profiles };
}

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401 });
  return NextResponse.json(payload(), { headers: { 'Cache-Control': 'no-store' } });
}

// { action: 'update', id, patch } | { action: 'geocode', address, city } | { action: 'review', profileId, decision, pointId?, photoIds?, note?, visible? }
export async function POST(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!user || !hasPlatformAdminAccess(user)) return NextResponse.json({ error: '需要平台管理员权限' }, { status: user ? 403 : 401 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === 'update') {
      updateExperiencePoint(String(body.id || ''), body.patch && typeof body.patch === 'object' ? body.patch : {}, user.id);
      return NextResponse.json({ ok: true, ...payload() });
    }
    if (body.action === 'geocode') {
      const hit = await geocodeAddressForAdmin(String(body.address || ''), String(body.city || ''));
      return NextResponse.json({ ok: Boolean(hit), hit });
    }
    if (body.action === 'review') {
      const decision = body.decision === 'approve' ? 'approve' : 'reject';
      reviewStoreProfile(String(body.profileId || ''), decision, {
        pointId: body.pointId ? String(body.pointId) : undefined,
        photoIds: Array.isArray(body.photoIds) ? body.photoIds.map(String) : undefined,
        note: String(body.note || ''),
        visible: body.visible !== false,
      }, user.id);
      return NextResponse.json({ ok: true, ...payload() });
    }
    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400 });
  }
}

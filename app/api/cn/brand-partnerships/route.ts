import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { acceptPartnership, createPartnership, listPartnerships, updatePartnership } from '@/lib/local-cn-commerce';
import { getApprovedBrandForUser, listApprovedBrands } from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const ownedBrand = hasPlatformAdminAccess(user) ? null : getApprovedBrandForUser(user.id);
  if (!hasPlatformAdminAccess(user) && !ownedBrand) return NextResponse.json({ error: '无权查看品牌合作' }, { status: 403 });
  const brandId = ownedBrand?.id || Number(request.nextUrl.searchParams.get('brandId') || 0);
  return NextResponse.json({ partnerships: listPartnerships(brandId || undefined) });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const ownedBrand = hasPlatformAdminAccess(user) ? null : getApprovedBrandForUser(user.id);
  if (!hasPlatformAdminAccess(user) && !ownedBrand) return NextResponse.json({ error: '无权建立品牌合作' }, { status: 403 });
  try {
    const body = await request.json();
    const referrerBrandId = ownedBrand?.id || Number(body.referrerBrandId);
    const ownerBrand = listApprovedBrands().find((brand) => brand.id === Number(body.ownerBrandId));
    if (!ownerBrand) throw new Error('找不到已审核通过的商品品牌');
    const now = new Date().toISOString();
    const partnership = createPartnership({
      referrerBrandId,
      referrerBrandName: String(body.referrerBrandName || ownedBrand?.brandName || user.name),
      ownerBrandId: ownerBrand.id,
      ownerBrandName: ownerBrand.brandName,
      status: 'pending',
      terms: String(body.terms || ''),
      rewardType: body.rewardType === 'fixed' ? 'fixed' : 'rate',
      rewardRate: Number(body.rewardRate || 0),
      rewardFixedAmount: Number(body.rewardFixedAmount || 0),
      startsAt: String(body.startsAt || now),
      endsAt: body.endsAt ? String(body.endsAt) : null,
      referrerAcceptedAt: ownedBrand ? now : null,
      ownerAcceptedAt: null,
      platformReviewedAt: null,
    }, user.id);
    return NextResponse.json({ partnership }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '合作建立失败' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const ownedBrand = hasPlatformAdminAccess(user) ? null : getApprovedBrandForUser(user.id);
  if (!hasPlatformAdminAccess(user) && !ownedBrand) return NextResponse.json({ error: '无权更新品牌合作' }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action === 'accept') {
      if (!ownedBrand) return NextResponse.json({ error: '请使用品牌账号接受合作' }, { status: 400 });
      const partnership = acceptPartnership(String(body.id), ownedBrand.id);
      return partnership ? NextResponse.json({ partnership }) : NextResponse.json({ error: '找不到合作' }, { status: 404 });
    }
    if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '只有平台可以审核或停用合作' }, { status: 403 });
    const status = String(body.status || '');
    if (!['pending', 'active', 'rejected', 'paused'].includes(status)) return NextResponse.json({ error: '合作状态不正确' }, { status: 400 });
    const existing = listPartnerships().find((entry) => entry.id === String(body.id));
    if (!existing) return NextResponse.json({ error: '找不到合作' }, { status: 404 });
    if (status === 'active' && (!existing.referrerAcceptedAt || !existing.ownerAcceptedAt)) return NextResponse.json({ error: '双方品牌接受后才能启用合作' }, { status: 400 });
    const partnership = updatePartnership(String(body.id), { status: status as any, platformReviewedAt: new Date().toISOString() }, user.id);
    return NextResponse.json({ partnership });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '合作更新失败' }, { status: 400 });
  }
}

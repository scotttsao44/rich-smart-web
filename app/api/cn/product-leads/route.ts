import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getApprovedBrandForUser, getPublicBrandProduct, isSharedDeviceProduct } from '@/lib/local-cn-brand-marketplace';
import { normalizeContactPhone } from '@/lib/international-phone';
import { readPendingReferralAttribution } from '@/lib/local-cn-referral-attribution';
import { findLocalCnUserByReferralCode } from '@/lib/local-cn-users';
import { createProductLead, listProductLeads } from '@/lib/local-cn-product-leads';

export const dynamic = 'force-dynamic';

function clean(value: unknown, max: number) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (hasPlatformAdminAccess(user) && request.nextUrl.searchParams.get('scope') !== 'brand') {
    return NextResponse.json({ leads: listProductLeads({ all: true }), scope: 'admin' });
  }
  const brand = getApprovedBrandForUser(user.id);
  if (!brand) return NextResponse.json({ leads: [], scope: 'none' });
  return NextResponse.json({ leads: listProductLeads({ brandId: brand.id }), scope: 'brand' });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const productId = Number(body?.productId || 0);
    const product = Number.isSafeInteger(productId) && productId > 0 ? getPublicBrandProduct(productId) : null;
    if (!product || !isSharedDeviceProduct(product)) return NextResponse.json({ error: '该商品不支持留资料洽谈' }, { status: 404 });
    const name = clean(body?.name, 40);
    const city = clean(body?.city, 40);
    const note = clean(body?.note, 300);
    if (!name || !city) return NextResponse.json({ error: '请填写姓名和所在城市' }, { status: 400 });
    let phone = '';
    try {
      phone = normalizeContactPhone(body?.phone);
    } catch {
      return NextResponse.json({ error: '请输入有效的手机号' }, { status: 400 });
    }

    const user = getRequestSession(request);
    let referrerMemberId: number | null = null;
    let referralCode: string | null = null;
    let attributionId: string | null = null;
    let linkId: string | null = null;
    let sourcePath: string | null = null;
    const refCode = clean(body?.ref, 100);
    if (refCode) {
      const owner = findLocalCnUserByReferralCode(refCode);
      if (owner) { referrerMemberId = owner.id; referralCode = owner.referralCode; }
    } else {
      const pending = readPendingReferralAttribution(request);
      if (pending?.referrerMemberId) {
        referrerMemberId = pending.referrerMemberId;
        attributionId = pending.attributionId || null;
        linkId = pending.linkId || null;
        sourcePath = pending.sourcePath || null;
      }
    }

    const { lead, duplicate } = createProductLead({
      productId: product.id,
      productName: product.name,
      brandId: product.brandId,
      brandName: product.brandName,
      name, phone, city, note,
      memberId: user?.id ?? null,
      referrerMemberId, referralCode, attributionId, linkId, sourcePath,
    });
    return NextResponse.json({ ok: true, id: lead.id, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '提交失败' }, { status: 400 });
  }
}

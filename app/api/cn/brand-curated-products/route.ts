import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { listCuratedProducts, saveCuratedProduct } from '@/lib/local-cn-commerce';
import { toPublicProduct } from '@/lib/product-public';
import { getApprovedBrandById, getApprovedBrandForUser, getPublicBrandProduct, listApprovedBrands } from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const brandId = Number(request.nextUrl.searchParams.get('brandId') || 0);
  const approvedBrandIds = new Set(listApprovedBrands().map((brand) => brand.id));
  const storedRows = listCuratedProducts(brandId);
  const rows = storedRows
    .filter((row) => Boolean(row.partnership && approvedBrandIds.has(row.partnership.ownerBrandId) && getPublicBrandProduct(row.entry.productId)))
    .map((row) => {
      const product = getPublicBrandProduct(row.entry.productId)!;
      const ownerBrand = getApprovedBrandById(product.brandId);
      return { ...row.entry, partnership: row.partnership, product: toPublicProduct({ ...product, brandSlug: ownerBrand?.slug || null }) };
    });
  return NextResponse.json({ brandId, curatedProducts: rows });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const ownedBrand = hasPlatformAdminAccess(user) ? null : getApprovedBrandForUser(user.id);
  if (!hasPlatformAdminAccess(user) && !ownedBrand) return NextResponse.json({ error: '无权管理推荐商品' }, { status: 403 });
  try {
    const body = await request.json();
    const referrerBrandId = ownedBrand?.id || Number(body.referrerBrandId);
    if (!getPublicBrandProduct(Number(body.productId))) return NextResponse.json({ error: '只能推荐平台已审核上架的商品' }, { status: 400 });
    const curatedProduct = saveCuratedProduct({ partnershipId: String(body.partnershipId || ''), productId: Number(body.productId), referrerBrandId, displayName: String(body.displayName || ''), sortOrder: Number(body.sortOrder || 0), enabled: body.enabled !== false }, user.id);
    return NextResponse.json({ curatedProduct }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '推荐商品保存失败' }, { status: 400 });
  }
}

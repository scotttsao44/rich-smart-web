import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { products } from '@/lib/schema';
import { desc, eq, ilike, or } from 'drizzle-orm';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { getVendorProductEditUrl } from '@/lib/vendor-product-review';
import { createBrandProduct, getApprovedBrandForUser, listBrandApplications, listBrandProducts } from '@/lib/local-cn-brand-marketplace';
import {
  brandPilotDbEnabled,
  createDbBrandProduct,
  getDbApprovedBrandForUser,
  listDbBrandProducts,
} from '@/lib/brand-pilot-db';

export const dynamic = 'force-dynamic';

function firstImage(product: typeof products.$inferSelect) {
  const images = Array.isArray(product.images) ? product.images : [];
  return typeof images[0] === 'string' ? images[0] : null;
}

function toVendorProductDto(product: typeof products.$inferSelect) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    imageUrl: firstImage(product),
    priceTwd: product.priceTwd == null ? null : String(product.priceTwd),
    stockQuantity: product.stockQuantity,
    supplierName: product.supplierName,
    commissionRate: product.commissionRate == null ? null : String(product.commissionRate),
    reviewStatus: product.reviewStatus,
    reviewNote: product.reviewNote,
    submittedAt: product.submittedAt,
    reviewedAt: product.reviewedAt,
    isActive: product.isActive,
    editUrl: product.reviewStatus === 'rejected' ? getVendorProductEditUrl(product.id) : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getFreshSessionUser(request);
    if (!user) {
      return NextResponse.json({ message: '请先登录厂商中心' }, { status: 401 });
    }

    if (!brandPilotDbEnabled()) {
      return NextResponse.json({
        brand: getApprovedBrandForUser(user.id),
        applications: listBrandApplications(user),
        products: listBrandProducts(user, 'mine').map((product) => ({
          ...product,
          editUrl: `/vendor/products/${product.id}/edit`,
        })),
      });
    }

    const brand = await getDbApprovedBrandForUser(user.id);
    if (brand) {
      const productList = await listDbBrandProducts(user, 'mine');
      return NextResponse.json({ brand, applications: [], products: productList.map((product) => ({
        ...product,
        editUrl: `/vendor/products/${product.id}/edit`,
      })) });
    }

    const fallbackMatches = [
      user.email ? ilike(products.supplierName, `%Email:${user.email}%`) : undefined,
    ].filter(Boolean);

    const productList = await db
      .select()
      .from(products)
      .where(or(eq(products.supplierId, user.id), ...fallbackMatches))
      .orderBy(desc(products.submittedAt), desc(products.id))
      .limit(100);

    return NextResponse.json({ brand: null, applications: [], products: productList.map(toVendorProductDto) });
  } catch (error) {
    console.error('Failed to fetch vendor products:', error);
    return NextResponse.json({ message: '读取厂商商品失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getFreshSessionUser(request).catch(() => null);
    if (!user) return NextResponse.json({ message: '请先登录品牌工作台' }, { status: 401 });
    const body = await request.json();

    if (!brandPilotDbEnabled()) {
      try {
        // 忽略客户端 autoApprove：仅平台管理员直接上架，其他账号一律待审核
        const { autoApprove: _clientAutoApprove, ...input } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
        const product = createBrandProduct(user, { ...input, autoApprove: hasPlatformAdminAccess(user) });
        return NextResponse.json({ productId: product.id, reviewStatus: product.reviewStatus, product, editUrl: null }, { status: 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : '商品提交审核失败';
        return NextResponse.json({ message }, { status: message.includes('重复') || message.includes('正在审核') ? 409 : 400 });
      }
    }

    try {
      const product = await createDbBrandProduct(user, body, false);
      return NextResponse.json({ productId: product.id, reviewStatus: product.reviewStatus, product, editUrl: null }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : '商品提交审核失败';
      return NextResponse.json({ message }, { status: message.includes('重复') || message.includes('正在审核') ? 409 : message.includes('无权') ? 403 : 400 });
    }
  } catch (error) {
    console.error('Vendor product submission failed:', error);
    return NextResponse.json({ message: '商品提交审核失败' }, { status: 500 });
  }
}

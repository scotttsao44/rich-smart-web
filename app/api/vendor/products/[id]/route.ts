import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { products } from '@/lib/schema';
import {
  buildSupplierInfo,
  parseSupplierInfo,
  verifyVendorProductToken,
} from '@/lib/vendor-product-review';
import { getFreshSessionUser, getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { listBrandProducts, updateBrandProduct } from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

function firstImage(product: typeof products.$inferSelect) {
  const images = Array.isArray(product.images) ? product.images : [];
  return typeof images[0] === 'string' ? images[0] : '';
}

function validateVendorFields(body: Record<string, unknown>) {
  const required = ['supplierName', 'supplierContact', 'name', 'priceTwd', 'stockQuantity', 'commissionRate', 'description'];
  for (const key of required) {
    if (!String(body[key] || '').trim()) return '请填写所有必填栏位';
  }

  const { contacts } = buildSupplierInfo(body);
  if (contacts.length === 0) return '请至少填写一種联系方式：电话、客服账号、微信或 Email';
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const productId = Number(params.id);
  const token = request.nextUrl.searchParams.get('token');

  if (!process.env.DATABASE_URL) {
    const user = getRequestSession(request);
    if (!user) return NextResponse.json({ message: '请先登录品牌工作台' }, { status: 401 });
    const product = listBrandProducts(user, 'mine').find((row) => row.id === productId);
    return product ? NextResponse.json({ product }) : NextResponse.json({ message: '找不到商品或无权查看' }, { status: 404 });
  }

  if (!productId || !verifyVendorProductToken(productId, token)) {
    return NextResponse.json({ message: '补件链接无效或已过期' }, { status: 401 });
  }

  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product) return NextResponse.json({ message: '找不到商品' }, { status: 404 });

  const supplier = parseSupplierInfo(product.supplierName);
  return NextResponse.json({
    product: {
      id: product.id,
      ...supplier,
      name: product.name,
      priceTwd: product.priceTwd,
      stockQuantity: product.stockQuantity,
      commissionRate: product.commissionRate,
      imageUrl: firstImage(product),
      description: product.description || '',
      reviewStatus: product.reviewStatus,
      reviewNote: product.reviewNote || '',
    },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const productId = Number(params.id);
  const token = request.nextUrl.searchParams.get('token');

  if (!process.env.DATABASE_URL) {
    const user = await getFreshSessionUser(request).catch(() => null);
    if (!user) return NextResponse.json({ message: '请先登录品牌工作台' }, { status: 401 });
    try {
      const current = listBrandProducts(user, 'mine').find((row) => row.id === productId);
      if (!current) return NextResponse.json({ message: '找不到商品或无权修改' }, { status: 404 });
      const rawBody = await request.json();
      // 忽略客户端 autoApprove：仅平台管理员可直接上架，其他账号沿用原审核状态（待审核仍为待审核）
      const { autoApprove: _clientAutoApprove, ...body } = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, any>;
      const autoApprove = hasPlatformAdminAccess(user);
      const updated = updateBrandProduct(user, productId, 'edit', { ...current, ...body, allowAnyStatus: true, autoApprove, priceCny: body.priceCny ?? body.priceTwd ?? current.priceCny });
      return NextResponse.json({
        productId: updated.id,
        reviewStatus: updated.reviewStatus,
        product: updated,
        revisionPending: Boolean(updated.pendingRevision),
        message: updated.pendingRevision
          ? '修改已提交平台审核；审核通过前商城继续显示当前上架版本。'
          : updated.status === 'approved' ? '商品修改已立即生效并同步至商城！' : '商品资料已更新并提交审核。',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '补件提交失败';
      return NextResponse.json({ message }, { status: message.includes('无权') ? 403 : 400 });
    }
  }

  if (!productId || !verifyVendorProductToken(productId, token)) {
    return NextResponse.json({ message: '补件链接无效或已过期' }, { status: 401 });
  }

  const [existing] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!existing) return NextResponse.json({ message: '找不到商品' }, { status: 404 });

  if (existing.reviewStatus === 'approved') {
    return NextResponse.json({ message: '此商品已审核通过，若需修改请联系平台管理员' }, { status: 409 });
  }

  const body = await request.json();
  const validationError = validateVendorFields(body);
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400 });

  const now = new Date();
  const { supplierName } = buildSupplierInfo(body);
  const [updated] = await db
    .update(products)
    .set({
      name: String(body.name).trim(),
      description: String(body.description).trim(),
      images: body.imageUrl ? [String(body.imageUrl).trim()] : [],
      priceTwd: String(body.priceTwd),
      stockQuantity: Number(body.stockQuantity || 0),
      supplierName,
      commissionRate: String(body.commissionRate),
      reviewStatus: 'pending',
      reviewNote: '厂商已补件，等待平台重新审核',
      submittedAt: now,
      isActive: false,
      updatedAt: now,
    })
    .where(eq(products.id, productId))
    .returning();

  return NextResponse.json({
    productId: updated.id,
    reviewStatus: updated.reviewStatus,
    message: '补件已提交，商品回到待审核状态。',
  });
}

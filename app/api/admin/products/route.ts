import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { outboundNotifications, products } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';
import { getFreshSessionUser, requireAdmin } from '@/lib/auth';
import { getVendorProductEditUrl } from '@/lib/vendor-product-review';
import { listBrandProducts, reviewBrandProduct, reviewBrandProductRevision, type LocalCnBrandProduct } from '@/lib/local-cn-brand-marketplace';
import { brandPilotDbEnabled, listDbBrandProducts, reviewDbBrandProduct } from '@/lib/brand-pilot-db';

export const dynamic = 'force-dynamic';

function toProductDto(product: typeof products.$inferSelect) {
  const images = Array.isArray(product.images) ? product.images : [];
  return {
    ...product,
    imageUrl: typeof images[0] === 'string' ? images[0] : null,
    priceCny: null,
  };
}

const REVISION_FIELD_LABELS: Record<string, string> = {
  name: '商品名称', category: '分类', description: '商品说明', imageUrl: '封面图', images: '商品图集', sku: 'SKU',
  compareAtPrice: '划线价', variants: '规格', shippingMethods: '配送方式', fulfillmentInfo: '发货说明',
  priceCny: '售价', priceTwd: '售价(TWD)', supplyPriceCny: '品牌结算价', stockQuantity: '库存',
  directRate: '直接推荐分润%', upperRate: '上层推荐分润%', activeRate: '销售贡献榜分润%', imageIsTest: '参考图标记', imageDisclosure: '图片说明',
  listingType: '商品类型', cooperationNote: '合作方式说明',
};

function revisionSummary(product: LocalCnBrandProduct) {
  const revision = product.pendingRevision;
  if (!revision || !revision.fields || !Object.keys(revision.fields).length) return null;
  const show = (value: unknown, key?: string) => {
    if (key === 'listingType') return value === 'shared_device' ? '共享设备（投放合作）' : '零售商品';
    if (value == null || value === '') return '（空）';
    if (Array.isArray(value)) return value.map((item) => (item && typeof item === 'object' ? `${(item as any).name}: ${((item as any).values || []).join('/')}` : String(item))).join('，') || '（空）';
    return String(value);
  };
  return {
    submittedAt: revision.submittedAt,
    submittedBy: revision.submittedBy,
    submittedByName: revision.submittedByName || '',
    changes: Object.keys(revision.fields).filter((key) => key !== 'priceTwd').map((key) => ({
      key,
      label: REVISION_FIELD_LABELS[key] || key,
      before: show(revision.before?.[key], key),
      after: show(revision.fields[key], key),
    })),
  };
}

function toSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '') || `product-${Date.now()}`;
}

export async function GET(request: NextRequest) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;
    const reviewer = await getFreshSessionUser(request);

    if (brandPilotDbEnabled()) {
      const productList = await listDbBrandProducts(reviewer!, 'review');
      return NextResponse.json(productList.map((product) => ({
        ...product,
        editUrl: product.reviewStatus === 'rejected' ? `/vendor/products/${product.id}/edit` : null,
      })));
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(listBrandProducts(reviewer!, 'review').map((product) => ({
        ...product,
        pendingRevision: revisionSummary(product),
        editUrl: product.reviewStatus === 'rejected' ? `/vendor/products/${product.id}/edit` : null,
      })));
    }

    const productList = await db.select().from(products).orderBy(desc(products.id));
    return NextResponse.json(productList.map((product) => ({
      ...toProductDto(product),
      editUrl: product.reviewStatus === 'rejected'
        ? getVendorProductEditUrl(product.id)
        : null,
    })));
  } catch (error) {
    console.error('Failed to fetch products:', error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    if (brandPilotDbEnabled()) {
      return NextResponse.json({ error: '品牌 Pilot 请由品牌提交商品，再由平台审核' }, { status: 400 });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: '本地模式请由品牌提交商品，再由平台审核' }, { status: 400 });
    }

    const body = await request.json();
    const [product] = await db.insert(products).values({
      name: body.name,
      slug: body.slug || toSlug(body.name || 'product'),
      description: body.description,
      images: body.imageUrl ? [body.imageUrl] : [],
      priceTwd: body.priceTwd ? String(body.priceTwd) : '0',
      supplierName: body.supplierName || '糙米科技',
      commissionRate: body.commissionRate ? String(body.commissionRate) : '0',
      reviewStatus: body.reviewStatus || 'approved',
      reviewNote: body.reviewNote || null,
      reviewedAt: body.reviewStatus === 'approved' ? new Date() : null,
      stockQuantity: body.stockQuantity ?? 0,
      isActive: body.isActive ?? true,
    }).returning();
    return NextResponse.json(toProductDto(product));
  } catch (error) {
    console.error('Failed to create product:', error);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;
    const reviewer = await getFreshSessionUser(request).catch(() => null);

    const body = await request.json();
    const { id, ...data } = body;
    if (!id) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }
    if (!process.env.DATABASE_URL && data.revisionDecision) {
      // 审核已上架商品的待审核修改：通过则套用，驳回则丢弃（线上版本不变）
      const revisionDecision = String(data.revisionDecision || '') as 'approved' | 'rejected';
      if (!['approved', 'rejected'].includes(revisionDecision)) return NextResponse.json({ error: '请选择通过或驳回修改' }, { status: 400 });
      try {
        const updated = reviewBrandProductRevision(reviewer!, Number(id), revisionDecision, String(data.reviewNote || ''));
        return NextResponse.json({ ...updated, pendingRevision: null, editUrl: null });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : '审核修改失败' }, { status: 400 });
      }
    }
    if (!process.env.DATABASE_URL) {
      const decision = String(data.reviewStatus || '') as 'approved' | 'rejected';
      if (!['approved', 'rejected'].includes(decision)) return NextResponse.json({ error: '请选择通过或退回' }, { status: 400 });
      const updated = reviewBrandProduct(reviewer!, Number(id), decision, String(data.reviewNote || ''));
      return NextResponse.json({ ...updated, editUrl: updated.reviewStatus === 'rejected' ? `/vendor/products/${updated.id}/edit` : null });
    }
    if (brandPilotDbEnabled()) {
      const decision = String(data.reviewStatus || '') as 'approved' | 'rejected';
      if (!['approved', 'rejected'].includes(decision)) return NextResponse.json({ error: '请选择通过或退回' }, { status: 400 });
      const updated = await reviewDbBrandProduct(reviewer!, Number(id), decision, String(data.reviewNote || ''));
      return NextResponse.json({ ...updated, editUrl: updated.reviewStatus === 'rejected' ? `/vendor/products/${updated.id}/edit` : null });
    }

    await db.update(products).set({
      name: data.name,
      slug: data.slug || (data.name ? toSlug(data.name) : undefined),
      description: data.description,
      images: data.imageUrl ? [data.imageUrl] : undefined,
      priceTwd: data.priceTwd ? String(data.priceTwd) : undefined,
      supplierName: data.supplierName,
      commissionRate: data.commissionRate ? String(data.commissionRate) : undefined,
      reviewStatus: data.reviewStatus,
      reviewNote: data.reviewNote,
      reviewedAt: data.reviewStatus === 'approved' || data.reviewStatus === 'rejected' ? new Date() : undefined,
      reviewedBy: reviewer?.id,
      stockQuantity: data.stockQuantity ?? 0,
      isActive: data.reviewStatus === 'approved' ? (data.isActive ?? true) : false,
      updatedAt: new Date(),
    }).where(eq(products.id, id));

    const [updated] = await db.select().from(products).where(eq(products.id, id));
    const editUrl = updated?.reviewStatus === 'rejected'
      ? getVendorProductEditUrl(updated.id)
      : null;

    if (updated?.supplierId && (updated.reviewStatus === 'approved' || updated.reviewStatus === 'rejected')) {
      await db.insert(outboundNotifications).values({
        userId: updated.supplierId,
        provider: 'line',
        templateKey: updated.reviewStatus === 'approved' ? 'vendor_product_approved' : 'vendor_product_rejected',
        payload: {
          productId: updated.id,
          productName: updated.name,
          reviewStatus: updated.reviewStatus,
          reviewNote: updated.reviewNote || '',
          editUrl,
          message: updated.reviewStatus === 'approved'
            ? `您的商品「${updated.name}」已审核通过並公开上架。`
            : `您的商品「${updated.name}」已退回补件，请查看退回原因並重新提交审核。`,
        },
        status: 'pending',
      });
    }

    return NextResponse.json({ ...toProductDto(updated), editUrl });
  } catch (error) {
    console.error('Failed to update product:', error);
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  let productId: number | undefined;
  try {
    const unauthorized = await requireAdmin(request);
    if (unauthorized) return unauthorized;

    const body = await request.json();
    const { id } = body;
    productId = id;
    if (!id) {
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }
    await db.delete(products).where(eq(products.id, id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === '23503' && productId) {
      await db
        .update(products)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(products.id, productId));
      return NextResponse.json({ success: true, softDeleted: true });
    }
    console.error('Failed to delete product:', error);
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 });
  }
}

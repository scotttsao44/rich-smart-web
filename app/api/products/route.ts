import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { products } from '@/lib/schema';
import { isPlaceholderProduct } from '@/lib/catalog';
import { toPublicProduct } from '@/lib/product-public';
import { and, eq, gt } from 'drizzle-orm';
import { getApprovedBrandById, listPublicBrandProducts } from '@/lib/local-cn-brand-marketplace';
import { listDbPublicBrandProducts } from '@/lib/brand-pilot-db';

export const dynamic = 'force-dynamic';

function localPublicProducts() {
  return listPublicBrandProducts().map((product) => {
    const brand = getApprovedBrandById(product.brandId);
    return toPublicProduct({ ...product, brandSlug: brand?.slug || null });
  });
}

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(localPublicProducts());
  }

  try {
    const dbBrandProducts = (await listDbPublicBrandProducts()).filter((product) => !isPlaceholderProduct(product));
    if (dbBrandProducts.length > 0) {
      return NextResponse.json(dbBrandProducts.map(toPublicProduct));
    }

    const productList = await db
      .select()
      .from(products)
      .where(and(eq(products.isActive, true), eq(products.reviewStatus, 'approved'), gt(products.stockQuantity, 0)));

    const visibleProducts = productList.filter((product) => !isPlaceholderProduct(product));
    return NextResponse.json(
      visibleProducts.length > 0
        ? visibleProducts.map(toPublicProduct)
        : localPublicProducts()
    );
  } catch (error) {
    console.error('Failed to fetch products:', error);
    return NextResponse.json(localPublicProducts());
  }
}

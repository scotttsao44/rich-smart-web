import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { products } from '@/lib/schema';
import { isPlaceholderProduct } from '@/lib/catalog';
import { getApprovedBrandById, getPublicBrandProduct } from '@/lib/local-cn-brand-marketplace';
import { getDbPublicBrandProduct } from '@/lib/brand-pilot-db';
import { PublicProduct, toPublicProduct } from '@/lib/product-public';

export function parsePublicProductId(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function getPublicProductById(id: number): Promise<PublicProduct | null> {
  const localProduct = getPublicBrandProduct(id);
  if (localProduct) {
    const brand = getApprovedBrandById(localProduct.brandId);
    return toPublicProduct({ ...localProduct, brandSlug: brand?.slug || null });
  }

  if (!process.env.DATABASE_URL) return null;

  const dbBrandProduct = await getDbPublicBrandProduct(id);
  if (dbBrandProduct && !isPlaceholderProduct(dbBrandProduct)) return toPublicProduct(dbBrandProduct);

  const result = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.isActive, true), eq(products.reviewStatus, 'approved'), gt(products.stockQuantity, 0)))
    .limit(1);

  const product = result[0];
  if (!product || isPlaceholderProduct(product)) return null;
  return toPublicProduct(product);
}

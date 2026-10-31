export interface PublicProduct {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceTwd: string | null;
  priceCny: string | null;
  stockQuantity: number | null;
  supplierName: string | null;
  supplierId?: number | null;
  brandId?: number | null;
  brandName?: string | null;
  brandSlug?: string | null;
  imageIsTest?: boolean;
  imageDisclosure?: string;
  fulfillmentInfo?: string;
  category?: string;
  sold?: number;
  rating?: string;
  tag?: string;
}

export function normalizeProductImageUrl(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (text.startsWith('/')) return text;

  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    return null;
  }

  return null;
}

export function firstProductImage(product: { imageUrl?: unknown; images?: unknown }) {
  const direct = normalizeProductImageUrl(product.imageUrl);
  if (direct) return direct;

  const images = Array.isArray(product.images) ? product.images : [];
  return normalizeProductImageUrl(images[0]);
}

export function toPublicProduct(product: {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: unknown;
  images?: unknown;
  priceTwd?: unknown;
  priceCny?: unknown;
  stockQuantity?: number | null;
  supplierName?: string | null;
  supplierId?: number | null;
  brandId?: number | null;
  brandName?: string | null;
  brandSlug?: string | null;
  imageIsTest?: boolean | null;
  imageDisclosure?: string | null;
  fulfillmentInfo?: string | null;
  category?: string | null;
  sold?: number | null;
  rating?: string | null;
  tag?: string | null;
}): PublicProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description ?? null,
    imageUrl: firstProductImage(product),
    priceTwd: product.priceTwd == null ? null : String(product.priceTwd),
    priceCny: product.priceCny == null ? null : String(product.priceCny),
    stockQuantity: product.stockQuantity ?? null,
    supplierName: product.supplierName ?? null,
    supplierId: product.supplierId ?? null,
    brandId: product.brandId ?? product.supplierId ?? null,
    brandName: product.brandName ?? product.supplierName ?? null,
    brandSlug: product.brandSlug ?? null,
    imageIsTest: Boolean(product.imageIsTest),
    imageDisclosure: product.imageDisclosure || undefined,
    fulfillmentInfo: product.fulfillmentInfo || undefined,
    category: product.category || undefined,
    sold: product.sold ?? undefined,
    rating: product.rating || undefined,
    tag: product.tag || undefined,
  };
}

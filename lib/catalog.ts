export const fallbackProducts = [];

export function isPlaceholderProduct(product: {
  name?: string | null;
  slug?: string | null;
  imageUrl?: string | null;
  images?: unknown;
  imageIsTest?: boolean | null;
  imageDisclosure?: string | null;
  sku?: string | null;
  tag?: string | null;
}) {
  const name = String(product.name || '').trim();
  const slug = String(product.slug || '').trim().toLowerCase();
  const sku = String(product.sku || '').trim().toLowerCase();
  const disclosure = String(product.imageDisclosure || '').trim();
  const tag = String(product.tag || '').trim().toLowerCase();
  const imageCandidates = [
    product.imageUrl,
    ...(Array.isArray(product.images) ? product.images : []),
  ].map((value) => String(value || '').trim().toLowerCase());

  return product.imageIsTest === true
    || name === '测试商品'
    || name === '測試商品'
    || name.startsWith('测试')
    || name.startsWith('測試')
    || /^test[\s_-]/i.test(name)
    || /(^|[\s_-])test($|[\s_-])/i.test(name)
    || slug === 'test-product-001'
    || slug.startsWith('test-')
    || sku.startsWith('test-')
    || disclosure.includes('参考图')
    || disclosure.includes('參考圖')
    || tag === 'test'
    || imageCandidates.some((value) => value.includes('example.com/assets/test-'));
}

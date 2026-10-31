export const SHOP_ALL_CATEGORY = '全部';
export const SHOP_PERSONAL_HEALTH_CATEGORY = '根据我的健康状况推荐';
export const SHOP_GUEST_HEALTH_CATEGORY = '健康优选';
export const SHOP_UNCATEGORIZED_CATEGORY = '会员服务';

export type ShopCategoryProduct = {
  name?: string | null;
  description?: string | null;
  category?: string | null;
};

const healthSourceCategories = [
  '日常营养',
  '肠道营养',
  '营养管理',
  '滋补营养',
  '酵素调理',
  '益生菌',
  '代餐管理',
  '酵素饮品',
];

const preferredProductCategories = [
  ...healthSourceCategories,
  '人参肽饮',
];

const canonicalCategories = [
  SHOP_ALL_CATEGORY,
  SHOP_PERSONAL_HEALTH_CATEGORY,
  SHOP_GUEST_HEALTH_CATEGORY,
  SHOP_UNCATEGORIZED_CATEGORY,
  ...preferredProductCategories,
];

const canonicalByCompact = new Map(
  canonicalCategories.map((category) => [compactCategoryKey(category), category]),
);

export function compactCategoryKey(value: string) {
  return value.replace(/[\s\u00a0\u3000]+/g, '');
}

export function normalizeShopCategory(value: unknown, fallback = SHOP_UNCATEGORIZED_CATEGORY) {
  const normalized = String(value ?? '').replace(/[\s\u00a0\u3000]+/g, ' ').trim();
  if (!normalized) return fallback;
  return canonicalByCompact.get(compactCategoryKey(normalized)) || normalized;
}

export function productShopCategory(product: ShopCategoryProduct) {
  return normalizeShopCategory(product.category);
}

export function isShopHealthCategory(category: string) {
  const normalized = normalizeShopCategory(category, category);
  return normalized === SHOP_PERSONAL_HEALTH_CATEGORY || normalized === SHOP_GUEST_HEALTH_CATEGORY;
}

export function shopCategoryIsActive(current: string, candidate: string) {
  const normalizedCurrent = normalizeShopCategory(current, current);
  const normalizedCandidate = normalizeShopCategory(candidate, candidate);
  return normalizedCurrent === normalizedCandidate
    || (isShopHealthCategory(normalizedCurrent) && isShopHealthCategory(normalizedCandidate));
}

export function shopCategoryMatchesProduct(activeCategory: string, productCategory: string) {
  const normalizedActive = normalizeShopCategory(activeCategory, activeCategory);
  const normalizedProductCategory = normalizeShopCategory(productCategory);
  if (normalizedActive === SHOP_ALL_CATEGORY) return true;
  if (isShopHealthCategory(normalizedActive)) return healthSourceCategories.includes(normalizedProductCategory);
  return normalizedProductCategory === normalizedActive;
}

export function buildVisibleShopCategories(products: ShopCategoryProduct[], hasPersonalHealthContext: boolean) {
  const available = new Set(products.map(productShopCategory));
  const healthLabel = hasPersonalHealthContext ? SHOP_PERSONAL_HEALTH_CATEGORY : SHOP_GUEST_HEALTH_CATEGORY;
  const visible = [SHOP_ALL_CATEGORY];
  if (healthSourceCategories.some((category) => available.has(category))) visible.push(healthLabel);

  for (const category of preferredProductCategories) {
    if (available.has(category)) visible.push(category);
  }

  const preferred = new Set(preferredProductCategories);
  const remaining = Array.from(available)
    .filter((category) => !preferred.has(category))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  visible.push(...remaining);

  return visible;
}

export function resolveActiveShopCategory(requestedCategory: string, visibleCategories: string[]) {
  const requested = normalizeShopCategory(requestedCategory || SHOP_ALL_CATEGORY, SHOP_ALL_CATEGORY);
  return visibleCategories.find((category) => shopCategoryIsActive(requested, category)) || SHOP_ALL_CATEGORY;
}

export function filterShopProducts(products: ShopCategoryProduct[], activeCategory: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return products.filter((product) => {
    const category = productShopCategory(product);
    const matchesCategory = shopCategoryMatchesProduct(activeCategory, category);
    const matchesQuery = !normalizedQuery
      || String(product.name || '').toLowerCase().includes(normalizedQuery)
      || String(product.description || '').toLowerCase().includes(normalizedQuery)
      || category.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });
}

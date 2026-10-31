export const productFieldLabels = {
  name: '商品名称', category: '商品分类', priceCny: '售价', compareAtPrice: '划线价',
  supplyPriceCny: '品牌结算价', stockQuantity: '库存数量', imageUrl: '商品图片网址',
  description: '商品说明', fulfillmentInfo: '发货方式与时效',
  directRate: '直接推荐人比例', upperRate: '上层推荐人比例', activeRate: '销售贡献榜比例',
} as const;

export function validateProductForm(form: Record<string, unknown>) {
  const errors: Partial<Record<keyof typeof productFieldLabels, string>> = {};
  const text = (key: string) => typeof form[key] === 'string' ? (form[key] as string).trim() : '';
  for (const key of ['name', 'category', 'description', 'fulfillmentInfo'] as const) {
    if (!text(key)) errors[key] = `请填写${productFieldLabels[key]}`;
  }
  for (const key of ['priceCny', 'supplyPriceCny', 'stockQuantity', 'directRate', 'upperRate', 'activeRate'] as const) {
    const value = Number(form[key]);
    if (!text(key) || !Number.isFinite(value)) errors[key] = `请填写有效的${productFieldLabels[key]}`;
  }
  const price = Number(form.priceCny), supply = Number(form.supplyPriceCny), stock = Number(form.stockQuantity);
  if (!errors.priceCny && price <= 0) errors.priceCny = '售价必须大于 0';
  if (!errors.supplyPriceCny && (supply < 0 || (!errors.priceCny && supply >= price))) errors.supplyPriceCny = '品牌结算价须大于或等于 0，且低于售价';
  if (!errors.stockQuantity && (!Number.isInteger(stock) || stock < 0)) errors.stockQuantity = '库存须为大于或等于 0 的整数';
  if (text('compareAtPrice') && (!Number.isFinite(Number(form.compareAtPrice)) || Number(form.compareAtPrice) <= price)) errors.compareAtPrice = '划线价必须高于售价';
  const rates = ['directRate', 'upperRate', 'activeRate'] as const;
  for (const key of rates) if (!errors[key] && (Number(form[key]) < 0 || Number(form[key]) > 100)) errors[key] = '分润比例须介于 0% 至 100%';
  if (rates.every((key) => !errors[key]) && Math.abs(rates.reduce((sum, key) => sum + Number(form[key]), 0) - 100) > 0.001) errors.directRate = '三项分润比例合计必须等于 100%';
  const image = text('imageUrl');
  if (image && !image.startsWith('/') && !/^https?:\/\//.test(image)) errors.imageUrl = '图片须为持久网址或站内路径，不能使用 data URL';
  return errors;
}

const draftKeys = ['name', 'category', 'sku', 'priceCny', 'compareAtPrice', 'supplyPriceCny', 'stockQuantity', 'imageUrl', 'description', 'variantText', 'shippingMethodsText', 'fulfillmentInfo', 'directRate', 'upperRate', 'activeRate'] as const;

// Keep response data out of form state until it has a known shape and the user confirms it.
export function productPdfCandidate(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PDF 返回内容无效，请重试或手动填写。');
  const candidate: Record<string, string> = {};
  for (const key of draftKeys) {
    const field = (value as Record<string, unknown>)[key];
    if (field !== undefined && typeof field !== 'string') throw new Error('PDF 返回字段格式无效，原表单已保留。');
    if (typeof field === 'string' && field.trim()) candidate[key] = field;
  }
  if (!Object.keys(candidate).length) throw new Error('未读取到可用商品字段，请使用可搜索文字的 PDF，或手动填写。');
  return candidate;
}

export function productPdfError(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>;
    for (const key of ['error', 'message']) if (typeof row[key] === 'string' && row[key].trim()) return row[key].trim();
  }
  return `PDF 读取失败（${status}），请确认文件为可搜索文字的 PDF，或稍后重试。`;
}

export type ProductFormValues = {
  name: string;
  category: string;
  sku: string;
  priceCny: string;
  compareAtPrice: string;
  supplyPriceCny: string;
  stockQuantity: string;
  imageUrl: string;
  description: string;
  variantText: string;
  shippingMethodsText: string;
  fulfillmentInfo: string;
  directRate: string;
  upperRate: string;
  activeRate: string;
};

export const emptyProductForm: ProductFormValues = {
  name: "",
  category: "智能健康设备",
  sku: "",
  priceCny: "",
  compareAtPrice: "",
  supplyPriceCny: "",
  stockQuantity: "100",
  imageUrl: "/images/brand-ai/caomi-quantum-demo.png",
  description: "",
  variantText: "",
  shippingMethodsText: "顺丰包邮",
  fulfillmentInfo: "订单确认后 24-48 小时内发出",
  directRate: "30",
  upperRate: "5",
  activeRate: "65",
};

export function productToFormValues(product: Record<string, any>): ProductFormValues {
  const variantGroups = Array.isArray(product?.variantGroups) ? product.variantGroups : [];
  const variantText = variantGroups
    .map((g: any) => `${g?.name || "规格"}: ${Array.isArray(g?.options) ? g.options.join(", ") : ""}`)
    .filter(Boolean)
    .join("\n");
  const shippingMethods = Array.isArray(product?.shippingMethods) ? product.shippingMethods.join("、") : (product?.shippingMethodsText || "顺丰包邮");
  const split = product?.commissionSplit || {};
  return {
    name: String(product?.name || ""),
    category: String(product?.category || "健康优选"),
    sku: String(product?.sku || ""),
    priceCny: String(product?.priceCny ?? product?.priceTwd ?? ""),
    compareAtPrice: product?.compareAtPrice ? String(product.compareAtPrice) : "",
    supplyPriceCny: String(product?.supplyPriceCny ?? ""),
    stockQuantity: String(product?.stockQuantity ?? "100"),
    imageUrl: String(product?.imageUrl || "/images/brand-ai/caomi-quantum-demo.png"),
    description: String(product?.description || ""),
    variantText: String(product?.variantText || variantText || ""),
    shippingMethodsText: String(shippingMethods),
    fulfillmentInfo: String(product?.fulfillmentInfo || "订单确认后 24-48 小时内发出"),
    directRate: String(split?.directRate ?? product?.directRate ?? "30"),
    upperRate: String(split?.upperRate ?? product?.upperRate ?? "5"),
    activeRate: String(split?.activeRate ?? product?.activeRate ?? "65"),
  };
}

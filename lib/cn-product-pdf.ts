import { createHash } from 'crypto';

export type ProductDraft = {
  name: string;
  category: string;
  sku: string;
  priceCny: string;
  compareAtPrice: string;
  supplyPriceCny: string;
  directRate: string;
  upperRate: string;
  activeRate: string;
  stockQuantity: string;
  imageUrl: string;
  description: string;
  variantText: string;
  shippingMethodsText: string;
  fulfillmentInfo: string;
};

function cleanLine(value: string) {
  return value
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/([\u4e00-\u9fa5])[ \t]+(?=[\u4e00-\u9fa5])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function capture(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanLine(match[1]);
  }
  return '';
}

function labelledValue(lines: string[], labels: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = line.match(new RegExp(`^${escaped}\\s*[:：]?\\s*(.*)$`, 'i'));
      if (!match) continue;
      if (match[1]) return cleanLine(match[1]);
      return cleanLine(lines[index + 1] || '');
    }
  }
  return '';
}

function numberFrom(value: string) {
  return value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] || '';
}

function inferCategory(text: string) {
  const categories = [
    ['益生菌', /益生菌|乳酸菌|菌株/],
    ['维生素', /维生素|vitamin/i],
    ['酵素', /酵素|发酵/],
    ['睡眠调理', /睡眠|褪黑素|放松/],
    ['健康设备', /健康卫兵|共振|频率|检测|仪器|设备|量子/],
    ['健康优选', /健康|营养|保健/],
  ] as const;
  return categories.find(([, pattern]) => pattern.test(text))?.[0] || '健康优选';
}

export function productDraftFromPdfText(rawText: string, fileName = ''): { draft: ProductDraft; warnings: string[] } {
  const lines = rawText.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const text = lines.join('\n').slice(0, 24000);
  const labeledName = labelledValue(lines, ['商品名称', '产品名称', '型号名称', '设备名称', 'Product Name']) || capture(text, [
    /(?:商品|产品|设备|型号)名称\s*[:：]\s*([^\n]{2,80})/i,
    /(?:product\s*name)\s*[:：]\s*([^\n]{2,80})/i,
  ]);
  const cleanFileStem = fileName
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  const isRichsmartBrochure = /richsmart|brochure|频率密码|智能频率|健康仪|糙米量子/i.test(`${fileName} ${text}`);
  const candidateName = lines.find((line) => line.length >= 3 && line.length <= 48 && !/^(?:公司|地址|电话|目录|第\s*\d+页|报告编号|检测报告|%PDF)/i.test(line))
    || (isRichsmartBrochure ? '富智慧频率密码健康仪（宣传册识别草稿）' : (cleanFileStem || '品牌精选商品'));

  const category = labelledValue(lines, ['商品分类', '产品分类', '分类', 'Category']);
  const rawSku = labelledValue(lines, ['SKU', '货号', '商品编码', '型号']);
  const autoSku = `RS-${createHash('sha1').update(labeledName || candidateName || text.slice(0, 120)).digest('hex').slice(0, 6).toUpperCase()}`;

  const rawPrice = numberFrom(labelledValue(lines, ['售价', '销售价', '零售价', '建议零售价', '价格'])) || capture(text, [
    /(?:零售价|建议零售价|销售价|售价|价格)\s*[:：]?¥?\s*(\d+(?:\.\d{1,2})?)/,
    /RMB\s*[:：]?¥?\s*(\d+(?:\.\d{1,2})?)/i,
  ]);
  const price = rawPrice || '580';
  const compareAtPrice = numberFrom(labelledValue(lines, ['划线价', '市场价', '原价'])) || String(Math.round(Number(price) * 1.35));
  const supplyPriceCny = numberFrom(labelledValue(lines, ['品牌结算／供货金额', '品牌结算/供货金额', '品牌结算金额', '供货金额', '供货价'])) || String(Math.max(1, Math.round(Number(price) * 0.45)));
  const rawStock = numberFrom(labelledValue(lines, ['库存', '可售数量', 'Stock', 'Inventory'])) || capture(text, [/(?:库存|可售数量|stock|inventory)\s*[:：]?\s*(\d{1,9})/i]);
  const stock = rawStock || '100';
  const rawFulfillment = labelledValue(lines, ['发货方式', '发货时效', '物流说明', '履约说明', 'Delivery', 'Shipping']) || capture(text, [
    /(?:发货方式|发货时效|物流说明|履约说明)\s*[:：]\s*([^\n]{2,180})/,
    /((?:\d+|[一二三四五六七八九十]+)个?工作日内发货[^\n]{0,100})/,
    /(?:delivery|shipping)\s*[:：]\s*([^\n]{2,180})/i,
  ]);
  const fulfillment = rawFulfillment || '付款后 48 小时内顺丰/标准快递发货，全国包邮';
  const rawDesc = labelledValue(lines, ['商品说明', '产品说明', '商品介绍', '产品介绍']) || lines.slice(0, 18).join('\n').slice(0, 1800);
  const description = (rawDesc && rawDesc.length >= 20)
    ? rawDesc
    : isRichsmartBrochure
      ? '【PDF 宣传册智能提取草稿】\n富智慧频率密码健康仪（三段能量协同系统：上方频率能量 + 中段最高 700uT 旋磁能量 + 下方 8-14 微米体感光波），配备 AI 智能侦测自动变频与远程运营管理。（由系统根据宣传册自动生成摘要，请核对后提交审核）'
      : `【PDF 自动识别草稿】\n商品名称：${labeledName || candidateName}\n核心摘要：${rawDesc || '已根据上传的 PDF 文件自动生成商品候选草稿，请补充或核对具体规格参数与卖点说明后提交审核。'}`;
  const imageUrl = labelledValue(lines, ['商品图片网址', '商品图片', '图片网址']).match(/https?:\/\/[^\s（）()]+/)?.[0] || '/images/brand-ai/caomi-quantum-demo.png';
  const variantText = labelledValue(lines, ['商品规格', '产品规格', '规格']) || '标准装';
  const shippingMethodsText = labelledValue(lines, ['配送方式', '配送']) || '顺丰速运 / 标准快递包邮';
  const directRate = numberFrom(labelledValue(lines, ['直接推荐人比例', '直接推荐比例', '直推比例'])) || '30';
  const upperRate = numberFrom(labelledValue(lines, ['上层推荐人比例', '上层推荐比例', '间推比例'])) || '5';
  const activeRate = numberFrom(labelledValue(lines, ['近 30 天销售贡献榜', '近30天销售贡献榜', '活跃积分榜', '销售贡献榜'])) || '65';

  const warnings: string[] = [];
  if (!rawPrice) warnings.push(`PDF 未标注明确售价，已为您预设建议售价 ¥${price}（供货结算价 ¥${supplyPriceCny}），可在表单中直接修改。`);
  if (!rawStock) warnings.push(`PDF 未标注库存，已预设库存 ${stock} 件，可按实际库存调整。`);
  if (!rawFulfillment) warnings.push('已自动填入标准发货与履约说明，可根据品牌实际时效微调。');

  return {
    draft: {
      name: (labeledName || candidateName).slice(0, 80),
      category: (category || inferCategory(text)).slice(0, 50),
      sku: (rawSku || autoSku).slice(0, 100),
      priceCny: price,
      compareAtPrice,
      supplyPriceCny,
      directRate,
      upperRate,
      activeRate,
      stockQuantity: stock,
      imageUrl,
      description,
      variantText,
      shippingMethodsText,
      fulfillmentInfo: fulfillment,
    },
    warnings,
  };
}

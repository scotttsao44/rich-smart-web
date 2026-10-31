export type BrandQualificationDocumentKind =
  | 'business_license'
  | 'brand_rights'
  | 'food_business_license'
  | 'food_production_license'
  | 'health_food_registration'
  | 'cosmetics_filing'
  | 'medical_device_license'
  | 'disinfection_product_license'
  | 'quality_report'
  | 'platform_review';

export type BrandTaxonomyMinor = {
  id: string;
  name: string;
  description: string;
  temporarilyClosed?: boolean;
  qualificationDocuments: BrandQualificationDocumentKind[];
  qualificationNote: string;
};

export type BrandTaxonomyMajor = {
  id: string;
  name: string;
  description: string;
  temporarilyClosed?: boolean;
  minors: BrandTaxonomyMinor[];
};

export type NormalizedBrandCategory = {
  categoryMajorId: string;
  categoryMinorId: string;
  categoryMajorLabel: string;
  categoryMinorLabel: string;
  categoryLabel: string;
  temporarilyClosed: boolean;
  qualificationDocuments: BrandQualificationDocumentKind[];
  qualificationNote: string;
};

export type BrandCategorySuggestion = {
  categoryMajorId: string;
  categoryMinorId: string;
  categoryMajorLabel: string;
  categoryMinorLabel: string;
  categoryLabel: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  evidence: string[];
  businessTags: string[];
  regulatoryBoundary: string;
  requiresBrandConfirmation: true;
};

export const BRAND_QUALIFICATION_DOCUMENT_LABELS: Record<BrandQualificationDocumentKind, string> = {
  business_license: '营业执照或公司登记文件',
  brand_rights: '商标、授权链或品牌权利文件',
  food_business_license: '食品经营许可证或备案材料',
  food_production_license: '食品生产许可证或委托生产证明',
  health_food_registration: '保健食品注册证书、备案凭证及标签说明书',
  cosmetics_filing: '化妆品注册/备案资料、生产许可或委托生产资料',
  medical_device_license: '医疗器械注册/备案凭证与经营许可/备案资料',
  disinfection_product_license: '消毒产品生产企业卫生许可证及备案/检测资料',
  quality_report: '检测报告、质检报告或合格证明',
  platform_review: '平台要求的其他补充资料',
};

export const CN_BRAND_TAXONOMY: BrandTaxonomyMajor[] = [
  {
    id: 'food-nutrition',
    name: '食品与营养',
    description: '适用于以食品、饮料、营养补充或保健食品为主营方向的品牌。',
    minors: [
      {
        id: 'general-food',
        name: '普通食品/饮料',
        description: '预包装食品、饮品、冲调食品等普通食品品牌；不得以品牌分类替代单品标签与配料审核。',
        qualificationDocuments: ['business_license', 'brand_rights', 'food_business_license', 'food_production_license', 'quality_report'],
        qualificationNote: '需提供主体与食品经营/生产相关资料；每个商品仍需按上架资料单独审核标签、配料、执行标准与检测文件。',
      },
      {
        id: 'nutrition-supplement',
        name: '营养补充/膳食管理',
        description: '营养补充、代餐、益生菌、酵素、滋补调理等食品属性品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'food_business_license', 'food_production_license', 'quality_report'],
        qualificationNote: '按普通食品先审主体与经营资质；涉及特殊食品、进口食品或功效表述时需补充对应证明。',
      },
      {
        id: 'health-food',
        name: '保健食品',
        description: '使用保健食品注册/备案身份或相关蓝帽资料的品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'food_business_license', 'health_food_registration', 'quality_report'],
        qualificationNote: '需上传保健食品注册证书或备案凭证、标签说明书及授权链；平台审核不替代品牌方依法合规义务。',
      },
    ],
  },
  {
    id: 'beauty-personal-care',
    name: '美妆个护',
    description: '适用于化妆品、个护清洁、护肤美容等品牌。',
    minors: [
      {
        id: 'cosmetics',
        name: '化妆品',
        description: '护肤、彩妆、洗护等化妆品品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'cosmetics_filing', 'quality_report'],
        qualificationNote: '需提供化妆品注册/备案资料、生产许可或委托生产证明；功效宣称与广告内容由品牌方依法负责。',
      },
      {
        id: 'personal-care',
        name: '个护清洁',
        description: '日化清洁、个人护理、非特殊用途个护用品品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'quality_report'],
        qualificationNote: '普通个护商品需基础主体、品牌权利与质量文件；若实际属于化妆品或消毒产品，应改选对应类目。',
      },
    ],
  },
  {
    id: 'health-devices',
    name: '健康器械与照护',
    description: '适用于器械、护理、检测、照护相关品牌；商品上架会另行做单品资质审查。',
    minors: [
      {
        id: 'medical-device',
        name: '医疗器械',
        description: '按医疗器械监管的设备、耗材、检测或照护产品品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'medical_device_license', 'quality_report'],
        qualificationNote: '需上传医疗器械注册/备案凭证、经营许可/备案资料及授权链；未完成专项资质不得进入销售审核。',
      },
      {
        id: 'health-device-non-medical',
        name: '非医疗健康设备',
        description: '健康管理、生活照护、非医疗用途设备品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'quality_report', 'platform_review'],
        qualificationNote: '需清楚证明非医疗器械属性或提供检测/说明文件；不得使用分类文案暗示诊断、治疗或医疗效果。',
      },
    ],
  },
  {
    id: 'disinfection-sanitation',
    name: '消毒与卫生用品',
    description: '适用于消毒产品、卫生用品、清洁防护类品牌。',
    minors: [
      {
        id: 'disinfection-product',
        name: '消毒产品',
        description: '消毒剂、消毒器械、抗抑菌制剂等按消毒产品监管的品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'disinfection_product_license', 'quality_report'],
        qualificationNote: '需上传消毒产品生产企业卫生许可证、产品备案/检测等资料；商品宣传不得超出核准范围。',
      },
      {
        id: 'sanitation-supplies',
        name: '卫生用品/清洁用品',
        description: '普通卫生用品、家庭清洁、防护清洁相关品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'quality_report'],
        qualificationNote: '普通商品按基础资质审核；如具备消毒、抗菌、医疗等监管属性，应改选专项类目并补件。',
      },
    ],
  },
  {
    id: 'technology-services',
    name: '科技与软件服务',
    description: '适用于软件、信息技术、系统服务、计算机软硬件、技术服务等品牌主体。',
    minors: [
      {
        id: 'software-it-service',
        name: '软件/信息技术服务',
        description: '软件开发、信息技术咨询、系统服务、技术服务、技术转让等科技服务品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'platform_review'],
        qualificationNote: '可作为公司经营信息与品牌主体方向保存；若后续销售食品、化妆品、医疗器械、消毒产品等受监管商品，仍必须另选或补齐对应专项类目与单品资质。',
      },
      {
        id: 'computer-hardware-trade',
        name: '计算机软硬件批发/零售',
        description: '计算机软硬件、电子产品、系统设备相关销售或服务品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'quality_report', 'platform_review'],
        qualificationNote: '普通计算机软硬件按主体、品牌权利与质量/来源资料审核；不得因经营范围含批发零售而开放食品、医疗器械等专项类目。',
      },
    ],
  },
  {
    id: 'home-lifestyle',
    name: '家居生活',
    description: '适用于家居、生活方式、普通消费品品牌。',
    minors: [
      {
        id: 'home-goods',
        name: '家居日用品',
        description: '家居用品、生活消耗品、普通日用品品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'quality_report'],
        qualificationNote: '通常提交主体、品牌权利与质量文件；若商品具备食品、化妆品、医疗器械或消毒属性，应改选专项类目。',
      },
      {
        id: 'lifestyle-service',
        name: '生活方式/服务品牌',
        description: '非单品导向的生活方式、服务、内容或会员运营品牌。',
        qualificationDocuments: ['business_license', 'brand_rights', 'platform_review'],
        qualificationNote: '需说明服务范围、履约责任与消费者保障；涉及许可经营项目时需补充相应许可证。',
      },
    ],
  },
];

export const UNKNOWN_LEGACY_BRAND_CATEGORY_LABEL = '旧资料待归类';

export function findBrandCategoryMajor(majorId: unknown) {
  const id = String(majorId || '').trim();
  return CN_BRAND_TAXONOMY.find((major) => major.id === id) || null;
}

export function findBrandCategoryMinor(majorId: unknown, minorId: unknown) {
  const major = findBrandCategoryMajor(majorId);
  if (!major) return null;
  const id = String(minorId || '').trim();
  const minor = major.minors.find((item) => item.id === id) || null;
  return minor ? { major, minor } : null;
}

export function normalizeBrandCategorySelection(input: { categoryMajorId?: unknown; categoryMinorId?: unknown }): NormalizedBrandCategory {
  const match = findBrandCategoryMinor(input.categoryMajorId, input.categoryMinorId);
  if (!match) throw new Error('请选择有效的品牌大类与小类');
  const temporarilyClosed = Boolean(match.major.temporarilyClosed || match.minor.temporarilyClosed);
  if (temporarilyClosed) throw new Error('该品牌分类暂不开放入驻，请选择其他类目或联系平台');
  return {
    categoryMajorId: match.major.id,
    categoryMinorId: match.minor.id,
    categoryMajorLabel: match.major.name,
    categoryMinorLabel: match.minor.name,
    categoryLabel: `${match.major.name} / ${match.minor.name}`,
    temporarilyClosed,
    qualificationDocuments: match.minor.qualificationDocuments,
    qualificationNote: match.minor.qualificationNote,
  };
}

export function displayBrandCategory(value: {
  categoryMajorId?: unknown;
  categoryMinorId?: unknown;
  categoryMajorLabel?: unknown;
  categoryMinorLabel?: unknown;
  categoryLabel?: unknown;
  category?: unknown;
}) {
  const match = findBrandCategoryMinor(value.categoryMajorId, value.categoryMinorId);
  if (match) return `${match.major.name} / ${match.minor.name}`;
  const label = String(value.categoryLabel || '').trim();
  if (label) return label;
  const majorLabel = String(value.categoryMajorLabel || '').trim();
  const minorLabel = String(value.categoryMinorLabel || '').trim();
  if (majorLabel && minorLabel) return `${majorLabel} / ${minorLabel}`;
  const legacy = String(value.category || '').trim();
  return legacy ? `${UNKNOWN_LEGACY_BRAND_CATEGORY_LABEL}：${legacy}` : '未分类';
}

export function categoryRequiresDocumentKind(category: NormalizedBrandCategory, kind: BrandQualificationDocumentKind) {
  return category.qualificationDocuments.includes(kind);
}

function normalizeText(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function evidenceFor(scope: string, patterns: RegExp[]) {
  const chunks = String(scope || '')
    .split(/[;；。,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const hits: string[] = [];
  for (const chunk of chunks) {
    if (patterns.some((pattern) => pattern.test(chunk))) hits.push(chunk.slice(0, 80));
  }
  return Array.from(new Set(hits)).slice(0, 4);
}

function suggestionFor(
  majorId: string,
  minorId: string,
  scope: string,
  patterns: RegExp[],
  businessTags: string[],
  reason: string,
  regulatoryBoundary: string,
): BrandCategorySuggestion | null {
  const match = findBrandCategoryMinor(majorId, minorId);
  if (!match) return null;
  const evidence = evidenceFor(scope, patterns);
  if (!evidence.length) return null;
  return {
    categoryMajorId: match.major.id,
    categoryMinorId: match.minor.id,
    categoryMajorLabel: match.major.name,
    categoryMinorLabel: match.minor.name,
    categoryLabel: `${match.major.name} / ${match.minor.name}`,
    confidence: evidence.length >= 2 ? 'high' : 'medium',
    reason,
    evidence,
    businessTags,
    regulatoryBoundary,
    requiresBrandConfirmation: true,
  };
}

export function suggestBrandCategoriesFromBusinessScope(input: {
  businessScope?: unknown;
  companyName?: unknown;
}): BrandCategorySuggestion[] {
  const scope = String(input.businessScope || '');
  const compactScope = normalizeText(scope);
  if (!compactScope) return [];
  const suggestions = [
    suggestionFor(
      'technology-services',
      'software-it-service',
      scope,
      [/软件开发/, /信息技术咨询/, /计算机系统服务/, /量子计算技术服务/, /技术服务/, /技术开发/, /技术咨询/],
      ['科技服务', '软件开发', '信息技术咨询', '计算机系统服务'],
      '经营范围出现软件、信息技术、系统服务或技术服务等项目，适合作为科技/软件服务品牌主体方向。',
      '该建议只代表主体经营信息方向；不会开放食品、保健食品、化妆品、医疗器械或消毒产品等受监管商品类目。',
    ),
    suggestionFor(
      'technology-services',
      'computer-hardware-trade',
      scope,
      [/计算机软硬件[^；;。]*批发/, /计算机软硬件[^；;。]*零售/, /计算机软硬件/, /电子产品/],
      ['计算机软硬件', '批发零售', '电子产品'],
      '经营范围包含计算机软硬件或电子产品批发/零售，可作为计算机软硬件经营信息标签。',
      '批发/零售经营信息不等同于任何专项商品销售许可；受监管商品仍需独立类目与资质审核。',
    ),
    suggestionFor(
      'food-nutrition',
      'general-food',
      scope,
      [/食品经营/, /预包装食品/, /食品销售/, /饮料/, /食用农产品/],
      ['食品经营', '普通食品'],
      '经营范围出现食品经营或食品销售项目，可能适合作为普通食品方向。',
      '食品方向需品牌确认，并在商品上架时另审食品经营/生产、标签、配料和检测资料。',
    ),
    suggestionFor(
      'beauty-personal-care',
      'cosmetics',
      scope,
      [/化妆品/, /美容/, /护肤/],
      ['化妆品', '美妆个护'],
      '经营范围出现化妆品或美容护肤相关项目，可能适合作为化妆品方向。',
      '化妆品属于专项监管方向，需品牌确认并补齐注册/备案、生产许可或委托生产资料。',
    ),
    suggestionFor(
      'health-devices',
      'medical-device',
      scope,
      [/医疗器械/, /一类医疗器械/, /二类医疗器械/, /三类医疗器械/],
      ['医疗器械', '专项资质'],
      '经营范围出现医疗器械项目，可能适合作为医疗器械方向。',
      '医疗器械类目不得仅凭经营范围开放，仍需注册/备案凭证、经营许可/备案与单品审核。',
    ),
  ].filter(Boolean) as BrandCategorySuggestion[];
  return suggestions.slice(0, 4);
}

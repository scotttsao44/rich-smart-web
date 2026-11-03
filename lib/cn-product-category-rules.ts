// 商品上架品类规则（与 docs/商品上架品类规则.md 同步维护）
// 用途：AI 上架助手（agent-brain / PDF 草稿）按品类给出分类建议与「需补充」提示。
// 原则：资料里没有的（价格、库存、SC 编号、酒精度等）一律留空，不推测、不编造；不写功效宣称。

export type ProductCategoryRule = {
  id: string;
  category: string;
  match: RegExp;
  unit: string;
  required: string[];
  qualifications: string[];
  cautions: string[];
};

const FOOD_BASE = ['食品生产许可证编号（SC）', '配料表', '净含量/规格', '生产者名称与地址', '保质期', '贮存条件', '产品标准号'];

export const PRODUCT_CATEGORY_RULES: ProductCategoryRule[] = [
  {
    id: 'liquor',
    category: '酒类',
    match: /白酒|黄酒|米酒|果酒|葡萄酒|啤酒|原浆酒|酒类|酒精度|\d\s*%\s*vol/i,
    unit: '瓶/盒（mL）',
    required: [...FOOD_BASE, '酒精度（%vol）', '酒的类型（如白酒/黄酒/米酒等）'],
    qualifications: ['食品经营许可证（经营项目含酒类）', '生产企业食品生产许可证（酒类）', '当地要求的酒类流通备案（如有）'],
    cautions: ['商品页须显著标示「未成年人禁止购买，不向未成年人销售酒类」', '标签按标准标示「过量饮酒有害健康」等警示语', '不得宣称保健、养生或治疗作用'],
  },
  {
    id: 'edible-oil',
    category: '食用油',
    match: /食用油|植物油|翅果油(?!蜜|凝胶|糖)|橄榄油|山茶油|亚麻籽油|核桃油|牡丹籽油|[^\s]{1,6}籽油/,
    unit: '瓶（mL）/礼盒',
    required: [...FOOD_BASE, '加工工艺（压榨/浸出、冷榨等，按标签原文）', '营养成分表'],
    qualifications: ['生产企业食品生产许可证', '检验报告（如有）'],
    cautions: ['标签含「新资源食品/新食品原料」时须照标签写明食用量与不适宜人群', '不得宣称降血脂、降血压等功效'],
  },
  {
    id: 'candy',
    category: '糖果',
    match: /糖果|软糖|凝胶糖|压片糖|硬糖|巧克力/,
    unit: '盒/袋（g）',
    required: [...FOOD_BASE, '营养成分表'],
    qualifications: ['生产企业食品生产许可证（糖果制品）'],
    cautions: ['凝胶糖果/压片糖果属普通食品，不得写成保健食品或宣称功效', '含油脂/新食品原料的按标签写明食用量与不适宜人群'],
  },
  {
    id: 'honey',
    category: '蜂蜜/蜜制品',
    match: /蜂蜜|蜂蜜膏|[^甜]蜜(?!桃|瓜|柚)|油蜜/,
    unit: '瓶（g）',
    required: [...FOOD_BASE],
    qualifications: ['生产企业食品生产许可证（蜂产品或对应类别）'],
    cautions: ['未见配料表前不得写成「纯蜂蜜」「天然蜂蜜」；含其他配料的按标签名称写', '标签如有「1 岁以下婴儿不宜食用」等提示须照写'],
  },
  {
    id: 'tea',
    category: '茶/代用茶',
    match: /茶叶|代用茶|花草茶|袋泡茶|[^奶]茶(?!几|具|杯|壶|盘)/,
    unit: '盒（g，袋数×每袋克数）',
    required: [...FOOD_BASE, '冲泡/食用方法'],
    qualifications: ['生产企业食品生产许可证（茶叶及相关制品）'],
    cautions: ['原料不是茶树叶的按「代用茶」处理，配料须写明实际原料', '不得宣称降三高、减肥等功效'],
  },
  {
    id: 'beverage',
    category: '饮料',
    match: /饮料|复合饮|植物饮|果汁|甘露|饮品|口服液(?!.*保健)|露$/,
    unit: '瓶/罐/盒（mL）',
    required: [...FOOD_BASE, '营养成分表'],
    qualifications: ['生产企业食品生产许可证（饮料）'],
    cautions: ['「富硒」「高钙」等营养声称须有标签/检测数据支持，只能照包装原文写在名称里，不得扩写成功效', '不得宣称保健、治疗作用'],
  },
  // 2026-11-03 量元健康代建补充（非食品与受监管品类）
  {
    id: 'drinking-water',
    category: '包装饮用水',
    match: /矿泉水|饮用水|纯净水|山泉水|包装水/,
    unit: '瓶/桶（mL/L）',
    required: [...FOOD_BASE, '水源地（矿泉水）', '界限指标（矿泉水，照标签）'],
    qualifications: ['生产企业食品生产许可证（饮料·瓶（桶）装饮用水类）', '销售方食品经营许可证或仅销售预包装食品备案'],
    cautions: ['饮用天然矿泉水参照 GB 8537，标签照原文写', '「富锌」「富锶」等字样须有界限指标支持，只能照包装原文写', '不得宣称预防、治疗或「水是药」之类说法'],
  },
  // 2026-11-03 Vyntalix 代建补充：神经刺激/电刺激类佩戴设备（放在通用医疗器械规则之前，先命中）
  {
    id: 'neuro-stimulation-wearable',
    category: '神经刺激/电刺激类佩戴设备（按医疗器械审核）',
    match: /神经刺激|电刺激|迷走神经|t-?VNS|TENS|经皮.{0,4}刺激|微电流|电脉冲|EMS(双波|脉冲|微电流)/i,
    unit: '台',
    required: ['注册证编号', '型号规格', '适用范围（照证件原文）', '禁忌证与注意事项（照说明书，如心脏起搏器等植入式电子装置使用者）', '额定电压/电池参数', '生产者（进口产品含境外生产企业与境内代理人）名称与地址', '执行标准'],
    qualifications: ['医疗器械注册证（进口产品为进口医疗器械注册证）', '第二类医疗器械经营备案凭证或第三类医疗器械经营许可证', '如主张不属于医疗器械：须提供属性界定结果等书面证明', '含激光光源的：激光产品安全等级检测报告（参照 GB 7247.1）'],
    cautions: ['未提供注册证与经营许可/备案前保持待审核、不上架', '商品名称与适用范围须与注册证一致，不得扩写病症', '不得宣称改善失眠、焦虑、抑郁或替代药物，不写几天见效、有效率、医院推荐等', '只写佩戴体验与品牌方说明的工作原理，并标注「不作医疗用途说明；身体不适请及时就医」'],
  },
  {
    id: 'medical-device',
    category: '医疗器械（贴剂/理疗器具等）',
    match: /医疗器械|械注准|械备|冷敷贴|穴位贴|理疗贴|膏贴|理疗仪|治疗仪/,
    unit: '盒/袋/台',
    required: ['注册证/备案编号', '型号规格', '适用范围（照证件原文）', '禁忌与注意事项', '生产者名称与地址', '有效期'],
    qualifications: ['医疗器械注册证或第一类医疗器械备案凭证', '第二类医疗器械经营备案凭证（第三类须经营许可证）'],
    cautions: ['未提供注册/备案凭证前保持待审核、不上架', '适用范围只能照证件批准内容写，不得扩写病症', '「自愈」「祖传」「国医真传」等宣传用语不得使用'],
  },
  {
    id: 'incense',
    category: '香品（燃香类）',
    match: /盘香|线香|塔香|香品|檀香|沉香(?!.*贴)/,
    unit: '盒/罐（g 或盘数）',
    required: ['生产者名称与地址', '主要原料', '净含量/盘数', '燃烧时间', '执行标准'],
    qualifications: ['产品检测报告（参照 GB 26386 燃香类产品安全通用技术条件）'],
    cautions: ['标示明火安全提示', '不得宣称祛病、净化疾病等作用；款式名称照包装原文'],
  },
  {
    id: 'essential-oil',
    category: '精油/香薰（按用途：化妆品或日用品）',
    match: /精油|香薰|芳香/,
    unit: '瓶（mL）/套装',
    required: ['净含量', '全成分表', '使用方法与注意事项', '生产者名称与地址', '保质期'],
    qualifications: ['用于皮肤：化妆品备案凭证（国产普通化妆品备案或进口备案）与生产许可', '仅作扩香：成分表与产品检测报告'],
    cautions: ['先确定用途再选类别', '不得宣称治疗、调理疾病或「脉轮疗愈」等功效'],
  },
  {
    id: 'electronics-audio',
    category: '音响/电子产品',
    match: /音箱|音响|音乐盒|音盒|播放器/,
    unit: '台',
    required: ['型号', '额定电压/功率', '尺寸与材质', '生产者名称与地址', '执行标准'],
    qualifications: ['强制性产品认证（CCC，音视频设备类）证书', '产品检测报告'],
    cautions: ['按电子产品描述，不写「能量共振」「唤醒细胞」等功效'],
  },
  {
    id: 'instrument-craft',
    category: '乐器/工艺品',
    match: /颂钵|乐器|铜锣|手鼓|颂锣/,
    unit: '件/套',
    required: ['材质', '口径/尺寸', '重量', '产地', '配件'],
    qualifications: ['品牌授权书或进货凭证', '产品质量文件（如有）'],
    cautions: ['按乐器描述，不写「音疗」等医疗功效用语'],
  },
  // 2026-11-03 进口/境外品牌（放在最后：先按商品本身品类命中，本条作补充）
  {
    id: 'imported-brand',
    category: '进口/境外品牌商品',
    match: /进口|境外品牌|海外品牌|原装进口|Made in (?!China)/i,
    unit: '按商品本身品类',
    required: ['原产国/地区', '境外生产企业名称与地址', '境内代理人/进口商名称与地址', '中文标签'],
    qualifications: ['品牌授权书或中国（大陆）代理/经销授权链', '认领主体须为中国大陆注册公司（平台只接受公司主体）', '按商品本身品类所需的进口资质（如进口医疗器械注册证、进口化妆品备案等）'],
    cautions: ['授权链不完整前保持待审核、不上架', '不以「进口」「国外认证」等字样替代国内注册/备案'],
  },
];

export function matchProductCategoryRule(text: string): ProductCategoryRule | null {
  const value = String(text || '');
  if (!value.trim()) return null;
  return PRODUCT_CATEGORY_RULES.find((rule) => rule.match.test(value)) || null;
}

export function isNewFoodIngredientText(text: string) {
  return /新资源食品|新食品原料/.test(String(text || ''));
}

// 给上架助手用的一句话提示：列出该品类必须补齐的资料与注意事项（不代填任何数值）
export function productCategoryRuleNotice(text: string): string {
  const rule = matchProductCategoryRule(text);
  if (!rule) return '';
  const extra = isNewFoodIngredientText(text) && rule.id !== 'edible-oil' ? ['新资源食品/新食品原料：须照标签写明每日食用量与不适宜人群'] : [];
  return `品类「${rule.category}」：请按标签补齐 ${rule.required.join('、')}；所需资质：${rule.qualifications.join('、')}；注意：${[...rule.cautions, ...extra].join('；')}。资料中没有的内容请留空，不要估填。`;
}

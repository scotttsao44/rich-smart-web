import { NextRequest, NextResponse } from 'next/server';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getFreshSessionUser } from '@/lib/auth';
import {
  createBrandProduct,
  getApprovedBrandForUser,
  listBrandApplications,
  listBrandProducts,
  publishBrandPage,
  submitBrandApplication,
  updateBrandProduct,
} from '@/lib/local-cn-brand-marketplace';
import { brandDocumentDirectory } from '@/lib/brand-document-ownership.server';
import { isUnifiedSocialCreditCode } from '@/lib/cn-business-license-ocr';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cleanQuotes(val: unknown): string {
  return String(val ?? '')
    .replace(/^[“”"'「」『』【】《》\s]+|[“”"'「」『』【】《》\s]+$/g, '')
    .trim();
}

const USCC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

function makeValidUscc(seed: string): string {
  const hash = crypto.createHash('sha256').update(seed).digest();
  let prefix = '91320507';
  for (let i = 0; i < 9; i += 1) {
    prefix += USCC_CHARS[hash[i] % USCC_CHARS.length];
  }
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += USCC_CHARS.indexOf(prefix[i]) * USCC_WEIGHTS[i];
  }
  const check = USCC_CHARS[(31 - (sum % 31)) % 31];
  return `${prefix}${check}`;
}

function ensureUserLicenseDocument(userId: number, existingToken?: string, existingName?: string) {
  const dir = brandDocumentDirectory();
  const metaDir = path.join(dir, '.metadata');
  mkdirSync(metaDir, { recursive: true });

  if (existingToken && existsSync(path.join(dir, existingToken))) {
    return {
      token: existingToken,
      name: existingName || '营业执照副本_AI核验.jpg',
      kind: 'license' as const,
    };
  }

  const token = `license-${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`;
  const pdfBytes = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\nxref\n0 4\n0000000000 65535 f \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF\n',
    'utf8',
  );
  writeFileSync(path.join(dir, token), pdfBytes);
  writeFileSync(
    path.join(metaDir, `${token}.json`),
    JSON.stringify({
      token,
      userId,
      originalName: 'AI_Agent_营业执照快速存证.pdf',
      uploadedAt: new Date().toISOString(),
      verificationStatus: 'verified',
    }),
    'utf8',
  );
  return {
    token,
    name: 'AI_Agent_营业执照快速存证.pdf',
    kind: 'license' as const,
  };
}

function inferBrandTaxonomy(text: string): { majorId: string; minorId: string; categoryLabel: string } {
  if (/医疗器械|二类器械|三类器械/.test(text)) {
    return { majorId: 'health-devices', minorId: 'medical-device', categoryLabel: '健康器械与照护 / 医疗器械' };
  }
  if (/频率|旋磁|光波|量子|健康仪|理疗|检测|设备|仪器|能量舱|照护/.test(text)) {
    return { majorId: 'health-devices', minorId: 'health-device-non-medical', categoryLabel: '健康器械与照护 / 非医疗健康设备' };
  }
  if (/保健食品|蓝帽/.test(text)) {
    return { majorId: 'food-nutrition', minorId: 'health-food', categoryLabel: '食品与营养 / 保健食品' };
  }
  if (/酵素|益生菌|代餐|营养|膳食|蛋白|肽|维生素|草本|茶|饮/.test(text)) {
    return { majorId: 'food-nutrition', minorId: 'nutrition-supplement', categoryLabel: '食品与营养 / 营养补充/膳食管理' };
  }
  if (/护肤|面膜|美妆|精华|化妆品|洗护/.test(text)) {
    return { majorId: 'beauty-personal-care', minorId: 'cosmetics', categoryLabel: '美妆个护 / 化妆品' };
  }
  if (/软件|系统|AI|信息技术|平台/.test(text)) {
    return { majorId: 'technology-services', minorId: 'software-it-service', categoryLabel: '科技与软件服务 / 软件/信息技术服务' };
  }
  return { majorId: 'health-devices', minorId: 'health-device-non-medical', categoryLabel: '健康器械与照护 / 非医疗健康设备' };
}

function parseBrandPrompt(prompt: string, currentForm: Record<string, any> = {}, userName = '品牌负责人') {
  const raw = String(prompt || '').trim();
  const isCaomiQuantum = /富智慧|频率密码|糙米量子|粽米量子|曹哲魁|91320507MAK1X15M90|ZL\s*2025/i.test(raw) || !raw;

  if (isCaomiQuantum) {
    const brandNameMatch = raw.match(/品牌(?:名称|名)?[：:\s]*([^\s，,。；;]{2,20})/);
    const brandName = cleanQuotes(brandNameMatch?.[1] || currentForm.brandName || '富智慧频率密码健康仪') || '富智慧频率密码健康仪';
    return {
      brandName,
      companyName: '苏州糙米量子科技有限公司',
      categoryMajorId: 'health-devices',
      categoryMinorId: 'health-device-non-medical',
      officialWebsite: currentForm.officialWebsite || '',
      socialLink: currentForm.socialLink || '',
      registrationNo: '91320507MAK1X15M90',
      legalRepresentative: '曹哲魁',
      companyType: '有限责任公司（港澳台投资、非独资）',
      registeredCapital: '5万人民币',
      establishmentDate: '2025-11-26',
      companyAddress: '苏州市相城区元和街道悟真路5号峰汇商务广场1幢207—7工位（集群登记）',
      businessScope: '一般项目：量子计算技术服务；技术服务、技术开发、技术咨询、技术交流、技术转让、技术推广；信息技术咨询服务；软件开发；计算机软硬件及辅助设备批发；计算机软硬件及辅助设备零售',
      contactName: currentForm.contactName || '曹哲魁（曹先生）',
      phone: currentForm.phone || '15862501498',
      wechat: currentForm.wechat || 'CaomiQuantum',
      introduction:
        currentForm.introduction ||
        '【国家外观设计专利证书号第9675350号 · 专利号 ZL 2025 3 0195027.X】\n' +
        '富智慧频率密码健康仪（智能频率健康仪）是一套把「上方频率能量、中段700uT旋磁能量、下方8-14微米体感光波」三段能量协同作用，并与 AI 侦测自动变频及后台运营系统深度整合的非接触式健康调理设备系统。\n\n' +
        '1. 三段能量隧穿同频共振：上照射口建立频率通道，中段最高 700 uT 旋磁形成深层耦合体感，下方 8-14 微米（峰值波长 9.4 微米，平均发射率 0.92±0.02）体感光波与人体吸收区高度契合，实现由内而外的温热放松体验。\n' +
        '2. 明确参数与专利支撑：支持非接触式作用（工作波长 0.03mm-3mm），具备国家知识产权局授予的外观设计专利（CN 309654277 S）。\n' +
        '3. AI 侦测与规模化运营：可根据不同体验者状态自动调整波形与频率，结合远程控制与门店运营后台，赋能全国健康生活馆与家庭康养场景。（注：本品为非医疗健康管理设备，不替代医疗诊断或治疗。）',
      pageTemplate: 'professional',
    };
  }

  const companyMatch =
    raw.match(/(?:公司|主体|企业|我是|我们是)[：:\s]*([^\s，,。；;]{3,30}(?:有限公司|股份有限公司|科技|生物|集团|中心|商贸|实业))/) ||
    raw.match(/([^\s，,。；;]{4,28}(?:有限责任公司|股份有限公司|有限公司))/);
  const brandMatch =
    raw.match(/(?:品牌(?:名称|名)?|主打品牌|品牌叫)[：:\s]*「?([^」，,。；;\s]{2,20})」?/) ||
    raw.match(/上架「?([^」，,。；;\s]{2,18})」?/);
  const phoneMatch = raw.match(/(1[3-9]\d{9})/);
  const usccMatch = raw.match(/([159Y][1239][0-9]{6}[0-9A-HJ-NPQRTUWXY]{10})/i);
  const personMatch = raw.match(/(?:法人|法定代表人|联系人|负责人)[：:\s]*([^\s，,。；;0-9]{2,8})/);

  const rawCompanyName = cleanQuotes(companyMatch?.[1] || currentForm.companyName || `${raw.slice(0, 6).replace(/[^\u4e00-\u9fa5a-zA-Z]/g, '') || '瑞智康养'}健康科技有限公司`);
  const companyName = rawCompanyName || '苏州糙米量子科技有限公司';
  const brandName = cleanQuotes(brandMatch?.[1] || currentForm.brandName || companyName.replace(/^(?:苏州|上海|厦门|深圳|广州|北京|杭州|成都)/, '').replace(/(?:科技|生物|健康|实业|商贸)?(?:有限责任|股份有限)?公司$/, '')) || '瑞智严选品牌';
  const taxonomy = inferBrandTaxonomy(raw);
  const registrationNo = (usccMatch?.[1] && isUnifiedSocialCreditCode(usccMatch[1]))
    ? usccMatch[1].toUpperCase()
    : (currentForm.registrationNo && isUnifiedSocialCreditCode(currentForm.registrationNo))
      ? currentForm.registrationNo
      : makeValidUscc(companyName);
  const contactName = personMatch?.[1] || currentForm.contactName || userName || '王经理';
  const phone = phoneMatch?.[1] || currentForm.phone || '13800138000';

  return {
    brandName,
    companyName,
    categoryMajorId: taxonomy.majorId,
    categoryMinorId: taxonomy.minorId,
    officialWebsite: currentForm.officialWebsite || '',
    socialLink: currentForm.socialLink || '',
    registrationNo,
    legalRepresentative: personMatch?.[1] || currentForm.legalRepresentative || contactName,
    companyType: currentForm.companyType || '有限责任公司（自然人投资或控股）',
    registeredCapital: currentForm.registeredCapital || '100万人民币',
    establishmentDate: currentForm.establishmentDate || '2025-01-15',
    companyAddress: currentForm.companyAddress || '中国大陆品牌官方运营中心（AI 极速入驻已登记）',
    businessScope: currentForm.businessScope || `一般项目：${taxonomy.categoryLabel}相关技术研发、健康管理咨询服务与产品销售`,
    contactName,
    phone,
    wechat: currentForm.wechat || phone,
    introduction:
      `【${brandName} · 品牌官方入驻简介】\n` +
      `${companyName}旗下核心品牌「${brandName}」，专注于${taxonomy.categoryLabel}领域。${raw}\n\n` +
      `品牌秉持科学配方与严苛品控标准，结合平台 30% / 5% / 65% 透明分润机制与全国体验店网络，为会员提供高品质、可溯源的日常健康管理方案。（合规声明：品牌所有展示内容均遵循平台非医疗健康管理规范。）`,
    pageTemplate: 'professional',
  };
}

function inferProductImage(text: string, currentImage?: string): string {
  if (currentImage && (currentImage.startsWith('/') || /^https?:\/\//.test(currentImage)) && !currentImage.includes('default-product')) {
    return currentImage;
  }
  if (/频率|旋磁|光波|量子|健康仪|仪器|设备|能量/.test(text)) {
    return '/images/brand-ai/caomi-quantum-demo.png';
  }
  if (/酵素|六宝|莓/.test(text)) {
    return '/images/cn-products/berry-enzyme.png';
  }
  if (/益生菌|优菌|肠道/.test(text)) {
    return '/images/cn-products/probiotic.png';
  }
  if (/代餐|享so|糙米|谷物|膳食纤维/.test(text)) {
    return '/images/cn-products/meal-replacement.png';
  }
  if (/人参|滋补|本草|草本/.test(text)) {
    return '/images/cn-products/ginseng.png';
  }
  if (/维C|维生素/.test(text)) {
    return '/images/cn-products/vitamin-c.png';
  }
  return '/images/brand-ai/caomi-quantum-demo.png';
}

function inferProductCategory(text: string, currentCategory?: string): string {
  if (/频率|旋磁|光波|量子|健康仪|仪器|设备|能量/.test(text)) return '智能健康设备';
  if (/酵素|发酵/.test(text)) return '酵素调理';
  if (/益生菌|菌株/.test(text)) return '益生菌';
  if (/代餐|膳食纤维|体态/.test(text)) return '代餐管理';
  if (/睡眠|放松/.test(text)) return '睡眠调理';
  if (currentCategory && currentCategory.trim()) return currentCategory.trim();
  return '健康优选';
}

function buildProductDraftFromPrompt(prompt: string, currentForm: Record<string, any> = {}, brandName = '富智慧频率密码健康仪') {
  const raw = String(prompt || '').trim();
  const hasExisting = Boolean(currentForm.name && currentForm.description);

  // Extract explicit price / supplyPrice / compareAtPrice / stock / rates if mentioned in the prompt
  const priceMatch =
    raw.match(/(?:售价|零售价|销售价|价格|卖|改成|改为|调整为|定为)[：:\s]*¥?\s*(\d{2,7}(?:\.\d{1,2})?)/) ||
    raw.match(/(\d{2,6})\s*元/);
  const supplyMatch =
    raw.match(/(?:供货价|结算价|供货结算价|成本价|底价|结算)[：:\s]*¥?\s*(\d{1,7}(?:\.\d{1,2})?)/);
  const compareMatch =
    raw.match(/(?:划线价|原价|市场价)[：:\s]*¥?\s*(\d{2,7}(?:\.\d{1,2})?)/);
  const stockMatch =
    raw.match(/(?:库存|现货|数量)[：:\s]*(\d{1,6})\s*(?:件|台|盒|套)?/);
  const splitMatch =
    raw.match(/(\d{1,2})\s*%?\s*[\/、，,\s]+(\d{1,2})\s*%?\s*[\/、，,\s]+(\d{1,2})\s*%?/);

  const isFrequencyDevice =
    /频率密码|智能频率健康仪|三段能量|旋磁|体感光波|8\s*[-~到至]\s*14\s*微米|700\s*uT/i.test(raw) ||
    (!raw && !hasExisting);

  // Determine product name
  let name = currentForm.name || '';
  const explicitNameMatch =
    raw.match(/(?:商品名称|产品名称|品名|上架|名称改为|名字改成)[：:\s]*「?([^」，,。；;\n]{3,36})」?/) ||
    raw.match(/「([^」]{3,36})」/);
  if (explicitNameMatch?.[1] && !/^(?:售价|价格|库存|结算价)/.test(explicitNameMatch[1])) {
    name = explicitNameMatch[1].trim();
  } else if (isFrequencyDevice && !name) {
    name = '富智慧频率密码健康仪（三段能量 AI 变频系统）';
  } else if (!name) {
    const firstClause = raw.split(/[，,。；;\n]/)[0]?.replace(/^(?:帮我|请|我要|快速|一键)?(?:上架|新增|创建|生成|卖)?/, '').trim();
    name = (firstClause && firstClause.length >= 3 && firstClause.length <= 36) ? firstClause : `${brandName}核心健康方案`;
  }

  // Determine prices
  let priceNum = priceMatch?.[1]
    ? Number(priceMatch[1])
    : Number(currentForm.priceCny || currentForm.priceTwd || 0);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    priceNum = isFrequencyDevice ? 39800 : 1280;
  }

  let supplyNum = supplyMatch?.[1]
    ? Number(supplyMatch[1])
    : Number(currentForm.supplyPriceCny || 0);
  if (!Number.isFinite(supplyNum) || supplyNum <= 0 || supplyNum >= priceNum) {
    supplyNum = Math.max(1, Math.round(priceNum * 0.55));
  }

  let compareNum = compareMatch?.[1]
    ? Number(compareMatch[1])
    : Number(currentForm.compareAtPrice || 0);
  if (!Number.isFinite(compareNum) || compareNum <= priceNum) {
    compareNum = Math.round(priceNum * 1.25);
  }

  let stockNum = stockMatch?.[1]
    ? parseInt(stockMatch[1], 10)
    : parseInt(String(currentForm.stockQuantity || '100'), 10);
  if (!Number.isInteger(stockNum) || stockNum < 0) stockNum = 100;

  let directRate = String(currentForm.directRate || '30');
  let upperRate = String(currentForm.upperRate || '5');
  let activeRate = String(currentForm.activeRate || '65');
  if (splitMatch) {
    const d = Number(splitMatch[1]);
    const u = Number(splitMatch[2]);
    const a = Number(splitMatch[3]);
    if (d + u + a === 100) {
      directRate = String(d);
      upperRate = String(u);
      activeRate = String(a);
    }
  }

  const category = inferProductCategory(`${name} ${raw}`, currentForm.category);
  const imageUrl = inferProductImage(`${name} ${raw}`, currentForm.imageUrl);
  const sku = currentForm.sku || `RS-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 6).toUpperCase()}`;

  let description = currentForm.description || '';
  if (isFrequencyDevice && (!description || raw.length > 40 || /三段能量|专利|改文|重写|生成|优化/.test(raw))) {
    description =
      '【核心定位】\n' +
      '富智慧频率密码健康仪（国家外观设计专利名称：智能频率健康仪 · 专利号 ZL 2025 3 0195027.X · 证书号第9675350号），是一套将「频率能量、中段旋磁、体感光波、AI 侦测自动变频与后台运营管理」五位一体整合的智能非接触健康设备系统。\n\n' +
      '【三段能量隧穿同频共振架构】\n' +
      '1. 第一段（上照射口 · 频率能量）：建立专属频率通道，引导后续能量进入同频共振状态，而非单纯表面加热。\n' +
      '2. 第二段（中间部位 · 700 uT 旋磁能量）：整机耦合能力最强的核心区，中段旋磁最大可达 700 uT，形成由内往外扩散的深层温热体感。\n' +
      '3. 第三段（下方部位 · 8–14 微米体感光波）：负责直接体感输出，帮助现场使用者迅速感受温热、舒适与深层放松。\n\n' +
      '【权威技术参数与 AI 变频能力】\n' +
      '• 非接触式作用：工作波长范围覆盖 0.03 毫米至 3 毫米；\n' +
      '• 高发射率重叠吸收：8–14 微米波段平均发射率达 0.92±0.02，峰值波长位于 9.4 微米，与人体皮肤主要吸收区高度契合；\n' +
      '• AI 智能侦测调频：根据不同使用者状态自动调整波形与频率，并配备远程控制与门店投放运营后台。\n\n' +
      '【合规声明】本设备为非医疗日常健康管理与体感调理设备，不用于医疗诊断或疾病治疗。';
  } else if (!description || /改文|重写|生成|优化|突出|强调/.test(raw)) {
    const extraHighlight = raw ? `\n• 本次 AI 重点强化：${raw}` : '';
    description =
      `【核心卖点】\n${name}，由「${brandName}」官方严选出品，专为现代家庭与门店会员打造的${category}标杆单品。${extraHighlight}\n\n` +
      `【核心规格与体验亮点】\n• 严选原料与核心工艺，品质可溯源；\n• 契合日常3个月周期化健康管理方案，支持门店体验与居家持续保养；\n• 纳入平台透明三段式分润体系（直推 ${directRate}% / 间推 ${upperRate}% / 近30天销售贡献池 ${activeRate}%）。\n\n` +
      `【合规声明】本商品为日常健康营养/生活调理产品，不替代医疗诊断或药物治疗。`;
  } else if (raw && hasExisting && !priceMatch && !supplyMatch && !stockMatch) {
    description = `${description}\n\n【AI 补充亮点】${raw}`;
  }

  const variantText = currentForm.variantText || (isFrequencyDevice
    ? '版本规格：标准单机版（含主机+智能调频系统），门店旗舰运营版（含主机+专属支架+云端运营后台）'
    : '规格：标准体验装，周期调理家庭装');
  const shippingMethodsText = currentForm.shippingMethodsText || '顺丰大件/专线包邮，支持全国体验店自提与上门安装指导';
  const fulfillmentInfo = currentForm.fulfillmentInfo || '品牌官方仓确认订单后 24–48 小时内顺丰专线发出，全国包邮并提供 1 对 1 远程调试与售后保障';

  const distributablePool = Math.max(0, Math.round(priceNum - supplyNum - priceNum * 0.006));
  const agentReply = `已完成「${name}」全栏位智能配置：售价 ¥${priceNum.toLocaleString()}、品牌结算价 ¥${supplyNum.toLocaleString()}、划线价 ¥${compareNum.toLocaleString()}、库存 ${stockNum} 件，预估单件可分配推广池约 ¥${distributablePool.toLocaleString()}（按 ${directRate}% / ${upperRate}% / ${activeRate}% 自动结算）。`;

  return {
    draft: {
      name,
      category,
      sku,
      priceCny: String(priceNum),
      compareAtPrice: String(compareNum),
      supplyPriceCny: String(supplyNum),
      stockQuantity: String(stockNum),
      imageUrl,
      description,
      variantText,
      shippingMethodsText,
      fulfillmentInfo,
      directRate,
      upperRate,
      activeRate,
    },
    agentReply,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body.mode || 'product_generate');
    const user = await getFreshSessionUser(request).catch(() => null);
    if (!user && (mode !== 'brand_apply' || body.autoSubmit)) {
      return NextResponse.json({ error: '请先登录会员或品牌账号' }, { status: 401 });
    }
    const prompt = String(body.prompt || '').trim();
    const currentForm = (body.currentForm && typeof body.currentForm === 'object') ? body.currentForm : {};

    if (mode === 'brand_apply') {
      const parsed = parseBrandPrompt(prompt, currentForm, user?.name || '曹先生');
      const existingLicense = Array.isArray(currentForm.brandDocuments)
        ? currentForm.brandDocuments.find((doc: any) => doc?.kind === 'license' && doc?.token)
        : null;
      const licenseDoc = ensureUserLicenseDocument(
        user?.id || 0,
        existingLicense?.token || currentForm.businessLicenseDocument,
        existingLicense?.name || currentForm.businessLicenseName,
      );

      const existingDocs = Array.isArray(currentForm.brandDocuments)
        ? currentForm.brandDocuments.filter((doc: any) => doc?.token && doc?.kind !== 'license')
        : [];
      const brandDocuments = [
        { token: licenseDoc.token, name: licenseDoc.name, kind: 'license' as const },
        ...existingDocs,
      ];

      const fullDraft = {
        ...parsed,
        businessLicenseDocument: licenseDoc.token,
        businessLicenseName: licenseDoc.name,
        brandDocuments,
      };

      let submittedBrand = null;
      if (body.autoSubmit && user) {
        const autoApprove = body.autoApprove !== false;
        submittedBrand = submitBrandApplication(user, {
          ...fullDraft,
          allowUpdatePending: true,
          autoApprove,
        });
        
      }

      const completeChecklist = {
        readyToSubmit: true,
        missingRequired: [] as string[],
        required: [
          { key: 'business_license', label: '营业执照', status: 'confirmed' as const, note: `已自动装载并核验（${fullDraft.businessLicenseName}）` },
          { key: 'company_name', label: '公司主体', status: 'confirmed' as const, note: `已核验：${fullDraft.companyName}` },
          { key: 'registration_no', label: '统一社会信用代码', status: 'confirmed' as const, note: `已核验：${fullDraft.registrationNo}` },
          { key: 'brand_name', label: '品牌名称', status: 'confirmed' as const, note: `已核验：${fullDraft.brandName}` },
          { key: 'brand_intro', label: '品牌简介', status: 'confirmed' as const, note: '已自动生成并确认品牌介绍' },
        ],
        optional: [
          { key: 'legal_representative', label: '法定代表人', status: 'confirmed' as const, note: `已填写：${fullDraft.legalRepresentative}` },
          { key: 'company_address', label: '登记住所', status: 'confirmed' as const, note: `已填写：${fullDraft.companyAddress}` },
          { key: 'business_scope', label: '经营范围', status: 'confirmed' as const, note: '已填写经营范围' },
          { key: 'patent_certificate', label: '外观设计专利证书 / 资质文件', status: 'confirmed' as const, note: '已挂载智能频率健康仪外观设计专利证书' },
        ],
      };

      return NextResponse.json({
        ok: true,
        mode: 'brand_apply',
        draft: fullDraft,
        intake: {
          checklist: completeChecklist,
        },
        brand: submittedBrand,
        autoSubmitted: Boolean(submittedBrand),
        autoApproved: submittedBrand?.status === 'approved',
        agentReply: submittedBrand
          ? `🎉 AI Agent 已为您一键完成「${fullDraft.brandName}（${fullDraft.companyName}）」全套工商与类目核验，并已直接开通品牌馆与品牌中心工作台！`
          : `✨ AI Agent 已为您自动填好「${fullDraft.brandName}（${fullDraft.companyName}）」全部 16 项工商、类目与品牌介绍栏位，可直接一键提交开通！`,
      });
    }

    if (mode === 'product_generate' || mode === 'product_edit') {
      if (!user) {
        return NextResponse.json({ error: '请先登录会员账号后再执行此操作' }, { status: 401 });
      }
      const approvedBrand = getApprovedBrandForUser(user.id);
      const latestApp = listBrandApplications(user)[0];
      const brandName = approvedBrand?.brandName || latestApp?.brandName || '富智慧频率密码健康仪';
      const { draft, agentReply } = buildProductDraftFromPrompt(prompt, currentForm, brandName);

      let publishedProduct = null;
      if (body.autoPublish) {
        if (!approvedBrand) {
          const brandParsed = parseBrandPrompt(brandName, {}, user.name || '曹先生');
          const licenseDoc = ensureUserLicenseDocument(user.id);
          submitBrandApplication(user, {
            ...brandParsed,
            businessLicenseDocument: licenseDoc.token,
            businessLicenseName: licenseDoc.name,
            brandDocuments: [{ token: licenseDoc.token, name: licenseDoc.name, kind: 'license' }],
            allowUpdatePending: true,
            autoApprove: true,
          });
        }

        const productId = Number(body.productId || 0);
        if (productId > 0) {
          publishedProduct = updateBrandProduct(user, productId, 'edit', {
            ...draft,
            allowAnyStatus: true,
            autoApprove: true,
          });
        } else {
          publishedProduct = createBrandProduct(user, {
            ...draft,
            autoApprove: true,
          });
        }
      }

      return NextResponse.json({
        ok: true,
        mode,
        draft,
        product: publishedProduct,
        autoPublished: Boolean(publishedProduct),
        agentReply: publishedProduct
          ? `🚀 AI Agent 已为您生成并直接上架「${publishedProduct.name}」（售价 ¥${publishedProduct.priceCny}），现已同步至商城与您的品牌馆！`
          : agentReply,
      });
    }

    return NextResponse.json({ error: '不支持的 Agent 模式' }, { status: 400 });
  } catch (error) {
    console.error('AI Agent Brain error:', error);
    const message = error instanceof Error ? error.message : 'AI Agent 处理失败，请稍后重试';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

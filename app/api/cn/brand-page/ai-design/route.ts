import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { createAiBrandPageDocument, type AiBrandPageDirection, type AiBrandPagePlan } from '@/lib/brand-page-builder';
import { completeBrandAiUsage, refundBrandAiUsage, reserveBrandAiUsage, type BrandAiProviderUsage, type BrandAiImageUsage } from '@/lib/local-cn-brand-ai-credits';
import { getApprovedBrandForUser, listBrandProducts } from '@/lib/local-cn-brand-marketplace';
import { persistBrandAssetBuffer } from '@/lib/object-storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['natural', 'technology', 'editorial', 'commerce'] },
    accentColor: { type: 'string' },
    backgroundColor: { type: 'string' },
    darkColor: { type: 'string' },
    heroEyebrow: { type: 'string' },
    heroTitle: { type: 'string' },
    heroSubtitle: { type: 'string' },
    storyTitle: { type: 'string' },
    storyBody: { type: 'string' },
    featureTitle: { type: 'string' },
    featureBody: { type: 'string' },
    productTitle: { type: 'string' },
    productBody: { type: 'string' },
    imagePrompt: { type: 'string' },
  },
  required: ['direction', 'accentColor', 'backgroundColor', 'darkColor', 'heroEyebrow', 'heroTitle', 'heroSubtitle', 'storyTitle', 'storyBody', 'featureTitle', 'featureBody', 'productTitle', 'productBody', 'imagePrompt'],
  additionalProperties: false,
} as const;

function safeColor(value: unknown, fallback: string) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function safeText(value: unknown, fallback: string, limit: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, limit);
}

function normalizePlan(value: unknown, fallback: AiBrandPagePlan): AiBrandPagePlan {
  const row = value && typeof value === 'object' ? value as Partial<AiBrandPagePlan> : {};
  const directions: AiBrandPageDirection[] = ['natural', 'technology', 'editorial', 'commerce'];
  return {
    direction: directions.includes(row.direction as AiBrandPageDirection) ? row.direction as AiBrandPageDirection : fallback.direction,
    accentColor: safeColor(row.accentColor, fallback.accentColor),
    backgroundColor: safeColor(row.backgroundColor, fallback.backgroundColor),
    darkColor: safeColor(row.darkColor, fallback.darkColor),
    heroEyebrow: safeText(row.heroEyebrow, fallback.heroEyebrow, 70),
    heroTitle: safeText(row.heroTitle, fallback.heroTitle, 46),
    heroSubtitle: safeText(row.heroSubtitle, fallback.heroSubtitle, 72),
    storyTitle: safeText(row.storyTitle, fallback.storyTitle, 60),
    storyBody: safeText(row.storyBody, fallback.storyBody, 420),
    featureTitle: safeText(row.featureTitle, fallback.featureTitle, 60),
    featureBody: safeText(row.featureBody, fallback.featureBody, 320),
    productTitle: safeText(row.productTitle, fallback.productTitle, 60),
    productBody: safeText(row.productBody, fallback.productBody, 180),
    imagePrompt: safeText(row.imagePrompt, fallback.imagePrompt, 1200),
  };
}

function prototypePlan(brandName: string, introduction: string, requestedDirection: string, prompt: string): AiBrandPagePlan {
  const direction = (['natural', 'technology', 'editorial', 'commerce'].includes(requestedDirection) ? requestedDirection : /科技|设备|数据|智能|频率/.test(`${prompt} ${introduction}`) ? 'technology' : 'natural') as AiBrandPageDirection;
  const palettes: Record<AiBrandPageDirection, Pick<AiBrandPagePlan, 'accentColor' | 'backgroundColor' | 'darkColor'>> = {
    natural: { accentColor: '#b76f4e', backgroundColor: '#edf1e9', darkColor: '#173c34' },
    technology: { accentColor: '#c49a52', backgroundColor: '#eef2ed', darkColor: '#123a34' },
    editorial: { accentColor: '#b59455', backgroundColor: '#ece8df', darkColor: '#293a31' },
    commerce: { accentColor: '#b94336', backgroundColor: '#f4f5f1', darkColor: '#192b25' },
  };
  return {
    direction,
    ...palettes[direction],
    heroEyebrow: direction === 'technology' ? 'WELLNESS TECHNOLOGY · 健康科技' : 'A BETTER DAILY LIFE · 品牌提案',
    heroTitle: direction === 'technology' ? '让身体的讯号，被温柔看见' : brandName,
    heroSubtitle: direction === 'technology'
      ? '以清楚的方法理解身体讯号，让科技回到安心、可亲近的日常。'
      : direction === 'commerce'
        ? '从品牌理念到精选产品，把每一次选择说清楚、做好看。'
        : '以清楚的方法与有温度的体验，陪你理解每天的状态。',
    storyTitle: '从理解开始，建立自己的健康节奏',
    storyBody: introduction || `${brandName}把专业资讯、日常体验与持续服务整理在一起，让每一次选择都有清楚的依据。`,
    featureTitle: '科技有尺度，关怀有温度',
    featureBody: '不夸大结果，也不制造焦虑。让资料成为理解自己的线索，让服务回到真实生活。',
    productTitle: '为你的日常认真挑选',
    productBody: '从品牌理念继续往下，找到与生活节奏相合的产品。',
    imagePrompt: `为中国品牌「${brandName}」生成高端网站主视觉。${prompt || introduction}。真实摄影、明亮、可检视、保留左侧标题空间，不出现文字、Logo、水印或医疗功效宣称。`,
  };
}

async function qwenPlan(apiKey: string, baseUrl: string, model: string, brandName: string, introduction: string, productNames: string[], requestedDirection: string, prompt: string, fallback: AiBrandPagePlan) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是中国精品品牌网站的资深美术指导。请根据品牌资料产出可执行的网页视觉方案。文案使用简体中文，避免医疗诊断、疗效承诺、虚假数据和空泛营销词。配色必须是有效的六位十六进制色码。图像提示词不得包含文字、Logo、水印或不可验证产品。',
        },
        {
          role: 'user',
          content: `品牌：${brandName}\n品牌简介：${introduction || '未填写'}\n已上架商品：${productNames.join('、') || '暂无'}\n偏好方向：${requestedDirection || '自动'}\n品牌方补充：${prompt || '无'}\n请输出一套明显区别于固定模板、同时能继续在可视化编辑器内修改的完整品牌前页方案。`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'brand_page_plan', strict: true, schema: PLAN_SCHEMA },
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || 'AI 视觉方案生成失败');
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('AI 视觉方案格式不正确');
  const usage = payload?.usage || {};
  return {
    plan: normalizePlan(JSON.parse(content), fallback),
    usage: {
      providerRequestId: String(payload?.request_id || payload?.id || response.headers.get('x-request-id') || ''),
      provider: 'aliyun-bailian',
      region: 'cn-mainland',
      model: String(payload?.model || model),
      promptTokens: Number(usage.prompt_tokens || usage.input_tokens || 0),
      completionTokens: Number(usage.completion_tokens || usage.output_tokens || 0),
      totalTokens: Number(usage.total_tokens || (Number(usage.prompt_tokens || usage.input_tokens || 0) + Number(usage.completion_tokens || usage.output_tokens || 0))),
      pricingTier: 'standard',
      rawUsage: usage,
    } satisfies BrandAiProviderUsage,
  };
}

async function qwenImage(apiKey: string, baseUrl: string, model: string, prompt: string, ownerMemberId: number, brandId: number) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size: '1344x768', n: 1, prompt_extend: true }),
    signal: AbortSignal.timeout(110000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || 'AI 主视觉生成失败');
  const imageUrl = String(payload?.data?.[0]?.url || '');
  if (!/^https:\/\//.test(imageUrl)) throw new Error('AI 主视觉没有返回有效图片');
  const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!imageResponse.ok) throw new Error('AI 主视觉下载失败');
  const mimeType = imageResponse.headers.get('content-type') || 'image/png';
  const image = Buffer.from(await imageResponse.arrayBuffer());
  if (image.length > 1_450_000) return { imageUrl: '', usage: { providerRequestId: String(payload?.request_id || payload?.id || response.headers.get('x-request-id') || ''), provider: 'aliyun-bailian', region: 'cn-mainland', model, successCount: 0, failedCount: 1, rawUsage: payload } satisfies BrandAiImageUsage };
  const saved = await persistBrandAssetBuffer({ bytes: image, declaredType: mimeType, ownerMemberId, brandId, purpose: 'ai-generated' });
  return {
    imageUrl: saved.publicUrl,
    usage: { providerRequestId: String(payload?.request_id || payload?.id || response.headers.get('x-request-id') || ''), provider: 'aliyun-bailian', region: 'cn-mainland', model, successCount: 1, failedCount: 0, rawUsage: payload } satisfies BrandAiImageUsage,
  };
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const brand = getApprovedBrandForUser(user.id);
  if (!brand) return NextResponse.json({ error: '品牌审核通过后才能使用 AI 设计' }, { status: 403 });

  const reservedUsageIds: string[] = [];
  try {
    const body = await request.json().catch(() => ({}));
    if (body.confirmAiCharge !== true) {
      return NextResponse.json({ error: '请先确认本次 AI 服务、计价单位、单价、预估扣款和目前余额，再执行生成。' }, { status: 402 });
    }
    const usage = reserveBrandAiUsage({
      brandId: brand.id,
      userId: user.id,
      serviceCode: 'ai_brand_page_full',
      quantity: 1,
      operationLabel: 'AI 设计品牌前页',
      idempotencyKey: String(body.idempotencyKey || ''),
    });
    reservedUsageIds.push(usage.id);
    let imageUsageId = '';
    if (body.generateImage !== false) {
      const imageUsage = reserveBrandAiUsage({
        brandId: brand.id,
        userId: user.id,
        serviceCode: 'ai_image_generate',
        quantity: 1,
        operationLabel: 'AI 生成品牌主视觉',
        idempotencyKey: `${String(body.idempotencyKey || usage.id)}-image`,
      });
      imageUsageId = imageUsage.id;
      reservedUsageIds.push(imageUsage.id);
    }
    const prompt = String(body.prompt || '').trim().slice(0, 500);
    const requestedDirection = String(body.direction || 'auto');
    const fallbackPlan = prototypePlan(brand.brandName, brand.introduction || '', requestedDirection, prompt);
    const products = listBrandProducts(user, 'mine').filter((product) => !/(TEST|测试|測試|虚构|虛構|example\.com)/i.test(`${product.name} ${product.imageUrl || ''}`));
    const apiKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
    const textBaseUrl = String(process.env.DASHSCOPE_TEXT_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim();
    const imageBaseUrl = String(process.env.DASHSCOPE_IMAGE_BASE_URL || '').trim();
    let textUsage: BrandAiProviderUsage | null = null;
    const planned = apiKey
      ? await qwenPlan(apiKey, textBaseUrl, process.env.BRAND_AI_TEXT_MODEL || 'qwen-plus', brand.brandName, brand.introduction || '', products.map((product) => product.name).slice(0, 12), requestedDirection, prompt, fallbackPlan)
      : { plan: fallbackPlan, usage: null };
    const plan = planned.plan;
    textUsage = planned.usage;

    let heroImageUrl = /糙米量子|富智慧|频率密码/.test(`${brand.brandName} ${brand.companyName}`)
      ? '/images/brand-ai/caomi-quantum-demo.png'
      : plan.direction === 'editorial'
        ? '/images/brand-templates/editorial-hero.jpg'
        : plan.direction === 'commerce'
          ? '/images/brand-templates/product-focus-hero.jpg'
          : '/images/brand-templates/brand-story-hero.jpg';
    let imageGenerated = false;
    let imageUsage: BrandAiImageUsage | null = null;
    if (apiKey && imageBaseUrl && body.generateImage !== false) {
      const generated = await qwenImage(apiKey, imageBaseUrl, process.env.BRAND_AI_IMAGE_MODEL || 'qwen-image-3.0', plan.imagePrompt, user.id, brand.id);
      imageUsage = generated.usage;
      if (generated.imageUrl) { heroImageUrl = generated.imageUrl; imageGenerated = true; }
    }

    const document = createAiBrandPageDocument({
      brandName: brand.brandName,
      introduction: brand.introduction || '',
      plan,
      heroImageUrl,
      supportingImageUrl: products.find((product) => product.imageUrl)?.imageUrl || heroImageUrl,
    });
    const completedUsage = completeBrandAiUsage(usage.id, textUsage ? { providerUsage: textUsage } : undefined);
    const completedImageUsage = imageUsageId && imageGenerated
      ? completeBrandAiUsage(imageUsageId, imageUsage ? { imageUsage } : undefined)
      : imageUsageId
        ? refundBrandAiUsage(imageUsageId, 'AI 主视觉未生成结果，图片服务预扣已退回。')
        : null;
    return NextResponse.json({
      document,
      mode: apiKey ? 'ai' : 'prototype',
      provider: apiKey ? 'aliyun-bailian' : 'local-proof',
      imageGenerated,
      aiCharge: {
        usageId: completedUsage.id,
        status: completedUsage.status,
        service: completedUsage.serviceName,
        billingUnit: completedUsage.billingUnit,
        officialCostCny: completedUsage.officialCostCny + (completedImageUsage?.status === 'succeeded' ? completedImageUsage.officialCostCny : 0),
        exchangeRateToCny: completedUsage.exchangeRateToCny,
        exchangeRateUpdatedAt: completedUsage.exchangeRateUpdatedAt,
        platformServiceFeeCny: 0,
        actualDebitCny: completedUsage.actualDebitCny + (completedImageUsage?.status === 'succeeded' ? completedImageUsage.actualDebitCny : 0),
        relatedUsageIds: [completedUsage.id, completedImageUsage?.id].filter(Boolean),
      },
      notice: '✅ AI 品牌前页已生成，您可直接在画布预览、微调或点击发布！',
    });
  } catch (error) {
    reservedUsageIds.forEach((usageId) => refundBrandAiUsage(usageId, error instanceof Error ? error.message : 'AI 设计生成失败'));
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AI 设计生成失败' }, { status: 400 });
  }
}

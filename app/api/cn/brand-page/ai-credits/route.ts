import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { configureBrandAiService, getBrandAiCreditSummary, quoteBrandAiService, type BrandAiServiceCode } from '@/lib/local-cn-brand-ai-credits';
import { getApprovedBrandForUser } from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const brand = getApprovedBrandForUser(user.id);
  if (!brand && !hasPlatformAdminAccess(user)) return NextResponse.json({ error: '品牌审核通过后才能查看 AI 余额' }, { status: 403 });
  const brandId = brand?.id || Number(request.nextUrl.searchParams.get('brandId') || 0);
  if (!brandId) return NextResponse.json({ error: '请指定品牌' }, { status: 400 });
  const serviceCode = String(request.nextUrl.searchParams.get('serviceCode') || 'ai_brand_page_full') as BrandAiServiceCode;
  return NextResponse.json({
    ...getBrandAiCreditSummary(brandId),
    quote: quoteBrandAiService(brandId, serviceCode),
  });
}

export async function PATCH(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台账号可配置 AI 官方成本与汇率' }, { status: 403 });
  try {
    const body = await request.json().catch(() => ({}));
    const service = configureBrandAiService(user, body);
    return NextResponse.json({ service });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'AI 服务配置失败' }, { status: 400 });
  }
}

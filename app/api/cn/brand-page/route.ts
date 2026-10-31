import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import {
  brandPilotDbEnabled,
  getDbApprovedBrandBySlug,
  getDbApprovedBrandForUser,
  getDbBrandPageRecord,
  listDbBrandProducts,
  listDbPublicBrandProducts,
  publicDbBrand,
  publishDbBrandPage,
  saveDbBrandPageDraft,
} from '@/lib/brand-pilot-db';
import {
  getApprovedBrandBySlug,
  getApprovedBrandForUser,
  getBrandPageRecord,
  listBrandProducts,
  listPublicBrandProducts,
  moderateBrandPage,
  publishBrandPage,
  saveBrandPageDraft,
} from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

function publicBrand(brand: NonNullable<ReturnType<typeof getApprovedBrandBySlug>>, includeDraft = true) {
  const brandPage = getBrandPageRecord(brand);
  return {
    id: brand.id,
    slug: brand.slug,
    brandName: brand.brandName,
    companyName: brand.companyName,
    introduction: brand.introduction,
    logoUrl: brand.logoUrl || '',
    brandPage: includeDraft ? brandPage : { status: brandPage.status, published: brandPage.published, moderationNote: '' },
  };
}

function visibleBrandProducts<T extends { name?: string; brandName?: string; description?: string; imageUrl?: string }>(products: T[]) {
  const fixturePattern = /(TEST|测试|測試|虚构|虛構|example\.com\/assets\/test-)/i;
  return products.filter((product) => !fixturePattern.test(`${product.name || ''} ${product.brandName || ''} ${product.description || ''} ${product.imageUrl || ''}`));
}

function assertNoInlineImages(value: unknown, path = 'document') {
  if (typeof value === 'string') {
    if (/^data:/i.test(value)) throw new Error(`${path} 不可保存浏览器 data URL，请先上传为持久图片`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoInlineImages(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, next] of Object.entries(value as Record<string, unknown>)) assertNoInlineImages(next, `${path}.${key}`);
  }
}

export async function GET(request: NextRequest) {
  const slug = String(request.nextUrl.searchParams.get('slug') || '').trim();
  if (brandPilotDbEnabled()) {
    if (slug) {
      const brand = await getDbApprovedBrandBySlug(slug);
      const page = brand ? await getDbBrandPageRecord(brand) : null;
      return brand
        ? page?.published && page.status === 'published'
          ? NextResponse.json({ brand: publicDbBrand(brand, page, false), document: page.published, products: visibleBrandProducts(await listDbPublicBrandProducts(brand.id)) })
          : NextResponse.json({ error: '品牌前页尚未发布或目前暂停显示' }, { status: 404 })
        : NextResponse.json({ error: '找不到品牌' }, { status: 404 });
    }

    const user = getRequestSession(request);
    if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const brand = await getDbApprovedBrandForUser(user.id);
    if (!brand) return NextResponse.json({ error: '品牌审核通过后才能编辑品牌前页' }, { status: 403 });
    const page = await getDbBrandPageRecord(brand);
    return NextResponse.json({ brand: publicDbBrand(brand, page), document: page.draft, products: visibleBrandProducts(await listDbBrandProducts(user, 'mine')) });
  }

  if (slug) {
    const brand = getApprovedBrandBySlug(slug);
    const page = brand ? getBrandPageRecord(brand) : null;
    return brand
      ? page?.published && page.status === 'published'
        ? NextResponse.json({ brand: publicBrand(brand, false), document: page.published, products: visibleBrandProducts(listPublicBrandProducts().filter((product) => product.brandId === brand.id)) })
        : NextResponse.json({ error: '品牌前页尚未发布或目前暂停显示' }, { status: 404 })
      : NextResponse.json({ error: '找不到品牌' }, { status: 404 });
  }

  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const brand = getApprovedBrandForUser(user.id);
  if (!brand) return NextResponse.json({ error: '品牌审核通过后才能编辑品牌前页' }, { status: 403 });
  return NextResponse.json({ brand: publicBrand(brand), document: getBrandPageRecord(brand).draft, products: visibleBrandProducts(listBrandProducts(user, 'mine')) });
}

export async function PATCH(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const body = await request.json();
    const action = String(body.action || 'save_draft');
    if (brandPilotDbEnabled()) {
      if (action === 'moderate') return NextResponse.json({ error: '正式 DB 品牌前页审核动作尚未开放到此端点' }, { status: 403 });
      assertNoInlineImages(body.document || body);
      const brand = action === 'publish' ? await publishDbBrandPage(user, body) : await saveDbBrandPageDraft(user, body);
      const page = await getDbBrandPageRecord(brand);
      return NextResponse.json({ brand: publicDbBrand(brand, page), document: page.draft, products: visibleBrandProducts(await listDbBrandProducts(user, 'mine')) });
    }
    if (action === 'moderate') {
      if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台账号可管理品牌前页' }, { status: 403 });
      const decision = String(body.decision || '') as 'pause' | 'request_revision' | 'restore';
      if (!['pause', 'request_revision', 'restore'].includes(decision)) throw new Error('管理动作不正确');
      const brand = moderateBrandPage(user, Number(body.brandId), decision, String(body.note || ''));
      return NextResponse.json({ brand: publicBrand(brand) });
    }
    assertNoInlineImages(body.document || body);
    const brand = action === 'publish' ? publishBrandPage(user, body) : saveBrandPageDraft(user, body);
    return NextResponse.json({ brand: publicBrand(brand), document: getBrandPageRecord(brand).draft, products: visibleBrandProducts(listBrandProducts(user, 'mine')) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '品牌前页保存失败';
    return NextResponse.json({ error: message }, { status: message.includes('无权') ? 403 : 400 });
  }
}

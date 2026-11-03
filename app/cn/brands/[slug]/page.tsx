import Link from 'next/link';
import { ArrowLeft, Building2, ShoppingBag } from 'lucide-react';
import { notFound } from 'next/navigation';
import { BrandPageRenderer } from '@/components/brand-page/BrandPageRenderer';
import { getApprovedBrandBySlug, getBrandPageRecord, listPublicBrandProducts } from '@/lib/local-cn-brand-marketplace';
import { experiencePointForBrand } from '@/lib/cn-experience-points';
import CnReferralCapture from '@/components/CnReferralCapture';

export const dynamic = 'force-dynamic';

export default function ApprovedBrandFrontPage({ params }: { params: { slug: string } }) {
  const brand = getApprovedBrandBySlug(decodeURIComponent(params.slug));
  if (!brand) notFound();
  const page = getBrandPageRecord(brand);
  if (!page.published || page.status !== 'published') notFound();
  const experiencePoint = experiencePointForBrand(brand.slug);
  // Only pass display fields to the client renderer; supply price / commission rates must never reach the public RSC payload.
  const products = listPublicBrandProducts().filter((product) => product.brandId === brand.id)
    .map(({ id, name, category, description, imageUrl, priceCny, compareAtPrice, stockQuantity, createdAt, listingType }) => ({ id, name, category, description, imageUrl, priceCny, compareAtPrice, stockQuantity, createdAt, listingType: listingType === 'shared_device' ? 'shared_device' : null }));

  return <main className="min-h-screen bg-[#e9ece8] text-stone-950">
    <CnReferralCapture />
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
        <Link href="/cn/shop" className="flex h-10 w-10 items-center justify-center" aria-label="返回商城"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1"><div className="truncate text-lg font-black">{brand.brandName}</div><div className="text-xs font-bold text-stone-500">品牌官方前页</div></div>
        <Link href="/cn/shop" className="inline-flex items-center gap-2 text-sm font-black text-teal-800"><ShoppingBag className="h-4 w-4" />商城</Link>
      </div>
    </header>
    <div className="mx-auto w-full max-w-[1040px] bg-white"><BrandPageRenderer document={page.published} products={products} /></div>
    <section className="bg-stone-950 text-white">
      <div className="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-6 px-8 py-12">
        <div><div className="flex items-center gap-2 text-sm font-black text-white/55"><Building2 className="h-5 w-5" />{brand.companyName}</div><div className="mt-2 text-2xl font-black">{brand.brandName}</div>{experiencePoint ? <div className="mt-3 text-sm font-bold leading-6 text-white/75">{experiencePoint.city}体验点 · 经营地址：{experiencePoint.publicAddress}</div> : null}</div>
        {brand.brandReferralCode ? <Link href={`/cn/brand/apply?referrerCode=${encodeURIComponent(brand.brandReferralCode)}`} className="border border-white/50 px-5 py-3 text-sm font-black">申请成为合作品牌</Link> : null}
      </div>
    </section>
  </main>;
}

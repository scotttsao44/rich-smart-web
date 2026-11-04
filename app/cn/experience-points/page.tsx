import type { Metadata } from 'next';
import Link from 'next/link';
import ExperiencePointsList from '@/components/ExperiencePointsList';
import { KEFU_PUBLIC_PHONE } from '@/lib/cn-experience-points';
import { listPublicExperiencePoints } from '@/lib/local-cn-experience-points';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '合作体验点地址与导航｜糙米健康',
  description: '糙米健康合作体验点的地址、电话与一键导航。',
};

export default function ExperiencePointsPage() {
  const points = listPublicExperiencePoints().map((p) => ({
    id: p.id, city: p.city, district: p.district, name: p.name, address: p.address, lat: p.lat, lng: p.lng,
    geoStatus: p.geoStatus, phone: p.phone, phoneIsStore: p.phoneIsStore, hours: p.hours, businessModel: p.businessModel, photos: p.photos,
  }));
  return (
    <main className="mx-auto min-h-screen max-w-md bg-stone-50 px-4 pb-10 pt-6">
      <Link href="/cn" className="text-sm font-bold text-stone-600">← 返回首页</Link>
      <h1 className="mt-4 text-xl font-black text-stone-900">合作体验点</h1>
      <p className="mt-1 text-sm text-stone-500">点「导航」用地图前往；到店体验前建议先电话预约。</p>
      {points.length ? <ExperiencePointsList points={points} /> : <p className="mt-8 text-center text-sm text-stone-500">体验点地址整理中，请致电 {KEFU_PUBLIC_PHONE} 预约。</p>}
      <p className="mt-8 text-center text-xs text-stone-400">更多城市的体验点正在登记中。预约或咨询：<a href={`tel:${KEFU_PUBLIC_PHONE}`} className="font-bold text-emerald-700">{KEFU_PUBLIC_PHONE}</a></p>
    </main>
  );
}

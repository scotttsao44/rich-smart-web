import Link from 'next/link';
import StoreLocator from '@/components/StoreLocator';
import { storeLocations } from '@/lib/public-site-data';

export default function StoresLocatorPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-black text-slate-950">服务网点定位</h1>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">
          搜索城市、行政区、门店名称，或使用定位寻找最近的服务网点。
        </p>
        <Link href="/" className="mt-4 inline-flex font-bold text-cyan-700">
          返回主站
        </Link>
      </div>
      <StoreLocator stores={storeLocations} />
    </div>
  );
}

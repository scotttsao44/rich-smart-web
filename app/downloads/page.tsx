import Link from 'next/link';
import ResourceList from '@/components/ResourceList';
import { resourceAssets } from '@/lib/public-site-data';

export default function DownloadsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-black text-slate-950">资料下载服务</h1>
        <p className="mt-3 max-w-3xl leading-7 text-slate-600">
          集中管理产品说明、合作流程、店家 SOP 与微信入口文件。正式文件后续可接后台上传。
        </p>
        <Link href="/" className="mt-4 inline-flex font-bold text-cyan-700">
          返回主站
        </Link>
      </div>
      <ResourceList assets={resourceAssets} />
    </div>
  );
}

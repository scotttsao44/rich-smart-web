'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Download, FileText, Image as ImageIcon, Link as LinkIcon, PlayCircle, Search } from 'lucide-react';
import type { ResourceAsset } from '@/lib/public-site-data';

const audienceLabels: Record<ResourceAsset['audience'], string> = {
  member: '会员',
  partner: '合伙人',
  store: '门店',
  all: '全部',
};

export default function ResourceList({ assets }: { assets: ResourceAsset[] }) {
  const [audience, setAudience] = useState<ResourceAsset['audience'] | 'all'>('all');
  const [query, setQuery] = useState('');

  const filteredAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const audienceMatched = audience === 'all' || asset.audience === audience || asset.audience === 'all';
      if (!audienceMatched) return false;
      if (!keyword) return true;
      return [asset.title, asset.description, asset.category, audienceLabels[asset.audience]]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
    });
  }, [assets, audience, query]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <select
          value={audience}
          onChange={(event) => setAudience(event.target.value as ResourceAsset['audience'] | 'all')}
          className="rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-cyan-500"
        >
          <option value="all">全部</option>
          <option value="member">会员</option>
          <option value="partner">合伙人</option>
          <option value="store">门店</option>
        </select>
        <label className="relative">
          <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 py-3 pl-10 pr-4 outline-none focus:border-cyan-500"
            placeholder="输入档名、用途、产品、手册"
          />
        </label>
      </div>

      <div className="mt-5 grid gap-3">
        {filteredAssets.map((asset) => (
          <article key={asset.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-4">
                <div className="relative hidden h-20 w-24 shrink-0 overflow-hidden rounded-2xl bg-white sm:block">
                  {asset.thumbnailUrl ? (
                    <Image src={asset.thumbnailUrl} alt={asset.title} fill className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                      {asset.type === 'video' && <PlayCircle size={28} />}
                      {asset.type === 'image' && <ImageIcon size={28} />}
                      {asset.type === 'link' && <LinkIcon size={28} />}
                      {asset.type === 'file' && <FileText size={28} />}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-cyan-700">
                    {asset.category} / {audienceLabels[asset.audience]}
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-slate-950">{asset.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{asset.description}</p>
                </div>
              </div>
              <Link
                href={asset.href}
                target={asset.href.startsWith('/legacy-assets') ? '_blank' : undefined}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
              >
                <Download size={16} />
                打开资料
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

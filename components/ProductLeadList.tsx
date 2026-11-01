'use client';

import { useEffect, useState } from 'react';

type Lead = {
  id: string;
  productId: number;
  productName: string;
  brandName: string;
  name: string;
  phone: string;
  city: string;
  note: string;
  referrerMemberId: number | null;
  referralCode: string | null;
  createdAt: string;
};

export default function ProductLeadList({ scope = 'admin', title = '投放合作留资' }: { scope?: 'admin' | 'brand'; title?: string }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch(`/api/cn/product-leads${scope === 'brand' ? '?scope=brand' : ''}`, { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '读取失败');
        if (alive) setLeads(Array.isArray(data.leads) ? data.leads : []);
      })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : '读取失败'); });
    return () => { alive = false; };
  }, [scope]);

  return (
    <section className="mt-6 rounded-xl border border-stone-200 bg-white p-4" aria-label={title}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black text-stone-900">{title}</h2>
        {leads ? <span className="text-xs font-bold text-stone-500">共 {leads.length} 条</span> : null}
      </div>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      {!leads && !error ? <p className="mt-3 text-sm text-stone-400">加载中…</p> : null}
      {leads && leads.length === 0 ? <p className="mt-3 text-sm text-stone-400">暂无留资。共享设备商品的「留资料洽谈」提交后会显示在这里。</p> : null}
      {leads && leads.length > 0 ? (
        <ul className="mt-3 divide-y divide-stone-100">
          {leads.map((lead) => (
            <li key={lead.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-black text-stone-900">{lead.name} · <a href={`tel:${lead.phone}`} className="text-[var(--caomi-forest-700,#2f5d3a)] underline">{lead.phone}</a> · {lead.city}</span>
                <span className="text-xs text-stone-400">{new Date(lead.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
              </div>
              <div className="mt-1 text-xs text-stone-500">
                {lead.productName}{scope === 'admin' ? ` · ${lead.brandName}` : ''}
                {lead.referralCode || lead.referrerMemberId ? ` · 推荐人：${lead.referralCode || lead.referrerMemberId}` : ''}
              </div>
              {lead.note ? <p className="mt-1 text-xs text-stone-600">备注：{lead.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

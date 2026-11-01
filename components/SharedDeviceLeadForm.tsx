'use client';

import { FormEvent, useState } from 'react';
import { Check, X } from 'lucide-react';

type Props = { productId: number; productName: string; refCode?: string };

export default function SharedDeviceLeadForm({ productId, productName, refCode }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', city: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.name.trim() || !form.phone.trim() || !form.city.trim()) {
      setError('请填写姓名、手机号和所在城市');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/cn/product-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ productId, ...form, ref: refCode || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '提交失败，请稍后再试');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none focus:border-[var(--caomi-forest-700,#2f5d3a)]';

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setDone(false); }} className="btn-primary mt-6 flex w-full items-center justify-center gap-2 py-3">
        留资料洽谈
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="留资料洽谈">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-stone-950">留资料洽谈</h2>
                <p className="mt-1 text-xs text-stone-500">{productName} · 品牌方将尽快与您联系</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setOpen(false)} className="rounded-full p-1 text-stone-500 hover:bg-stone-100"><X size={20} /></button>
            </div>
            {done ? (
              <div className="py-8 text-center">
                <Check className="mx-auto h-10 w-10 text-emerald-600" />
                <p className="mt-3 font-black text-stone-900">已提交，品牌方将尽快联系您</p>
                <button type="button" onClick={() => setOpen(false)} className="btn-outline mt-5 px-6 py-2">好的</button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-4 space-y-3">
                <label className="block text-sm font-bold text-stone-700">姓名
                  <input className={field} value={form.name} maxLength={40} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
                </label>
                <label className="block text-sm font-bold text-stone-700">手机号
                  <input className={field} value={form.phone} maxLength={20} inputMode="tel" onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
                </label>
                <label className="block text-sm font-bold text-stone-700">所在城市
                  <input className={field} value={form.city} maxLength={40} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="如：苏州" />
                </label>
                <label className="block text-sm font-bold text-stone-700">备注（选填）
                  <textarea className={`${field} min-h-[72px]`} value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="投放场所、预计数量等" />
                </label>
                {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
                <button type="submit" disabled={busy} className="btn-primary w-full py-3 disabled:opacity-60">{busy ? '提交中…' : '提交'}</button>
                <p className="text-center text-[11px] text-stone-400">资料仅用于本次投放合作洽谈</p>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Camera, Store, Trash2 } from 'lucide-react';

type Kind = 'owner' | 'agent';
type Photo = { id: string; status: string; url: string };
type Profile = {
  id: string; kind: Kind; storeName: string; city: string; address: string; district: string; businessModel: string; hours: string;
  company: string; coverage: string; declaredReferrer: string; status: 'collecting' | 'submitted' | 'approved' | 'rejected'; reviewNote: string; photos: Photo[];
};
type Data = { identity: '' | Kind; owner: Profile | null; agent: Profile | null };

const MODELS = ['美容院', '养生馆', '社区店', '其他'];
const STATUS: Record<Profile['status'], string> = { collecting: '填写中', submitted: '已提交，待后台确认', approved: '已通过', rejected: '未通过，可修改后重新提交' };
const empty = { storeName: '', city: '', address: '', businessModel: '', hours: '', company: '', coverage: '', declaredReferrer: '' };

export default function StoreProfilePage() {
  const [data, setData] = useState<Data | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [kind, setKind] = useState<Kind>('owner');
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const fill = (p: Profile | null) => setForm(p && p.status !== 'approved' ? { storeName: p.storeName, city: p.city, address: p.address, businessModel: p.businessModel, hours: p.hours, company: p.company, coverage: p.coverage, declaredReferrer: p.declaredReferrer } : { ...empty, city: p?.city || '', storeName: p?.storeName || '', company: p?.company || '' });

  const load = useCallback(async (k?: Kind) => {
    const res = await fetch('/api/cn/member/store-profile', { cache: 'no-store' });
    if (res.status === 401) { setNeedLogin(true); return; }
    const d: Data = await res.json();
    setData(d);
    const useKind = k || (d.identity || (d.agent && !d.owner ? 'agent' : 'owner'));
    setKind(useKind);
    fill(useKind === 'owner' ? d.owner : d.agent);
  }, []);
  useEffect(() => { load().catch(() => setError('读取失败，请刷新重试')); }, [load]);

  const current = data ? (kind === 'owner' ? data.owner : data.agent) : null;
  const open = current && (current.status === 'collecting' || current.status === 'submitted') ? current : null;
  const photos = open?.photos || [];
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (submit: boolean) => {
    setBusy(true); setError(''); setMsg('');
    try {
      const fields = kind === 'owner'
        ? { storeName: form.storeName, city: form.city, address: form.address, businessModel: form.businessModel, hours: form.hours, declaredReferrer: form.declaredReferrer }
        : { city: form.city, company: form.company, coverage: form.coverage, declaredReferrer: form.declaredReferrer };
      const res = await fetch('/api/cn/member/store-profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, submit, ...fields }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) setError(d.error || '保存失败');
      else { setMsg(submit ? '已提交，后台确认后会更新到体验点页面。' : '已保存'); await load(kind); }
    } catch { setError('保存失败，请稍后再试'); } finally { setBusy(false); }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError(''); setMsg('');
    try {
      for (const file of Array.from(files).slice(0, 6)) {
        const fd = new FormData();
        fd.append('kind', kind);
        fd.append('photo', file);
        const res = await fetch('/api/cn/member/store-profile', { method: 'POST', body: fd });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.ok) { setError(d.error || '上传失败'); break; }
      }
      await load(kind);
    } catch { setError('上传失败，请稍后再试'); } finally { setBusy(false); }
  };

  const removePhoto = async (id: string) => {
    setBusy(true);
    await fetch(`/api/cn/member/store-profile?kind=${kind}&photo=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    await load(kind);
    setBusy(false);
  };

  const input = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-teal-600';
  const label = 'block text-sm font-bold text-stone-700';

  return (
    <main className="mx-auto min-h-screen max-w-md bg-stone-50 px-4 py-6">
      <Link href="/cn/member" className="inline-flex items-center gap-1 text-sm font-bold text-stone-600">
        <ArrowLeft className="h-4 w-4" /> 返回会员中心
      </Link>
      <h1 className="mt-4 flex items-center gap-2 text-xl font-black text-stone-900"><Store className="h-5 w-5 text-teal-700" /> 门店／代理资料</h1>
      <p className="mt-1 text-sm leading-6 text-stone-500">店主填写地址、营业时间和现场照片，后台确认后显示在「体验点地址与导航」页。资料为本人自报，不会改动推荐归属或分账。</p>

      {needLogin ? (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-700">
          请先登录会员账号。
          <Link href={`/cn/login?returnTo=${encodeURIComponent('/cn/member/store-profile')}`} className="ml-2 font-bold text-teal-700">去登录</Link>
        </div>
      ) : !data ? (
        <div className="mt-6 text-sm text-stone-500">{error || '加载中…'}</div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-stone-200 p-1 text-sm font-bold">
            {(['owner', 'agent'] as Kind[]).map((k) => (
              <button key={k} type="button" onClick={() => { setKind(k); fill(k === 'owner' ? data.owner : data.agent); setMsg(''); setError(''); }} className={`rounded-lg py-2 ${kind === k ? 'bg-white text-teal-800 shadow' : 'text-stone-600'}`}>
                {k === 'owner' ? '我是店主' : '我是代理'}
              </button>
            ))}
          </div>

          {current && (
            <div className={`rounded-lg px-3 py-2 text-sm ${current.status === 'rejected' ? 'bg-amber-50 text-amber-900' : current.status === 'approved' ? 'bg-teal-50 text-teal-900' : 'bg-white text-stone-700'}`}>
              上次资料：{STATUS[current.status]}{current.reviewNote ? `（${current.reviewNote}）` : ''}
              {current.status === 'approved' && <span className="block text-xs text-stone-500">如需修改，填写后重新提交。</span>}
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
            {kind === 'owner' ? (
              <>
                <label className={label}>门店名称<input className={input} value={form.storeName} onChange={set('storeName')} placeholder="例如：良源养生馆" maxLength={60} /></label>
                <label className={label}>所在城市<input className={input} value={form.city} onChange={set('city')} placeholder="例如：苏州" maxLength={20} /></label>
                <label className={label}>完整经营地址<textarea className={input} rows={2} value={form.address} onChange={set('address')} placeholder="省市区＋街道门牌，例如：江苏省苏州市姑苏区某某路12号" maxLength={120} /></label>
                <div>
                  <span className={label}>经营类型</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {MODELS.map((m) => (
                      <button key={m} type="button" onClick={() => setForm((f) => ({ ...f, businessModel: m }))} className={`rounded-full border px-3 py-1 text-sm ${form.businessModel === m ? 'border-teal-700 bg-teal-50 font-bold text-teal-800' : 'border-stone-300 text-stone-600'}`}>{m}</button>
                    ))}
                  </div>
                </div>
                <label className={label}>营业时间<input className={input} value={form.hours} onChange={set('hours')} placeholder="例如：每天 9:00-21:00，周一休息" maxLength={60} /></label>
                <div>
                  <span className={label}>现场照片（2–3 张：门头、店内、机器摆放）</span>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {photos.map((p) => (
                      <div key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-stone-100">
                        {p.url ? <img src={p.url} alt="门店照片" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-xs text-stone-500">处理中</span>}
                        <button type="button" onClick={() => removePhoto(p.id)} disabled={busy} className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-stone-700" aria-label="删除照片"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                    {photos.length < 6 && (
                      <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-xs text-stone-500">
                        <Camera className="h-5 w-5" /> 添加照片
                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" disabled={busy} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
                      </label>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-stone-400">照片经后台确认后才会公开。</p>
                </div>
              </>
            ) : (
              <>
                <label className={label}>所在城市<input className={input} value={form.city} onChange={set('city')} placeholder="例如：苏州" maxLength={20} /></label>
                <label className={label}>公司／称呼<input className={input} value={form.company} onChange={set('company')} placeholder="例如：某某贸易 王先生" maxLength={60} /></label>
                <label className={label}>覆盖区域<textarea className={input} rows={2} value={form.coverage} onChange={set('coverage')} placeholder="例如：苏州姑苏区、吴中区" maxLength={120} /></label>
              </>
            )}
            <label className={label}>推荐人（选填）<input className={input} value={form.declaredReferrer} onChange={set('declaredReferrer')} placeholder="介绍您加入的人，只供后台核对" maxLength={30} /></label>
          </div>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {msg && <div className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">{msg}</div>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => save(false)} className="rounded-xl border border-stone-300 bg-white py-3 text-sm font-bold text-stone-700 disabled:opacity-50">保存草稿</button>
            <button type="button" disabled={busy} onClick={() => save(true)} className="rounded-xl bg-teal-700 py-3 text-sm font-bold text-white disabled:opacity-50">提交审核</button>
          </div>
          <Link href="/cn/experience-points" className="block text-center text-sm font-bold text-teal-700">查看体验点地址与导航 →</Link>
        </div>
      )}
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck, Loader2, Send } from 'lucide-react';
import StorePrepayPanel from '@/components/StorePrepayPanel';

// 简体门店申请页：登录会员在线填写申请 → 选择预购次数（次卡）档位 → 微信付款
type Tier = { id: string; amountYuan: number; uses: number };
type Unpaid = { id: string; name: string; status: string; prepay?: { tier?: string; status?: string } };

const RETURN_PATH = '/cn/member/store-application';

export default function StoreApplicationOnlineForm() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', contactName: '', contactPhone: '', prepayTier: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [payApp, setPayApp] = useState<{ id: string; tier: string } | null>(null);
  const [resumable, setResumable] = useState<Unpaid[]>([]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fromUrl = q.get('payApp') || '';
    fetch('/api/cn/store-applications/prepay', { cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401) { setLoginNeeded(true); return; }
        const data = await res.json().catch(() => ({}));
        setTiers(data.tiers || []);
      })
      .catch(() => undefined);
    fetch('/api/cn/store-applications', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const rows: Unpaid[] = (data?.applications || []).filter((row: Unpaid & { applicantId?: number }) => row.prepay && row.prepay.status !== 'paid' && ['pending_review', 'revision_required', 'pending_deposit'].includes(row.status));
        setResumable(rows);
        const target = (data?.applications || []).find((row: Unpaid) => row.id === fromUrl);
        if (target) setPayApp({ id: target.id, tier: target.prepay?.tier || '' });
      })
      .catch(() => undefined);
  }, []);

  async function submit() {
    if (!form.name.trim() || !form.address.trim()) { setMessage('请填写门店名称与地址'); return; }
    if (!form.contactPhone.trim()) { setMessage('请填写负责人手机'); return; }
    if (!form.prepayTier) { setMessage('请选择预购次数（次卡）档位'); return; }
    setBusy(true);
    setMessage('');
    try {
      const ref = new URLSearchParams(window.location.search).get('ref') || '';
      const res = await fetch('/api/cn/store-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, ref }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(data.error || '提交失败，请稍后再试'); return; }
      setPayApp({ id: data.created.id, tier: form.prepayTier });
      setMessage('申请已提交，请选择档位完成付款');
    } finally {
      setBusy(false);
    }
  }

  if (loginNeeded) {
    return (
      <div className="rounded-lg border border-teal-200 bg-white p-5 text-sm font-semibold text-stone-700">
        请先 <a className="font-black text-teal-700 underline" href={`/cn/login?next=${encodeURIComponent(RETURN_PATH + '#online-apply')}`}>登录会员</a> 后在线提交门店申请。
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-teal-200 bg-white p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-black text-stone-950"><ClipboardCheck className="h-5 w-5 text-teal-700" />在线申请门店</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">填写门店资料并选择预购次数（次卡）档位，提交后可直接微信付款；平台审核并安排设备后，所购次数灌入门店机器。也可以联系客服协助申请。</p>
      {payApp ? (
        <div className="mt-4">
          <StorePrepayPanel applicationId={payApp.id} initialTier={payApp.tier} returnPath={RETURN_PATH} />
          <a href="/cn/member#store-applications" className="mt-3 inline-block text-sm font-bold text-teal-700 underline">查看申请进度</a>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {resumable.length ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              您有未完成付款的申请：
              {resumable.map((row) => <button key={row.id} type="button" onClick={() => setPayApp({ id: row.id, tier: row.prepay?.tier || '' })} className="ml-2 font-black text-teal-700 underline">{row.name} · 继续付款</button>)}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold text-stone-600">门店名称<input className="input-field mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="text-xs font-bold text-stone-600">门店地址<input className="input-field mt-1" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
            <label className="text-xs font-bold text-stone-600">负责人姓名<input className="input-field mt-1" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></label>
            <label className="text-xs font-bold text-stone-600">负责人手机<input className="input-field mt-1" inputMode="tel" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} /></label>
          </div>
          <div>
            <div className="text-xs font-bold text-stone-600">预购次数（次卡）档位 · 有效期 3 个月（自付款日起）</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {tiers.map((t) => (
                <button key={t.id} type="button" onClick={() => setForm({ ...form, prepayTier: t.id })} className={`rounded-lg border-2 p-3 text-left ${form.prepayTier === t.id ? 'border-teal-600 bg-teal-50' : 'border-stone-200 bg-white'}`}>
                  <div className="text-xs font-black text-teal-700">{t.id} 档</div>
                  <div className="mt-1 text-lg font-black tabular-nums">¥{t.amountYuan.toLocaleString('en-US')}</div>
                  <div className="text-sm font-bold text-stone-700">{t.uses} 次</div>
                </button>
              ))}
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => void submit()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-3 font-black text-white disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}提交申请并去付款
          </button>
        </div>
      )}
      {message ? <div className="mt-3 text-sm font-bold text-teal-800">{message}</div> : null}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, Upload } from 'lucide-react';

type Overview = {
  brand: { id: number; brandName: string; companyName: string; registrationNo: string; hasLicense: boolean } | null;
  requests: Array<{ id: string; companyName: string; registrationNo: string; status: 'pending' | 'approved' | 'rejected'; reviewNote: string; createdAt: string; reviewedAt: string | null }>;
};

const statusText = { pending: '审核中', approved: '已通过', rejected: '已退回' } as const;

function formatTime(value: string | null) {
  if (!value) return '-';
  try { return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); } catch { return value; }
}

export default function BrandEntityChangePage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ companyName: '', registrationNo: '', contactName: '', phone: '', licenseToken: '', licenseName: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cn/brand-entity-change', { cache: 'no-store', credentials: 'include' });
      if (res.status === 401) {
        window.location.href = `/cn/login?returnTo=${encodeURIComponent('/cn/brand/entity')}`;
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '读取失败');
      setOverview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const uploadLicense = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('kind', 'license');
      body.append('documentType', 'cn_business_license');
      const res = await fetch('/api/cn/brand-document', { method: 'POST', body, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败，请重试');
      const draft = (data.draft || {}) as Record<string, string>;
      setForm((prev) => ({
        ...prev,
        licenseToken: data.token,
        licenseName: data.name || file.name,
        companyName: prev.companyName || draft.companyName || '',
        registrationNo: prev.registrationNo || draft.registrationNo || '',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/cn/brand-entity-change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '提交失败');
      setMessage('已提交，平台审核通过后品牌的公司主体才会变更。审核期间品牌和商品照常显示。');
      setForm({ companyName: '', registrationNo: '', contactName: '', phone: '', licenseToken: '', licenseName: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const pending = overview?.requests.find((row) => row.status === 'pending');
  const latest = overview?.requests[0];
  const input = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold outline-none focus:border-teal-600';

  return (
    <main className="min-h-screen bg-[#f5f2ea] px-4 py-8 text-stone-950">
      <div className="mx-auto max-w-lg">
        <Link href="/vendor" className="inline-flex items-center gap-2 text-sm font-bold text-stone-600"><ArrowLeft className="h-4 w-4" />返回品牌工作台</Link>
        <div className="mt-4 flex items-center gap-3">
          <Building2 className="h-8 w-8 text-teal-700" />
          <div>
            <h1 className="text-2xl font-black">变更公司主体</h1>
            <p className="text-sm font-semibold text-stone-600">提交贵公司的营业执照，平台审核通过后生效</p>
          </div>
        </div>

        {loading ? <div className="mt-6 rounded-xl bg-white p-6 text-sm font-bold">读取中...</div> : null}
        {message ? <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">{message}</div> : null}
        {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div> : null}

        {!loading && overview && !overview.brand ? (
          <section className="mt-6 rounded-xl border border-stone-200 bg-white p-6">
            <h2 className="text-lg font-black">当前账号没有已开通的品牌</h2>
            <p className="mt-2 text-sm text-stone-600">如果您收到了品牌认领链接，请先打开链接用微信完成认领。</p>
          </section>
        ) : null}

        {!loading && overview?.brand ? (
          <>
            <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs font-bold text-stone-500">品牌</div>
              <div className="text-xl font-black">{overview.brand.brandName}</div>
              <div className="mt-3 text-xs font-bold text-stone-500">目前登记的公司主体</div>
              <div className="text-sm font-black">{overview.brand.companyName || '未填写'}</div>
              <div className="text-xs font-semibold text-stone-500">统一社会信用代码：{overview.brand.registrationNo || '未填写'}</div>
            </section>

            {latest ? (
              <section className="mt-4 rounded-xl border border-stone-200 bg-white p-5 text-sm">
                <div className="font-black">最近一次申请：{statusText[latest.status]}</div>
                <div className="mt-1 text-stone-600">{latest.companyName} · {latest.registrationNo}</div>
                <div className="text-xs text-stone-500">提交时间 {formatTime(latest.createdAt)}{latest.reviewedAt ? ` · 审核时间 ${formatTime(latest.reviewedAt)}` : ''}</div>
                {latest.status === 'rejected' && latest.reviewNote ? <div className="mt-2 rounded-lg bg-red-50 p-3 font-bold text-red-800">退回原因：{latest.reviewNote}</div> : null}
              </section>
            ) : null}

            {pending ? (
              <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900">
                您的主体变更申请正在审核中，审核结果出来前不能重复提交。审核期间品牌和商品照常显示。
              </section>
            ) : (
              <form onSubmit={submit} className="mt-4 space-y-4 rounded-xl border border-teal-600 bg-white p-5">
                <div>
                  <label className="text-sm font-black">营业执照 <span className="text-red-600">*</span></label>
                  <p className="text-xs text-stone-500">支持 JPG / PNG / WEBP / PDF，请上传清晰完整的营业执照。</p>
                  <label className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-teal-300 bg-teal-50 px-4 py-4 text-sm font-black text-teal-800">
                    <Upload className="h-4 w-4" />{uploading ? '上传识别中...' : form.licenseToken ? `已上传：${form.licenseName}（点此重新上传）` : '点击上传营业执照'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploading} onChange={(e) => void uploadLicense(e.target.files?.[0])} />
                  </label>
                </div>
                <div>
                  <label className="text-sm font-black">公司名称 <span className="text-red-600">*</span></label>
                  <input className={input} value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="与营业执照上的名称一致" />
                </div>
                <div>
                  <label className="text-sm font-black">统一社会信用代码 <span className="text-red-600">*</span></label>
                  <input className={input} value={form.registrationNo} onChange={(e) => setForm({ ...form, registrationNo: e.target.value.toUpperCase() })} placeholder="18 位代码" maxLength={20} />
                  <p className="mt-1 text-xs text-stone-500">按执照原样填写。字母 L 是合法字符，不要改成数字 1。格式通过后仍须平台对照原件审核，通过前不变更品牌资料。</p>
                </div>
                <div>
                  <label className="text-sm font-black">联系人 <span className="text-red-600">*</span></label>
                  <input className={input} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="负责对接平台的联系人姓名" />
                </div>
                <div>
                  <label className="text-sm font-black">联系电话 <span className="text-red-600">*</span></label>
                  <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="11 位手机号" inputMode="numeric" maxLength={13} />
                </div>
                <button type="submit" disabled={submitting || uploading} className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">
                  {submitting ? '提交中...' : '提交平台审核'}
                </button>
                <p className="text-xs text-stone-500">提交后进入平台审核，审核通过前品牌仍显示原有资料。</p>
              </form>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}

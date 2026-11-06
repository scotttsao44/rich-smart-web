'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';

type BrandOption = { id: number; brandName: string; status: string };
type ClaimRow = { id: string; brandId: number; brandName: string; status: 'pending' | 'claimed' | 'revoked' | 'expired'; createdAt: string; expiresAt: string; claimedAt: string | null; claimedBy: number | null };
type ChangeRow = {
  id: string; brandId: number; brandName: string; requestedBy: number; requestedByName: string;
  companyName: string; registrationNo: string; licenseToken: string; licenseName: string; contactName: string; phone: string;
  status: 'pending' | 'approved' | 'rejected'; reviewNote: string; createdAt: string; reviewedAt: string | null;
  current: { companyName: string; registrationNo: string } | null;
};

const claimStatus = { pending: '待认领', claimed: '已认领', revoked: '已撤销', expired: '已过期' } as const;
const changeStatus = { pending: '待审核', approved: '已通过', rejected: '已退回' } as const;

function fmt(value: string | null) {
  if (!value) return '-';
  try { return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); } catch { return value; }
}

export default function BrandClaimAdminPanel({ brands, onChanged }: { brands: BrandOption[]; onChanged?: () => void }) {
  const approved = brands.filter((row) => row.status === 'approved');
  const [brandId, setBrandId] = useState('');
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [newLink, setNewLink] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [claimRes, changeRes] = await Promise.all([
      fetch('/api/cn/brand-claim?scope=admin', { cache: 'no-store' }),
      fetch('/api/cn/brand-entity-change?scope=admin', { cache: 'no-store' }),
    ]);
    const claimData = await claimRes.json().catch(() => ({}));
    const changeData = await changeRes.json().catch(() => ({}));
    if (claimRes.ok) setClaims(claimData.claims || []);
    if (changeRes.ok) setChanges(changeData.requests || []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const call = async (key: string, url: string, method: string, body: unknown, success: string) => {
    setBusy(key);
    setMessage('');
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '操作失败');
      setMessage(success);
      await load();
      onChanged?.();
      return data;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
      return null;
    } finally {
      setBusy('');
    }
  };

  const createLink = async () => {
    if (!brandId) return setMessage('请先选择品牌');
    setNewLink('');
    const data = await call('create', '/api/cn/brand-claim', 'POST', { action: 'create', brandId: Number(brandId) }, '认领链接已建立（7 天有效、仅可使用一次）。链接只显示这一次，请立即复制发给品牌方本人。');
    if (data?.url) setNewLink(String(data.url));
  };

  const review = (row: ChangeRow, decision: 'approved' | 'rejected') => {
    const note = notes[row.id] || '';
    if (decision === 'rejected' && !note.trim()) return setMessage('退回主体变更时请填写原因。');
    void call(`review-${row.id}`, '/api/cn/brand-entity-change', 'PATCH', { id: row.id, decision, reviewNote: note }, decision === 'approved' ? '主体变更已核准，品牌资料已更新。' : '主体变更已退回。');
  };

  return (
    <>
      <section className="mt-6 rounded-lg border bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">品牌认领链接</h2>
        <p className="mt-1 text-sm font-bold text-slate-500">发给品牌方本人，用其微信登录后接管品牌。一次性、7 天有效、可撤销。</p>
        {message ? <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm font-bold text-teal-950">{message}</div> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="min-w-[200px] rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">
            <option value="">选择品牌</option>
            {approved.map((row) => <option key={row.id} value={row.id}>{row.brandName}（{row.id}）</option>)}
          </select>
          <button type="button" disabled={Boolean(busy)} onClick={() => void createLink()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">生成认领链接</button>
        </div>
        {newLink ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="text-xs font-black text-amber-900">认领链接（只显示一次）</div>
            <div className="mt-1 break-all font-mono text-xs text-slate-900">{newLink}</div>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(newLink).then(() => setMessage('已复制认领链接'))} className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-xs font-black text-amber-900">复制</button>
          </div>
        ) : null}
        {claims.length ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-black text-slate-500"><tr><th className="px-3 py-2">品牌</th><th className="px-3 py-2">建立</th><th className="px-3 py-2">到期</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">认领会员</th><th className="px-3 py-2">操作</th></tr></thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {claims.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-black">{row.brandName}</td>
                    <td className="px-3 py-2 text-slate-600">{fmt(row.createdAt)}</td>
                    <td className="px-3 py-2 text-slate-600">{fmt(row.expiresAt)}</td>
                    <td className="px-3 py-2 font-bold">{claimStatus[row.status]}</td>
                    <td className="px-3 py-2">{row.claimedBy ? `${row.claimedBy}（${fmt(row.claimedAt)}）` : '-'}</td>
                    <td className="px-3 py-2">{row.status === 'pending' ? <button disabled={Boolean(busy)} onClick={() => void call(`revoke-${row.id}`, '/api/cn/brand-claim', 'POST', { action: 'revoke', claimId: row.id }, '认领链接已撤销。')} className="rounded border border-red-200 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50">撤销</button> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-lg border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><h2 className="text-xl font-black">公司主体变更申请</h2><span className="text-sm text-slate-500">待审 {changes.filter((row) => row.status === 'pending').length}</span></div>
        <p className="mt-1 text-sm font-bold text-slate-500">进入此列表的代码已通过 GB 32100 格式与校验位检核（字母 L 合法，勿要求改成数字）。这不证明执照真实。请对照上传原件核对 18 位代码与名称，核准后才会写入品牌资料。</p>
        {!changes.length ? <p className="mt-2 text-sm font-bold text-slate-400">暂无申请</p> : null}
        <div className="mt-3 grid gap-3">
          {changes.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-black">{row.brandName}<span className="ml-2 text-xs font-bold text-slate-500">提交人 {row.requestedByName || '-'}（{row.requestedBy}）· {fmt(row.createdAt)}</span></div>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-black">{changeStatus[row.status]}</span>
              </div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs font-black text-slate-500">现在的主体</div><div className="font-bold">{row.current?.companyName || '-'}</div><div className="text-xs text-slate-500">{row.current?.registrationNo || '-'}</div></div>
                <div className="rounded-lg bg-teal-50 p-3"><div className="text-xs font-black text-teal-700">申请变更为</div><div className="font-bold">{row.companyName}</div><div className="text-xs text-slate-600">{row.registrationNo}</div><div className="mt-1 text-xs text-slate-600">联系人 {row.contactName} · {row.phone}</div></div>
              </div>
              <a href={`/api/cn/brand-document?token=${encodeURIComponent(row.licenseToken)}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border border-teal-200 bg-white px-3 py-1.5 text-sm font-black text-teal-700">查看营业执照<ExternalLink className="h-3.5 w-3.5" /></a>
              {row.status === 'pending' ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input value={notes[row.id] || ''} onChange={(e) => setNotes({ ...notes, [row.id]: e.target.value })} placeholder="审核备注（退回时必填）" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <button disabled={Boolean(busy)} onClick={() => review(row, 'approved')} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">核准变更</button>
                  <button disabled={Boolean(busy)} onClick={() => review(row, 'rejected')} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-black text-red-700 disabled:opacity-50">退回</button>
                </div>
              ) : row.reviewNote ? <p className="mt-2 text-sm text-slate-600">审核备注：{row.reviewNote}（{fmt(row.reviewedAt)}）</p> : null}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

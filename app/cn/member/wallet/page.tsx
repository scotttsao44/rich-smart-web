'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CircleDollarSign, Clock3, Download, ReceiptText, Send, WalletCards } from 'lucide-react';

type Entry = { id: string; createdAt: string; orderNo: string; productName: string; sourceType: string; ruleSnapshot: Record<string, string | number>; amount: number; status: string; expectedReleaseAt: string | null };
type Withdrawal = { id: string; method: string; amount: number; fee: number; netAmount: number; status: string; providerTransactionId: string; createdAt: string };
type WalletData = { summary: { frozen: number; available: number; withdrawing: number; paid: number; reversed: number }; entries: Entry[]; withdrawals: Withdrawal[]; settings: { minimumAmount: number; feeRate: number; liveTransferEnabled: boolean } };

const statusLabel: Record<string, string> = { pending: '待确认收益', frozen: '待确认收益', available: '可提现', cancelled: '已取消', reversal: '冲正', paid: '已支付', requested: '待审核', reviewing: '审核中', processing: '处理中', failed: '失败', rejected: '已拒绝' };
const sourceLabel: Record<string, string> = { sale: '销售', referral: '推荐', brand_referral: '品牌推荐', active_rank: '30天销售贡献', other: '其他', withdrawal: '提现' };

function money(value: number) { return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

export default function WalletPage() {
  const [data, setData] = useState<WalletData | null>(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ method: 'wechat_wallet', realName: '', account: '', amount: '' });
  const load = () => fetch('/api/cn/wallet').then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || '钱包读取失败'); setData(result); });
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);
  const fee = useMemo(() => Number(form.amount || 0) * Number(data?.settings.feeRate || 0) / 100, [form.amount, data]);
  const submit = async () => {
    setMessage('提交中...');
    const response = await fetch('/api/cn/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || '提交失败');
    setMessage(result.message);
    setForm((current) => ({ ...current, amount: '' }));
    await load();
  };
  const exportCsv = () => {
    if (!data?.entries.length) return;
    const rows = data.entries.map((entry) => ({ 日期: entry.createdAt, 订单: entry.orderNo, 商品: entry.productName, 来源: sourceLabel[entry.sourceType] || entry.sourceType, 金额: entry.amount, 状态: statusLabel[entry.status] || entry.status, 预计可提现日: entry.expectedReleaseAt || '' }));
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => `"${String(row[key as keyof typeof row]).replace(/"/g, '""')}"`).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'caomi-wallet.csv'; anchor.click(); URL.revokeObjectURL(url);
  };
  const summary = data?.summary || { frozen: 0, available: 0, withdrawing: 0, paid: 0, reversed: 0 };

  return <main className="min-h-screen bg-[#f6f7f5] px-4 py-6"><div className="mx-auto max-w-6xl">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-5"><div><Link href="/cn/member" className="inline-flex items-center gap-1 text-sm font-bold text-stone-500"><ArrowLeft className="h-4 w-4" />会员中心</Link><h1 className="mt-2 text-3xl font-black text-stone-950">会员钱包</h1></div><button onClick={exportCsv} className="inline-flex items-center gap-2 border border-stone-300 bg-white px-4 py-2 text-sm font-bold"><Download className="h-4 w-4" />导出明细</button></header>
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[
      ['待确认收益', summary.frozen, Clock3], ['可提现', summary.available, WalletCards], ['提现中', summary.withdrawing, Send], ['已支付', summary.paid, CircleDollarSign], ['冲正', summary.reversed, ReceiptText],
    ].map(([label, value, Icon]: any) => <div key={label} className="border border-stone-200 bg-white p-4"><Icon className="h-5 w-5 text-teal-700"/><div className="mt-3 text-sm font-bold text-stone-500">{label}</div><div className="mt-1 text-2xl font-black">{money(value)}</div></div>)}</section>
    <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="overflow-hidden border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4 text-lg font-black">钱包明细</div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-stone-50 text-stone-500"><tr><th className="px-4 py-3">日期 / 订单</th><th className="px-4 py-3">商品 / 来源</th><th className="px-4 py-3">当时规则</th><th className="px-4 py-3">状态</th><th className="px-4 py-3 text-right">金额</th></tr></thead><tbody className="divide-y divide-stone-100">{data?.entries.map((entry) => <tr key={entry.id}><td className="px-4 py-4"><div>{new Date(entry.createdAt).toLocaleString('zh-CN')}</div><Link href={`/cn/member/wallet/${encodeURIComponent(entry.id)}`} className="mt-1 inline-block text-xs font-bold text-teal-700">{entry.orderNo} · 查看详情</Link></td><td className="px-4 py-4"><div className="font-bold">{entry.productName}</div><div className="mt-1 text-xs text-stone-500">{sourceLabel[entry.sourceType] || entry.sourceType}</div></td><td className="px-4 py-4 text-xs text-stone-600">{Number(entry.ruleSnapshot.rate || 0)}% · 平台 {Number(entry.ruleSnapshot.platformFeeRate || 0)}%</td><td className="px-4 py-4"><span className="bg-stone-100 px-2 py-1 text-xs font-bold">{statusLabel[entry.status] || entry.status}</span>{entry.expectedReleaseAt ? <div className="mt-2 text-xs text-stone-500">预计可提现日 {new Date(entry.expectedReleaseAt).toLocaleDateString('zh-CN')}</div> : null}</td><td className={`px-4 py-4 text-right font-black ${entry.amount < 0 ? 'text-red-600' : 'text-teal-700'}`}>{money(entry.amount)}</td></tr>)}</tbody></table></div></div>
      <aside className="border border-stone-200 bg-white p-5"><h2 className="text-lg font-black">申请提现到微信钱包</h2><div className="mt-4 bg-teal-50 p-3 text-sm font-bold leading-6 text-teal-800">审核通过后，由当前登录的微信帐号确认收款，不需要填写微信号。</div><input className="input-field mt-3" placeholder="实名姓名" value={form.realName} onChange={(event) => setForm({ ...form, realName: event.target.value })}/><input className="input-field mt-3" type="number" placeholder={`最低 ¥${data?.settings.minimumAmount || 100}`} value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })}/><div className="mt-4 bg-stone-50 p-3 text-sm text-stone-600"><div className="flex justify-between"><span>手续费 {data?.settings.feeRate || 1}%</span><span>{money(fee)}</span></div><div className="mt-2 flex justify-between font-black text-stone-950"><span>预计到账</span><span>{money(Math.max(0, Number(form.amount || 0) - fee))}</span></div></div><p className="mt-4 rounded border border-stone-200 bg-stone-50 p-3 text-xs font-bold leading-5 text-stone-700">推广收益提现由收款人依法自行申报纳税；平台仅代收 1% 通道手续费。</p><button onClick={submit} className="mt-4 w-full bg-teal-700 px-4 py-3 font-black text-white">提交微信钱包提现申请</button><div className="mt-3 border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">微信商户转账尚未开通，平台会先人工审核；开通前不会自动汇至真实钱包。</div>{message ? <div className="mt-3 text-sm font-bold text-teal-700">{message}</div> : null}
      {data?.withdrawals.length ? <div className="mt-6 border-t border-stone-200 pt-4"><div className="font-black">提现记录</div>{data.withdrawals.map((row) => <div key={row.id} className="mt-3 text-sm"><div className="flex justify-between font-bold"><span>{row.id}</span><span>{statusLabel[row.status] || row.status}</span></div><div className="mt-1 text-stone-500">{money(row.netAmount)} · {row.providerTransactionId || '待平台处理'}</div></div>)}</div> : null}</aside>
    </section>
  </div></main>;
}

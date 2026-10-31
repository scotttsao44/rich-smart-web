'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';

type FinanceData = { orders: any[]; withdrawals: any[]; refunds: any[]; walletEntries: any[]; paymentEvents: any[]; auditEvents: any[]; jobRuns: any[] };
type PaymentSettings = { platformFeeRate: number; paymentChannelFeeRate: number; riskReserveRate: number; updatedAt: string | null };
type Partnership = { id: string; referrerBrandName: string; ownerBrandName: string; status: string; rewardType: 'rate' | 'fixed'; rewardRate: number; rewardFixedAmount: number; referrerAcceptedAt?: string | null; ownerAcceptedAt?: string | null; platformReviewedAt?: string | null; terms: string };
const withdrawalStatus: Record<string, string> = { requested: '待审核', reviewing: '审核中', processing: '处理中', paid: '已支付', failed: '失败', rejected: '已拒绝' };
const money = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

export default function FinancePage() {
  const [data, setData] = useState<FinanceData>({ orders: [], withdrawals: [], refunds: [], walletEntries: [], paymentEvents: [], auditEvents: [], jobRuns: [] });
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>({ platformFeeRate: 0.6, paymentChannelFeeRate: 0, riskReserveRate: 0, updatedAt: null });
  const [message, setMessage] = useState('');
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [transactionIds, setTransactionIds] = useState<Record<string, string>>({});
  const load = async () => {
    const [financeResponse, partnershipResponse, settingsResponse] = await Promise.all([fetch('/api/cn/finance'), fetch('/api/cn/brand-partnerships'), fetch('/api/cn/payment-settings')]);
    const financeResult = await financeResponse.json();
    const partnershipResult = await partnershipResponse.json();
    const settingsResult = await settingsResponse.json();
    if (!financeResponse.ok) throw new Error(financeResult.error || '读取失败');
    if (!partnershipResponse.ok) throw new Error(partnershipResult.error || '品牌合作读取失败');
    if (!settingsResponse.ok) throw new Error(settingsResult.error || '支付费率读取失败');
    setData(financeResult);
    setPartnerships(partnershipResult.partnerships || []);
    setPaymentSettings(settingsResult.settings);
  };
  useEffect(() => { load().catch((error) => setMessage(error.message)); }, []);
  const totals = useMemo(() => ({ frozen: data.walletEntries.filter((entry) => ['pending', 'frozen'].includes(entry.status)).reduce((sum, entry) => sum + entry.amount, 0), available: data.walletEntries.filter((entry) => ['available', 'reversal'].includes(entry.status)).reduce((sum, entry) => sum + entry.amount, 0), requested: data.withdrawals.filter((row) => ['requested', 'reviewing', 'processing'].includes(row.status)).reduce((sum, row) => sum + row.amount, 0) }), [data]);
  const updateWithdrawal = async (row: any, status: string) => {
    const response = await fetch('/api/cn/finance', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'withdrawal', id: row.id, status, providerTransactionId: transactionIds[row.id] || '', note: status === 'paid' ? '平台人工完成' : '' }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || '操作失败');
    setMessage('状态已更新'); await load();
  };
  const updatePartnership = async (row: Partnership, status: string) => {
    const response = await fetch('/api/cn/brand-partnerships', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, status }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || '合作状态更新失败');
    setMessage('品牌合作状态已更新'); await load();
  };
  const confirmBankPayment = async (orderId: number) => {
    const response = await fetch('/api/cn/finance', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm_bank_payment', orderId }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || '到账确认失败');
    setMessage(result.duplicateSafe ? '该订单已确认到账' : '银行转账已确认到账');
    await load();
  };
  const savePaymentSettings = async () => {
    const response = await fetch('/api/cn/payment-settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(paymentSettings) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error || '支付费率保存失败');
    setPaymentSettings(result.settings); setMessage('支付费率已保存，之后付款成功的订单会记录当时费率');
  };
  const exportRows = () => {
    const rows = data.walletEntries.map((row) => ({ 日期: row.createdAt, 订单: row.orderNo, 用户: row.userId, 商品: row.productName, 来源: row.sourceType, 金额: row.amount, 状态: row.status }));
    if (!rows.length) return;
    const headers = Object.keys(rows[0]); const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => `"${String(row[key as keyof typeof row]).replace(/"/g, '""')}"`).join(','))].join('\n'); const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'caomi-finance-ledger.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return <main className="min-h-screen bg-[#f6f7f5] px-4 py-6"><div className="mx-auto max-w-7xl">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-5"><div><Link href="/cn/ops" className="inline-flex items-center gap-1 text-sm font-bold text-stone-500"><ArrowLeft className="h-4 w-4"/>平台运营台</Link><h1 className="mt-2 text-3xl font-black">财务与提现</h1></div><div className="flex gap-2"><button onClick={() => load()} className="inline-flex items-center gap-2 border border-stone-300 bg-white px-4 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4"/>刷新</button><button onClick={exportRows} className="inline-flex items-center gap-2 bg-stone-950 px-4 py-2 text-sm font-bold text-white"><Download className="h-4 w-4"/>导出分录</button></div></header>
    <section className="mt-6 grid gap-3 md:grid-cols-3">{[['冻结分润', totals.frozen], ['可用分润', totals.available], ['提现处理中', totals.requested]].map(([label, value]) => <div key={label as string} className="border border-stone-200 bg-white p-4"><div className="text-sm font-bold text-stone-500">{label}</div><div className="mt-2 text-3xl font-black text-teal-700">{money(Number(value))}</div></div>)}</section>
    {message ? <div className="mt-4 border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-bold text-teal-800">{message}</div> : null}
    <section className="mt-6 border-y border-stone-200 bg-white px-5 py-5"><div className="flex flex-wrap items-end justify-between gap-5"><div><h2 className="text-lg font-black">商城支付费率</h2><p className="mt-1 text-sm font-semibold text-stone-500">三项都按订单实付金额计算，并在付款成功时写入订单快照。</p></div><button onClick={savePaymentSettings} className="bg-stone-950 px-4 py-2 text-sm font-bold text-white">保存费率</button></div><div className="mt-5 grid gap-4 md:grid-cols-3"><label className="text-sm font-bold">平台服务费率（%）<input type="number" min="0" max="100" step="0.0001" className="mt-2 w-full border border-stone-300 px-3 py-2" value={paymentSettings.platformFeeRate} onChange={(event) => setPaymentSettings({ ...paymentSettings, platformFeeRate: Number(event.target.value) })}/></label><label className="text-sm font-bold">支付通道费率（%）<input type="number" min="0" max="100" step="0.0001" className="mt-2 w-full border border-stone-300 px-3 py-2" value={paymentSettings.paymentChannelFeeRate} onChange={(event) => setPaymentSettings({ ...paymentSettings, paymentChannelFeeRate: Number(event.target.value) })}/></label><label className="text-sm font-bold">风险准备金率（%）<input type="number" min="0" max="100" step="0.0001" className="mt-2 w-full border border-stone-300 px-3 py-2" value={paymentSettings.riskReserveRate} onChange={(event) => setPaymentSettings({ ...paymentSettings, riskReserveRate: Number(event.target.value) })}/></label></div></section>
    <section className="mt-6 border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4 text-lg font-black">品牌合作审核</div><div className="divide-y divide-stone-100">{partnerships.map((row) => <div key={row.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-center"><div><div className="font-black">{row.referrerBrandName} 推荐 {row.ownerBrandName} 商品</div><div className="mt-1 text-sm text-stone-500">{row.id} · {row.rewardType === 'rate' ? `品牌推荐分润：商品毛利的 ${row.rewardRate}%` : `每笔 ¥${row.rewardFixedAmount}`}</div><div className="mt-2 text-sm text-stone-600">{row.terms}</div><div className="mt-2 text-xs font-bold text-stone-500">推荐方：{row.referrerAcceptedAt ? '已接受' : '待接受'} · 商品方：{row.ownerAcceptedAt ? '已接受' : '待接受'} · 平台状态：{row.status}</div></div><div className="flex flex-wrap gap-2">{row.status !== 'active' ? <button onClick={() => updatePartnership(row, 'active')} className="bg-teal-700 px-4 py-2 text-sm font-bold text-white">启用</button> : <button onClick={() => updatePartnership(row, 'paused')} className="border border-amber-500 px-4 py-2 text-sm font-bold text-amber-800">暂停</button>}<button onClick={() => updatePartnership(row, 'rejected')} className="border border-red-300 px-4 py-2 text-sm font-bold text-red-700">拒绝</button></div></div>)}</div></section>
    <section className="mt-6 border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4 text-lg font-black">银行转账待确认</div><div className="divide-y divide-stone-100">{data.orders.filter((row: any) => row.paymentMethod === 'bank_transfer' && row.paymentStatus === 'pending').map((row: any) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div><div className="font-black">{row.orderNo}</div><div className="mt-1 text-sm text-stone-500">{row.shippingName || `会员 ${row.userId}`} · {money(Number(row.totalAmount))}</div></div><button onClick={() => confirmBankPayment(row.id)} className="bg-teal-700 px-4 py-2 text-sm font-bold text-white">确认银行款项已到账</button></div>)}{!data.orders.some((row: any) => row.paymentMethod === 'bank_transfer' && row.paymentStatus === 'pending') ? <div className="px-5 py-8 text-sm font-semibold text-stone-500">目前没有待确认银行转账</div> : null}</div></section>
    <section className="mt-6 border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4 text-lg font-black">提现审核</div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-stone-50"><tr><th className="px-4 py-3">申请</th><th className="px-4 py-3">会员 / 渠道</th><th className="px-4 py-3">金额</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">第三方交易号</th><th className="px-4 py-3">操作</th></tr></thead><tbody className="divide-y divide-stone-100">{data.withdrawals.map((row) => <tr key={row.id}><td className="px-4 py-4"><div className="font-bold">{row.id}</div><div className="mt-1 text-xs text-stone-500">{new Date(row.createdAt).toLocaleString('zh-CN')}</div></td><td className="px-4 py-4">会员 {row.userId}<div className="mt-1 text-xs text-stone-500">{row.method} · {row.realName} · {row.account}</div></td><td className="px-4 py-4"><div className="font-black">{money(row.amount)}</div><div className="text-xs text-stone-500">手续费 {money(row.fee)} · 实到 {money(row.netAmount)}</div></td><td className="px-4 py-4">{withdrawalStatus[row.status] || row.status}</td><td className="px-4 py-4"><input className="border border-stone-300 px-3 py-2" value={transactionIds[row.id] ?? row.providerTransactionId ?? ''} onChange={(event) => setTransactionIds({ ...transactionIds, [row.id]: event.target.value })} placeholder="付款后填写"/></td><td className="px-4 py-4"><div className="flex flex-wrap gap-2">{row.status === 'requested' ? <><button onClick={() => updateWithdrawal(row, 'reviewing')} className="border border-teal-600 px-3 py-2 font-bold text-teal-700">开始审核</button><button onClick={() => updateWithdrawal(row, 'rejected')} className="border border-red-300 px-3 py-2 font-bold text-red-700">拒绝</button></> : null}{row.status === 'reviewing' ? <button onClick={() => updateWithdrawal(row, 'processing')} className="border border-teal-600 px-3 py-2 font-bold text-teal-700">进入付款</button> : null}{row.status === 'processing' ? <><button onClick={() => updateWithdrawal(row, 'paid')} className="bg-teal-700 px-3 py-2 font-bold text-white">标记已支付</button><button onClick={() => updateWithdrawal(row, 'failed')} className="border border-red-300 px-3 py-2 font-bold text-red-700">付款失败</button></> : null}</div></td></tr>)}</tbody></table></div></section>
    <section className="mt-6 border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4 text-lg font-black">微信退款</div><div className="divide-y divide-stone-100">{data.refunds.map((row) => <div key={row.id} className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[1fr_auto]"><div><div className="font-black">{row.orderNo} · {row.outRefundNo}</div><div className="mt-1 text-stone-500">微信退款号 {row.providerRefundId || '等待微信返回'} · {row.reason}</div></div><div className="text-right"><div className="font-black">{money(row.amountFen / 100)}</div><div className="mt-1 text-xs font-bold text-stone-500">{row.status}{row.testMode ? ' · 未扣款' : ''}</div></div></div>)}{!data.refunds.length ? <div className="px-5 py-8 text-sm font-semibold text-stone-500">目前没有退款记录</div> : null}</div></section>
    <section className="mt-6 grid gap-5 xl:grid-cols-2"><div className="border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4 text-lg font-black">支付事件</div><div className="divide-y divide-stone-100">{data.paymentEvents.map((row) => <div key={row.id} className="px-5 py-4 text-sm"><div className="flex justify-between font-bold"><span>{row.provider} · {row.providerTransactionId}</span><span>{row.testMode ? '未扣款记录' : '已验签'}</span></div><div className="mt-1 text-stone-500">订单 {row.orderId} · {row.eventType} · {row.createdAt}</div></div>)}</div></div><div className="border border-stone-200 bg-white"><div className="border-b border-stone-200 px-5 py-4 text-lg font-black">冲正与审计</div><div className="max-h-[480px] divide-y divide-stone-100 overflow-auto">{data.auditEvents.map((row) => <div key={row.id} className="px-5 py-4 text-sm"><div className="flex justify-between font-bold"><span>{row.type}</span><span>{row.entityId}</span></div><div className="mt-1 text-stone-500">{row.createdAt}</div></div>)}</div></div></section>
  </div></main>;
}

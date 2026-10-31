'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarClock, Package, ReceiptText } from 'lucide-react';

type Detail = {
  entry: { id: string; orderNo: string; productName: string; sourceType: string; amount: number; status: string; expectedReleaseAt: string | null; availableAt: string | null; createdAt: string; ruleSnapshot: Record<string, string | number> };
  order: { orderNo: string; createdAt: string; paymentStatus: string; status: string; referralCode: string; confirmedAt: string | null; autoConfirmAt: string | null } | null;
  item: { productName: string; quantity: number; unitPrice: string; subtotal: string; ownerBrandName: string; referrerBrandName: string } | null;
};

const statuses: Record<string, string> = { pending: '待确认收益', frozen: '待确认收益', available: '可提现', cancelled: '已取消', reversal: '已冲正', paid: '已支付' };
const sources: Record<string, string> = { sale: '商品收益', referral: '会员推荐收益', brand_referral: '品牌推荐收益', active_rank: '近 30 天品牌销售贡献收益', other: '其他收益' };
const money = (value: number | string) => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WalletEntryDetailPage({ params }: { params: { id: string } }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch(`/api/cn/wallet/${encodeURIComponent(params.id)}`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取收益详情失败');
      setDetail(data);
    }).catch((reason) => setError(reason.message));
  }, [params.id]);
  if (error) return <main className="mx-auto max-w-3xl px-4 py-10"><Link href="/cn/member/wallet" className="font-bold text-teal-700">返回会员钱包</Link><div className="mt-6 border border-red-200 bg-red-50 p-5 font-bold text-red-700">{error}</div></main>;
  if (!detail) return <main className="mx-auto max-w-3xl px-4 py-10 text-stone-500">读取中...</main>;
  const { entry, order, item } = detail;
  return <main className="min-h-screen bg-[#f6f7f5] px-4 py-8"><div className="mx-auto max-w-3xl">
    <Link href="/cn/member/wallet" className="inline-flex items-center gap-1 text-sm font-bold text-stone-500"><ArrowLeft className="h-4 w-4" />会员钱包</Link>
    <header className="mt-4 border border-stone-200 bg-white p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm font-bold text-stone-500">收益详情</div><h1 className="mt-2 text-2xl font-black">{item?.productName || entry.productName}</h1><div className="mt-2 text-sm text-stone-500">来源订单 {entry.orderNo}</div></div><div className="text-right"><div className="text-3xl font-black text-teal-700">{money(entry.amount)}</div><div className="mt-2 text-sm font-bold">{statuses[entry.status] || entry.status}</div></div></div></header>
    <section className="mt-5 grid gap-4 sm:grid-cols-2"><div className="border border-stone-200 bg-white p-5"><div className="flex items-center gap-2 font-black"><ReceiptText className="h-5 w-5 text-teal-700" />来源与规则</div><dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-stone-500">收益来源</dt><dd className="font-bold">{sources[entry.sourceType] || entry.sourceType}</dd></div><div><dt className="text-stone-500">当时分润比例</dt><dd className="font-bold">{Number(entry.ruleSnapshot.rate || 0)}%</dd></div><div><dt className="text-stone-500">下单推荐码</dt><dd className="font-bold">{order?.referralCode || '无'}</dd></div>{entry.sourceType === 'active_rank' ? <><div><dt className="text-stone-500">统计期间</dt><dd className="font-bold">付款前近 {Number(entry.ruleSnapshot.activeRankWindowDays || 30)} 天</dd></div><div><dt className="text-stone-500">个人推荐成交／品牌总成交</dt><dd className="font-bold">{Number(entry.ruleSnapshot.activePersonalSalesQuantity || entry.ruleSnapshot.activePoints || 0)}／{Number(entry.ruleSnapshot.activeBrandSalesQuantity || entry.ruleSnapshot.totalActivePoints || 0)} 件</dd></div><div><dt className="text-stone-500">销售贡献比例</dt><dd className="font-bold">{Number(entry.ruleSnapshot.activeContributionRate || entry.ruleSnapshot.rate || 0).toFixed(2)}%</dd></div></> : null}</dl></div><div className="border border-stone-200 bg-white p-5"><div className="flex items-center gap-2 font-black"><Package className="h-5 w-5 text-teal-700" />商品</div><dl className="mt-4 grid gap-3 text-sm"><div><dt className="text-stone-500">品牌</dt><dd className="font-bold">{item?.ownerBrandName || '平台商城'}</dd></div><div><dt className="text-stone-500">数量与小计</dt><dd className="font-bold">{item?.quantity || 1} 件 · {money(item?.subtotal || 0)}</dd></div></dl></div></section>
    <section className="mt-5 border border-stone-200 bg-white p-5"><div className="flex items-center gap-2 font-black"><CalendarClock className="h-5 w-5 text-teal-700" />状态时间</div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-stone-500">产生时间</dt><dd className="font-bold">{new Date(entry.createdAt).toLocaleString('zh-CN')}</dd></div><div><dt className="text-stone-500">预计可提现日</dt><dd className="font-bold">{entry.expectedReleaseAt ? new Date(entry.expectedReleaseAt).toLocaleDateString('zh-CN') : '订单送达后计算'}</dd></div><div><dt className="text-stone-500">实际可提现时间</dt><dd className="font-bold">{entry.availableAt ? new Date(entry.availableAt).toLocaleString('zh-CN') : '尚未可提现'}</dd></div><div><dt className="text-stone-500">订单状态</dt><dd className="font-bold">{order?.status || '无关联订单'}</dd></div></dl></section>
  </div></main>;
}

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

// 后台订单 / 对账：门店预购次数（次卡）订单，与商城订单并列显示。
// T 档为内部付款测试，标「测试」，正式统计默认不计入（可勾选显示）。
export type StorePrepayAdminRow = {
  orderNo: string;
  applicationId: string;
  storeName: string;
  userId: number;
  applicantName?: string;
  tier: string;
  isTest: boolean;
  amountYuan: number;
  uses: number;
  status: 'pending' | 'paid';
  paidAt?: string;
  expiresAt?: string;
  transactionTail?: string;
  createdAt?: string;
};

function dt(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
}

function d(value?: string) {
  return value ? new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '—';
}

function yuan(value: number) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function summarizeStorePrepay(rows: StorePrepayAdminRow[]) {
  const paid = rows.filter((r) => r.status === 'paid');
  const formal = paid.filter((r) => !r.isTest);
  const test = paid.filter((r) => r.isTest);
  return {
    paidCount: formal.length,
    paidAmount: formal.reduce((s, r) => s + Number(r.amountYuan || 0), 0),
    testCount: test.length,
    testAmount: test.reduce((s, r) => s + Number(r.amountYuan || 0), 0),
    pendingCount: rows.filter((r) => r.status !== 'paid').length,
  };
}

export default function StorePrepayOrdersAdmin({ rows: given, fetchAll = false }: { rows?: StorePrepayAdminRow[]; fetchAll?: boolean }) {
  const [fetched, setFetched] = useState<StorePrepayAdminRow[] | null>(null);
  const [showTest, setShowTest] = useState(true);
  const [showPending, setShowPending] = useState(false);
  useEffect(() => {
    if (!fetchAll) return;
    void fetch('/api/cn/store-prepay-orders?scope=all', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((data) => setFetched(Array.isArray(data.orders) ? data.orders : []))
      .catch(() => setFetched([]));
  }, [fetchAll]);
  const rows = useMemo(() => given || fetched || [], [given, fetched]);
  const stats = useMemo(() => summarizeStorePrepay(rows), [rows]);
  const visible = rows.filter((r) => (showTest || !r.isTest) && (showPending || r.status === 'paid'));

  return (
    <section id="store-prepay-orders" className="scroll-mt-4 rounded-lg border border-teal-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-stone-950">预购次数（次卡）订单</h2>
          <p className="mt-1 text-xs font-bold text-stone-500">
            正式已付款 {stats.paidCount} 笔 · {yuan(stats.paidAmount)}（计入营收）
            {stats.testCount ? ` · 付款测试 ${stats.testCount} 笔 · ${yuan(stats.testAmount)}（不计入正式统计）` : ''}
            {stats.pendingCount ? ` · 待付款 ${stats.pendingCount} 笔` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-bold text-stone-700">
          <label className="flex items-center gap-1"><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} />显示付款测试</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={showPending} onChange={(e) => setShowPending(e.target.checked)} />显示待付款</label>
        </div>
      </div>
      {fetchAll && fetched === null && !given ? <div className="py-6 text-center text-sm font-bold text-stone-500">读取中</div> : null}
      {(given || fetched) && !visible.length ? <div className="py-6 text-center text-sm font-bold text-stone-500">暂无次卡预购订单</div> : null}
      {visible.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-xs font-black text-stone-500">
              <tr className="border-b border-stone-200">
                <th className="py-2 pr-3">类型</th><th className="py-2 pr-3">订单号</th><th className="py-2 pr-3">门店 / 申请人</th><th className="py-2 pr-3">档位 / 次数</th>
                <th className="py-2 pr-3">金额</th><th className="py-2 pr-3">状态</th><th className="py-2 pr-3">付款时间（北京）</th><th className="py-2 pr-3">到期日</th><th className="py-2 pr-3">交易号尾号</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.orderNo} className="border-b border-stone-100 font-semibold text-stone-800">
                  <td className="py-2 pr-3"><span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-black text-teal-800">预购次数（次卡）</span>{r.isTest ? <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-800">测试</span> : null}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.orderNo}</td>
                  <td className="py-2 pr-3"><Link href="/cn/ops#store-applications" className="text-teal-800 underline-offset-2 hover:underline">{r.storeName}</Link><div className="text-xs text-stone-500">{r.applicantName || `会员 ${r.userId}`}</div></td>
                  <td className="py-2 pr-3">{r.tier} 档 · {r.uses} 次</td>
                  <td className="py-2 pr-3 font-black">{yuan(r.amountYuan)}</td>
                  <td className="py-2 pr-3">{r.status === 'paid' ? '已付款' : '待付款'}</td>
                  <td className="py-2 pr-3 text-xs">{r.status === 'paid' ? dt(r.paidAt) : '—'}</td>
                  <td className="py-2 pr-3 text-xs">{r.status === 'paid' ? d(r.expiresAt) : '—'}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.transactionTail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

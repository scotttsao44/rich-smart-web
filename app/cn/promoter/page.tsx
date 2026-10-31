'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, CalendarDays, Copy, Download, QrCode, ShoppingBag, Store, Trophy, UserPlus, X } from 'lucide-react';
import ChinaLogoutButton from '@/components/ChinaLogoutButton';
import { useAuth } from '@/app/providers';

type Lead = { name: string; stage: string; task: string; source: string };
type BonusRow = { title: string; amount: string; detail: string };
type RankingRow = { rank: string; name: string; sales: string; share: string };
type AreaStore = { name: string; city: string; members: number; orders: number; sales: string; status: string };
type AreaAppointment = { time: string; customer: string; store: string; referrer: string; status: string };
type AreaOrder = { id: string; member: string; store: string; amount: string; reward: string; status: string };
type PipelineMetric = { title: string; value: string; detail: string };

const emptyPipeline: PipelineMetric[] = [
  { title: '已进入', value: '0', detail: '暂无记录' },
  { title: '已预约', value: '0', detail: '暂无记录' },
  { title: '已体验', value: '0', detail: '暂无记录' },
  { title: '可结算', value: '0', detail: '暂无记录' },
];

const monthOptions = Array.from({ length: 3 }, (_, index) => {
  const date = new Date();
  date.setMonth(date.getMonth() - index);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
});

function currencyTotal(rows: BonusRow[]) {
  const total = rows.reduce((sum, row) => sum + Number(row.amount.replace(/[^0-9.-]/g, '') || 0), 0);
  return `¥${total.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  const headers = Object.keys(rows[0] || {});
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ChinaPromoterWorkspacePage() {
  const { user } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]);
  const [activeView, setActiveView] = useState<'stores' | 'members' | 'appointments' | 'orders' | 'settlements'>('stores');
  const [copyState, setCopyState] = useState<'idle' | 'success' | 'error'>('idle');
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [bonusRows, setBonusRows] = useState<BonusRow[]>([]);
  const [rankingRows, setRankingRows] = useState<RankingRow[]>([]);
  const [areaStores, setAreaStores] = useState<AreaStore[]>([]);
  const [areaAppointments, setAreaAppointments] = useState<AreaAppointment[]>([]);
  const [areaOrders, setAreaOrders] = useState<AreaOrder[]>([]);
  const [pipeline, setPipeline] = useState<PipelineMetric[]>(emptyPipeline);
  const referralCode = user?.referralCode || '';
  const referralUrl = useMemo(() => {
    if (!referralCode) return '';
    const origin = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://rich-smart.cn');
    return `${origin.replace(/\/+$/, '')}/cn/experience?ref=${encodeURIComponent(referralCode)}`;
  }, [referralCode]);
  const visibleLeads = showAllMembers ? leads : leads.slice(0, 3);
  const settlementTotal = useMemo(() => currencyTotal(bonusRows), [bonusRows]);

  useEffect(() => {
    fetch('/api/cn/workspaces/agent')
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.metrics) && data.metrics.length) setPipeline(data.metrics.map((row: Record<string, unknown>, index: number) => ({
          title: String(row.title || row.label || emptyPipeline[index]?.title || '指标'),
          value: String(row.value ?? row.count ?? '0'),
          detail: String(row.detail || row.description || '暂无记录'),
        })));
        if (Array.isArray(data.referrals)) setLeads(data.referrals.map((row: Record<string, unknown>) => ({
          name: String(row.name || row.memberName || '会员'),
          stage: String(row.stage || row.status || '待跟进'),
          task: String(row.task || row.nextAction || ''),
          source: String(row.source || row.referralCode || referralCode),
        })));
        if (Array.isArray(data.stores)) setAreaStores(data.stores.map((row: Record<string, unknown>) => ({
          name: String(row.name || row.storeName || '未命名门店'),
          city: String(row.city || row.region || ''),
          members: Number(row.members || row.memberCount || 0),
          orders: Number(row.orders || row.orderCount || 0),
          sales: String(row.sales || row.salesAmount || '¥0.00'),
          status: String(row.status || '待确认'),
        })));
        if (Array.isArray(data.appointments)) setAreaAppointments(data.appointments.map((row: Record<string, unknown>) => ({
          time: String(row.time || row.appointmentTime || ''),
          customer: String(row.customer || row.memberName || '会员'),
          store: String(row.store || row.storeName || ''),
          referrer: String(row.referrer || row.referrerName || ''),
          status: String(row.status || '待确认'),
        })));
        if (Array.isArray(data.orders)) setAreaOrders(data.orders.map((row: Record<string, unknown>) => ({
          id: String(row.id || row.orderId || ''),
          member: String(row.member || row.memberName || '会员'),
          store: String(row.store || row.storeName || ''),
          amount: String(row.amount || row.totalAmount || '¥0.00'),
          reward: String(row.reward || row.commission || '¥0.00'),
          status: String(row.status || '待确认'),
        })));
        if (Array.isArray(data.settlements)) setBonusRows(data.settlements.map((row: Record<string, unknown>) => ({
          title: String(row.title || row.type || '分润'),
          amount: String(row.amount || row.value || '¥0.00'),
          detail: String(row.detail || row.status || ''),
        })));
        if (Array.isArray(data.rankings)) setRankingRows(data.rankings.map((row: Record<string, unknown>, index: number) => ({
          rank: String(row.rank || index + 1),
          name: String(row.name || row.brandName || '品牌'),
          sales: String(row.sales || row.salesAmount || '¥0.00'),
          share: String(row.share || row.contribution || '0%'),
        })));
      })
      .catch(() => undefined);
  }, [referralCode]);

  const openView = (view: typeof activeView, anchor = 'workspace-detail') => {
    setActiveView(view);
    window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const copyReferralUrl = async () => {
    if (!referralUrl) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(referralUrl);
      } else {
        const field = document.createElement('textarea');
        field.value = referralUrl;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(field);
        if (!copied) throw new Error('copy failed');
      }
      setCopyState('success');
    } catch {
      setCopyState('error');
    }
    window.setTimeout(() => setCopyState('idle'), 2400);
  };
  const exportBonus = () => downloadCsv(`richsmart-promoter-bonus-${selectedMonth}.csv`, bonusRows.map((row) => ({
    月份: selectedMonth,
    类型: row.title,
    金额: row.amount,
    明细: row.detail,
  })));

  return (
    <main className="min-h-screen bg-[#f7f3ea] px-4 py-6">
      <div className="mx-auto max-w-7xl">
        <section className="border-b border-stone-200 pb-6">
          <div className="mb-4 flex justify-end">
            <ChinaLogoutButton />
          </div>
          <div className="grid gap-8 lg:grid-cols-[1fr_0.85fr] lg:items-center">
            <div>
              <p className="text-sm font-black text-teal-700">{user?.name || '渠道伙伴'}</p>
              <h1 className="mt-2 text-3xl font-black leading-tight text-gray-950">渠道伙伴工作台</h1>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {[
                  ['成交订单', String(areaOrders.length), 'orders'],
                  ['有效客户', String(leads.length), 'members'],
                  ['可结算', settlementTotal, 'settlements'],
                ].map(([label, value, view]) => (
                  <button type="button" key={label} onClick={() => openView(view as typeof activeView, view === 'settlements' ? 'ranking-detail' : 'workspace-detail')} className="rounded-lg border border-gray-100 bg-[#fbfaf6] px-4 py-3 text-left transition hover:border-teal-500 hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500">
                    <p className="text-sm text-gray-500">{label}</p>
                    <p className="mt-1 text-2xl font-bold text-gray-950">{value}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-amber-100 bg-[#fffaf0] p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-lg bg-gray-950 p-3 text-white">
                  <QrCode size={24} />
                </div>
                <div>
                  <p className="text-sm text-gray-500">我的推荐码</p>
                  <h2 className="text-2xl font-bold text-gray-950">{referralCode || '尚未建立'}</h2>
                </div>
              </div>
              <div className="break-all rounded-lg bg-white p-4 text-sm font-semibold text-gray-700">
                {referralUrl}
              </div>
              <button type="button" onClick={copyReferralUrl} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gray-950 px-4 py-3 font-bold text-white">
                <Copy size={17} />
                {copyState === 'success' ? '复制成功' : copyState === 'error' ? '复制失败，请手动复制' : '复制分享链接'}
              </button>
              <p aria-live="polite" className={`mt-2 min-h-5 text-center text-xs font-bold ${copyState === 'error' ? 'text-red-700' : 'text-teal-700'}`}>
                {copyState === 'success' ? '链接已复制到剪贴板' : copyState === 'error' ? '浏览器未允许自动复制' : ''}
              </p>
            </div>
          </div>
        </section>

      <section className="py-6">
        <nav id="workspace-detail" className="mb-6 scroll-mt-4 flex gap-2 overflow-x-auto border-b border-stone-200 pb-3">
          {[
            ['stores', '合作门店'], ['members', '会员'], ['appointments', '预约'], ['orders', '订单'], ['settlements', '分润结算'],
          ].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setActiveView(key as typeof activeView)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-black ${activeView === key ? 'bg-stone-950 text-white' : 'border border-stone-200 bg-white text-stone-700'}`}>{label}</button>
          ))}
        </nav>
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <select
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-800"
          >
            {monthOptions.map((month) => <option key={month}>{month}</option>)}
          </select>
          <button
            type="button"
            onClick={exportBonus}
            className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-800"
          >
            <Download className="h-4 w-4" />
            导出分润
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {pipeline.map((item, index) => {
            const target: typeof activeView = index === 0 ? 'members' : index === 1 ? 'appointments' : index === 2 ? 'members' : 'settlements';
            return (
            <button type="button" onClick={() => openView(target)} key={item.title} className="rounded-lg border border-gray-100 bg-white p-5 text-left shadow-sm transition hover:border-teal-500 hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500">
              <p className="text-sm font-semibold text-gray-500">{item.title}</p>
              <p className="mt-2 text-4xl font-bold text-gray-950">{item.value}</p>
              <p className="mt-2 text-sm text-gray-600">{item.detail}</p>
            </button>
          );})}
        </div>

        {activeView === 'stores' ? <div className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white"><div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4"><Store className="h-5 w-5 text-teal-700" /><h2 className="font-black">合作门店</h2></div><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-stone-50 text-stone-500"><tr><th className="px-5 py-3">门店</th><th className="px-4 py-3">城市</th><th className="px-4 py-3">会员</th><th className="px-4 py-3">订单</th><th className="px-4 py-3">销售额</th><th className="px-4 py-3">状态</th></tr></thead><tbody className="divide-y divide-stone-100">{areaStores.map((row) => <tr key={row.name}><td className="px-5 py-4 font-black">{row.name}</td><td className="px-4 py-4">{row.city}</td><td className="px-4 py-4">{row.members}</td><td className="px-4 py-4">{row.orders}</td><td className="px-4 py-4 font-bold">{row.sales}</td><td className="px-4 py-4"><span className="rounded-full bg-teal-50 px-3 py-1 font-bold text-teal-700">{row.status}</span></td></tr>)}{!areaStores.length ? <tr><td colSpan={6} className="px-5 py-10 text-center font-bold text-stone-400">目前没有合作门店</td></tr> : null}</tbody></table></div> : null}

        {activeView === 'members' ? <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-teal-700" /><h2 className="font-black">推荐会员与跟进</h2></div><button type="button" onClick={() => setShowAllMembers((current) => !current)} className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-black text-stone-800">{showAllMembers ? '收起' : `查看全部（${leads.length}）`}</button></div><div className="mt-4 grid gap-3 md:grid-cols-3">{visibleLeads.map((lead) => <button type="button" onClick={() => setSelectedLead(lead)} key={lead.name} className="rounded-lg border border-stone-200 p-4 text-left transition hover:border-teal-500 hover:bg-teal-50"><div className="flex justify-between gap-3"><b>{lead.name}</b><span className="shrink-0 text-teal-700">{lead.stage}</span></div><p className="mt-2 text-sm text-stone-500">推荐码 {lead.source}</p><p className="mt-2 text-sm">待跟进：{lead.task}</p></button>)}{!visibleLeads.length ? <div className="rounded-lg bg-stone-50 p-8 text-center font-bold text-stone-400 md:col-span-3">目前没有推荐会员</div> : null}</div></div> : null}

        {activeView === 'appointments' ? <div className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white"><div className="flex items-center gap-2 border-b px-5 py-4"><CalendarDays className="h-5 w-5 text-teal-700" /><h2 className="font-black">渠道预约</h2></div><table className="w-full min-w-[680px] text-left text-sm"><tbody>{areaAppointments.map((row) => <tr key={row.time + row.customer} className="border-b"><td className="px-5 py-4 font-bold">{row.time}</td><td className="px-4 py-4">{row.customer}</td><td className="px-4 py-4">{row.store}</td><td className="px-4 py-4">推荐人 {row.referrer}</td><td className="px-4 py-4 text-teal-700">{row.status}</td></tr>)}{!areaAppointments.length ? <tr><td colSpan={5} className="px-5 py-10 text-center font-bold text-stone-400">目前没有预约记录</td></tr> : null}</tbody></table></div> : null}

        {activeView === 'orders' ? <div className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white"><div className="flex items-center gap-2 border-b px-5 py-4"><ShoppingBag className="h-5 w-5 text-teal-700" /><h2 className="font-black">渠道订单</h2></div><table className="w-full min-w-[760px] text-left text-sm"><tbody>{areaOrders.map((row) => <tr key={row.id} className="border-b"><td className="px-5 py-4 font-black">{row.id}</td><td className="px-4 py-4">{row.member}</td><td className="px-4 py-4">{row.store}</td><td className="px-4 py-4 font-bold">{row.amount}</td><td className="px-4 py-4 text-teal-700">渠道分润 {row.reward}</td><td className="px-4 py-4">{row.status}</td></tr>)}{!areaOrders.length ? <tr><td colSpan={6} className="px-5 py-10 text-center font-bold text-stone-400">目前没有订单记录</td></tr> : null}</tbody></table></div> : null}

        {activeView === 'settlements' ? <div className="mt-6 rounded-lg border border-teal-100 bg-teal-50 p-5"><div className="flex items-center justify-between"><div><p className="text-sm font-bold text-stone-500">{selectedMonth} 渠道结算</p><p className="mt-2 text-3xl font-black text-teal-800">{settlementTotal}</p></div><span className="rounded-full bg-white px-4 py-2 text-sm font-black text-amber-700">依订单状态结算</span></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{bonusRows.map((row) => <div key={row.title} className="rounded-lg bg-white p-4"><p className="text-sm text-stone-500">{row.title}</p><p className="mt-2 text-xl font-black">{row.amount}</p><p className="mt-1 text-xs text-stone-500">{row.detail}</p></div>)}{!bonusRows.length ? <div className="rounded-lg bg-white p-6 text-center font-bold text-stone-400 sm:col-span-3">目前没有结算记录</div> : null}</div></div> : null}

        <div className="mt-6">
          <div className="rounded-lg border border-teal-100 bg-teal-50 p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-lg bg-teal-600 p-3 text-white">
                <BadgeDollarSign size={24} />
              </div>
              <h2 className="text-xl font-bold text-gray-950">本月分润</h2>
            </div>
            <div className="space-y-3">
              {bonusRows.map((row) => (
                <div key={row.title} className="rounded-lg bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-gray-950">{row.title}</p>
                  </div>
                    <p className="shrink-0 font-bold text-teal-700">{row.amount}</p>
                  </div>
                </div>
              ))}
              {!bonusRows.length ? <div className="rounded-lg bg-white p-6 text-center font-bold text-stone-400">目前没有分润记录</div> : null}
            </div>
          </div>
        </div>

        <div id="ranking-detail" className="mt-6 scroll-mt-4 rounded-lg border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="rounded-lg bg-gray-950 p-3 text-white">
              <Trophy size={24} />
            </div>
            <h2 className="text-xl font-bold text-gray-950">近30天品牌销售贡献榜</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {rankingRows.map((row) => (
              <div key={row.rank} className="rounded-lg border border-gray-100 bg-[#fbfaf6] p-4">
                <p className="text-sm font-bold text-amber-700">#{row.rank}</p>
                <p className="mt-2 text-lg font-bold text-gray-950">{row.name}</p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="text-gray-500">推荐成交 {row.sales}</span>
                  <span className="font-bold text-teal-700">{row.share}</span>
                </div>
              </div>
            ))}
            {!rankingRows.length ? <div className="rounded-lg bg-[#fbfaf6] p-8 text-center font-bold text-stone-400 md:col-span-3">目前没有品牌销售记录</div> : null}
          </div>
        </div>
      </section>
      {selectedLead ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" onClick={() => setSelectedLead(null)}><div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black text-teal-700">推荐会员详情</p><h2 className="mt-1 text-2xl font-black">{selectedLead.name}</h2></div><button type="button" onClick={() => setSelectedLead(null)} className="rounded-lg border border-stone-200 p-2" aria-label="关闭"><X className="h-5 w-5" /></button></div><dl className="mt-5 grid gap-4 text-sm"><div><dt className="font-bold text-stone-500">当前阶段</dt><dd className="mt-1 font-black text-teal-700">{selectedLead.stage}</dd></div><div><dt className="font-bold text-stone-500">来源推荐码</dt><dd className="mt-1 font-black">{selectedLead.source}</dd></div><div><dt className="font-bold text-stone-500">下一步跟进</dt><dd className="mt-1 font-black">{selectedLead.task}</dd></div></dl></div></div> : null}
      </div>
    </main>
  );
}

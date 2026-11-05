'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BadgeDollarSign, Boxes, Building2, PackageCheck, RefreshCw, ShieldCheck, ShoppingCart, Store, Users } from 'lucide-react';
import ChinaLogoutButton from '@/components/ChinaLogoutButton';
import WechatPayReconciliationCenter, { ReconcileOrderItem, ReconciliationSummary } from '@/components/WechatPayReconciliationCenter';
import StorePrepayOrdersAdmin, { type StorePrepayAdminRow } from '@/components/StorePrepayOrdersAdmin';

type Overview = {
  viewer: { id: number; name: string };
  summary: Record<string, number>;
  members: Array<Record<string, any>>;
  brands: Array<Record<string, any>>;
  products: Array<Record<string, any>>;
  stores: Array<Record<string, any>>;
  orders: Array<Record<string, any>>;
  allOrders?: Array<Record<string, any>>;
  reconciliation?: ReconciliationSummary;
  storePrepayOrders?: StorePrepayAdminRow[];
  finance: { walletEntries?: Array<Record<string, any>>; withdrawals?: Array<Record<string, any>> };
};

const tabs = [
  { key: 'members', label: '会员' },
  { key: 'brands', label: '品牌' },
  { key: 'products', label: '商品' },
  { key: 'stores', label: '门店' },
  { key: 'orders', label: '订单' },
  { key: 'finance', label: '资金' },
] as const;

const statusText: Record<string, string> = {
  pending: '待处理', approved: '已通过', rejected: '已退回', active: '已开通',
  archived: '已下架', inactive: '未启用',
  pending_review: '待审核', revision_required: '待补件', pending_deposit: '待确认设备预付金',
  pending_equipment: '待配置设备', pending_partner_split: '待设置分润', pending_payment: '待付款',
  paid: '已付款', shipped: '已发货', delivered: '已送达', completed: '已完成', refunded: '已退款',
};

function money(value: unknown) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PlatformDataPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [active, setActive] = useState<(typeof tabs)[number]['key']>('members');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/cn/platform-overview', { cache: 'no-store' });
      if (response.status === 401 || response.status === 403) {
        window.location.replace('/cn/shop');
        return;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '平台数据读取失败');
      setOverview(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '平台数据读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    if (tabs.some((tab) => tab.key === view)) setActive(view as (typeof tabs)[number]['key']);
  }, []);

  const cards = useMemo(() => {
    const summary = overview?.summary || {};
    return [
      { label: '会员', value: summary.members || 0, icon: Users, view: 'members' as const },
      { label: '已通过品牌', value: summary.brands || 0, note: `${summary.pendingBrands || 0} 待审核`, icon: Building2, view: 'brands' as const },
      { label: '在售商品', value: summary.products || 0, note: `${summary.pendingProducts || 0} 待审核`, icon: Boxes, view: 'products' as const },
      { label: '已开通门店', value: summary.stores || 0, note: `${summary.pendingStores || 0} 处理中`, icon: Store, view: 'stores' as const },
      { label: '订单', value: (summary.orders || 0) + (summary.prepayOrders || 0), note: `商城 ${summary.paidOrders || 0} 已付款 · 次卡 ${summary.prepayPaidOrders || 0} 已付款`, icon: ShoppingCart, view: 'orders' as const },
      { label: '成交额', value: money(summary.gmvTotal ?? summary.gmv), note: `商城 ${money(summary.gmv)} · 次卡 ${money(summary.prepayRevenue)}${summary.prepayTestRevenue ? `（另测试 ${money(summary.prepayTestRevenue)} 未计入）` : ''}`, icon: BadgeDollarSign, view: 'finance' as const },
    ];
  }, [overview]);

  const setPlatformAdmin = async (member: Record<string, any>, enabled: boolean) => {
    const response = await fetch('/api/cn/platform-overview', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_platform_admin', userId: member.id, enabled }),
    });
    const data = await response.json();
    if (!response.ok) return window.alert(data.error || '权限调整失败');
    setOverview((current) => current ? {
      ...current,
      members: current.members.map((item) => item.id === member.id ? { ...item, platformAdmin: enabled } : item),
      summary: { ...current.summary, platformAdmins: current.members.filter((item) => item.id === member.id ? enabled : item.platformAdmin).length },
    } : current);
  };

  return (
    <main className="min-h-screen bg-[#f6f3ec] px-4 py-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-5">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-teal-700"><ShieldCheck className="h-4 w-4" />平台后台</div>
            <h1 className="mt-2 text-3xl font-black text-stone-950">全量数据</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4" />刷新</button>
            <Link href="/cn/ops" className="inline-flex items-center gap-2 rounded-lg bg-stone-950 px-4 py-2 text-sm font-bold text-white"><ArrowLeft className="h-4 w-4" />运营台</Link>
            <ChinaLogoutButton />
          </div>
        </header>

        {error ? <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 font-bold text-red-700">{error}</div> : null}
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {cards.map(({ label, value, note, icon: Icon, view }) => (
            <button key={label} type="button" onClick={() => setActive(view)} className={`rounded-lg border bg-white p-4 text-left transition-colors hover:border-teal-600 hover:bg-teal-50 ${active === view ? 'border-teal-700 shadow-[inset_3px_0_0_#0f766e]' : 'border-stone-200'}`}>
              <div className="flex items-center justify-between text-sm font-bold text-stone-500"><span>{label}</span><Icon className="h-4 w-4 text-teal-700" /></div>
              <div className="mt-2 text-2xl font-black text-stone-950">{value}</div>
              {note ? <div className="mt-1 text-xs font-bold text-amber-700">{note}</div> : null}
            </button>
          ))}
        </section>

        <div className="mt-6 flex gap-2 overflow-x-auto border-b border-stone-200 pb-3">
          {tabs.map((tab) => <button key={tab.key} type="button" onClick={() => setActive(tab.key)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-black ${active === tab.key ? 'bg-teal-700 text-white' : 'bg-white text-stone-700'}`}>{tab.label}</button>)}
        </div>

        <section className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {loading ? <div className="p-8 text-center font-bold text-stone-500">读取中</div> : null}
          {!loading && active === 'members' ? <div className="divide-y divide-stone-100">{overview?.members.length ? overview.members.map((member) => <div key={member.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-black text-stone-950">{member.name}</div><div className="mt-1 text-sm font-semibold text-stone-500">{member.phone || member.email || '未填写联系方式'} · {member.referralCode}</div></div><label className="flex items-center gap-2 text-sm font-bold text-stone-700"><input type="checkbox" checked={Boolean(member.platformAdmin)} disabled={member.id === overview.viewer?.id} onChange={(event) => setPlatformAdmin(member, event.target.checked)} />平台管理员</label></div><MemberReferralEditor member={member} onUpdated={(next) => setOverview((current) => current ? { ...current, members: current.members.map((item) => item.id === next.id ? { ...item, ...next } : item) } : current)} /></div>) : <Empty label="暂无会员" />}</div> : null}
          {!loading && active === 'brands' ? <Rows kind="brands" rows={overview?.brands || []} primary="brandName" secondary="companyName" status="status" empty="暂无品牌申请" /> : null}
          {!loading && active === 'products' ? <Rows kind="products" rows={overview?.products || []} primary="name" secondary="brandName" status="status" empty="暂无商品" /> : null}
          {!loading && active === 'stores' ? <Rows kind="stores" rows={overview?.stores || []} primary="name" secondary="address" status="status" empty="暂无门店申请" /> : null}
          {!loading && active === 'orders' ? <div className="p-4"><WechatPayReconciliationCenter orders={((overview?.allOrders || overview?.orders || []) as unknown) as ReconcileOrderItem[]} summary={overview?.reconciliation || null} onRefresh={load} /><div className="mt-4"><StorePrepayOrdersAdmin rows={overview?.storePrepayOrders || []} /></div></div> : null}
          {!loading && active === 'finance' ? <div className="grid gap-0 md:grid-cols-2"><FinanceRows title="分润流水" rows={overview?.finance?.walletEntries || []} /><FinanceRows title="提现申请" rows={overview?.finance?.withdrawals || []} /></div> : null}
        </section>

        <section className="mt-4 flex flex-wrap gap-2">
          <Link href="/cn/ops/brands" className="rounded-lg border border-teal-300 bg-white px-4 py-3 text-sm font-black text-teal-800">品牌与商品审核</Link>
          <Link href="/cn/ops/finance" className="rounded-lg border border-teal-300 bg-white px-4 py-3 text-sm font-black text-teal-800">财务与提现</Link>
          <Link href="/cn/ops#store-applications" className="rounded-lg border border-teal-300 bg-white px-4 py-3 text-sm font-black text-teal-800">门店申请审核</Link>
          <Link href="/cn/ops/finance" className="rounded-lg border border-teal-300 bg-white px-4 py-3 text-sm font-black text-teal-800">费率设置</Link>
        </section>
      </div>
    </main>
  );
}

function Empty({ label }: { label: string }) { return <div className="p-8 text-center font-bold text-stone-500">{label}</div>; }

function attributionText(member: Record<string, any>) {
  const pending = member.referralSource === 'pending_attribution' && !(Number(member.referredByMemberId) > 0);
  if (pending) return '归属待确认';
  if (member.referrerCode && member.referrerCode !== 'RS-CN-OFFICIAL') {
    return member.referrerName ? `${member.referrerName} · ${member.referrerCode}` : String(member.referrerCode);
  }
  return '官方直属';
}

function MemberReferralEditor({ member, onUpdated }: { member: Record<string, any>; onUpdated: (member: Record<string, any>) => void }) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (officialDirect: boolean) => {
    const trimmed = reason.trim();
    if (!trimmed) { setFailed(true); setMessage('请填写原因'); return; }
    if (!officialDirect && !code.trim()) { setFailed(true); setMessage('请填写新推荐码，或设为官方直属'); return; }
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      const response = await fetch('/api/cn/ops/referral-rebind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: member.id, reason: trimmed, officialDirect, referrerCode: officialDirect ? undefined : code.trim() }),
      });
      const data = await response.json();
      if (!response.ok) { setFailed(true); setMessage(data.error || '改绑失败'); return; }
      setFailed(false);
      setMessage(data.message || '已保存');
      setCode('');
      onUpdated(data.member);
    } catch {
      setFailed(true);
      setMessage('改绑失败');
    } finally {
      setBusy(false);
    }
  };
  return <div className="mt-3 border-t border-stone-100 pt-3">
    <div className="text-xs font-bold text-stone-500">当前推荐人：{attributionText(member)}</div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input aria-label={`${member.name}的新推荐码`} className="h-9 min-w-[10rem] flex-1 rounded border border-stone-300 px-2 text-sm" placeholder="新推荐码" value={code} onChange={(event) => setCode(event.target.value)} />
      <input aria-label={`${member.name}的改绑原因`} className="h-9 min-w-[10rem] flex-1 rounded border border-stone-300 px-2 text-sm" placeholder="原因（必填）" value={reason} onChange={(event) => setReason(event.target.value)} />
      <button type="button" disabled={busy} onClick={() => submit(false)} className="h-9 rounded bg-teal-700 px-3 text-xs font-black text-white disabled:opacity-50">改绑推荐人</button>
      <button type="button" disabled={busy} onClick={() => submit(true)} className="h-9 rounded border border-stone-400 bg-white px-3 text-xs font-black text-stone-800 disabled:opacity-50">设为官方直属</button>
    </div>
    <p className="mt-2 text-xs font-semibold leading-5 text-stone-500">已产生的收益与结算不回溯，之后的新订单按新推荐人计算。</p>
    {message ? <p className={`mt-1 text-xs font-bold ${failed ? 'text-red-700' : 'text-teal-800'}`}>{message}</p> : null}
  </div>;
}

const detailFields = {
  brands: [
    ['品牌编号', 'id'], ['会员编号', 'memberId'], ['品牌名称', 'brandName'], ['公司主体', 'companyName'],
    ['品牌分类', 'categoryLabel'], ['审核状态', 'status'], ['建立时间', 'createdAt'], ['更新时间', 'updatedAt'],
  ],
  products: [
    ['商品编号', 'id'], ['品牌', 'brandName'], ['商品名称', 'name'], ['SKU', 'sku'], ['分类', 'category'],
    ['审核状态', 'status'], ['销售状态', 'salesStatus'], ['是否启用', 'isActive'], ['库存', 'stockQuantity'], ['售价', 'priceCny'], ['更新时间', 'updatedAt'],
  ],
  stores: [
    ['门店编号', 'id'], ['门店名称', 'name'], ['地址', 'address'], ['联系人', 'contactName'], ['联系电话', 'contactPhone'],
    ['设备编号', 'deviceId'], ['状态', 'status'], ['建立时间', 'createdAt'], ['更新时间', 'updatedAt'],
  ],
} as const;

function Rows({ kind, rows, primary, secondary, status, empty }: { kind: keyof typeof detailFields; rows: Array<Record<string, any>>; primary: string; secondary: string; status: string; empty: string }) {
  if (!rows.length) return <Empty label={empty} />;
  return <div className="divide-y divide-stone-100">{rows.map((row) => <details key={row.id} className="group p-4 open:bg-stone-50">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3"><div><div className="font-black text-stone-950">{row[primary]}</div><div className="mt-1 text-sm font-semibold text-stone-500">{row[secondary] || '未填写'}</div></div><div className="flex items-center gap-2"><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black text-stone-700">{statusText[row[status]] || row[status]}</span><span className="text-xs font-black text-teal-700 group-open:hidden">查看明细</span><span className="hidden text-xs font-black text-teal-700 group-open:inline">收起明细</span></div></summary>
    <dl className="mt-4 grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-2 lg:grid-cols-3">{detailFields[kind].map(([label, key]) => <div key={key} className="min-w-0"><dt className="text-xs font-black text-stone-400">{label}</dt><dd className="mt-1 break-words text-sm font-bold text-stone-800">{formatDetailValue(row[key])}</dd></div>)}</dl>
  </details>)}</div>;
}

function formatDetailValue(value: unknown) {
  if (value === true) return '是';
  if (value === false) return '否';
  if (value == null || value === '') return '未填写';
  return String(value);
}

function FinanceRows({ title, rows }: { title: string; rows: Array<Record<string, any>> }) {
  return <div className="border-b border-stone-100 p-4 md:border-b-0 md:border-r"><h2 className="font-black text-stone-950">{title}</h2><div className="mt-3 space-y-2">{rows.length ? rows.slice(0, 50).map((row, index) => <div key={row.id || index} className="rounded-lg bg-stone-50 p-3"><div className="flex justify-between gap-3 text-sm font-bold"><span>{row.orderNo || row.userName || row.id}</span><span>{money(row.amount)}</span></div><div className="mt-1 text-xs font-semibold text-stone-500">{statusText[row.status] || row.status}</div></div>) : <div className="py-6 text-center text-sm font-bold text-stone-500">暂无记录</div>}</div></div>;
}

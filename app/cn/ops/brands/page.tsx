'use client';

import Link from 'next/link';
import BrandDocumentReview from '@/components/BrandDocumentReview';
import BrandClaimAdminPanel from '@/components/BrandClaimAdminPanel';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, ClipboardCheck, ExternalLink, X } from 'lucide-react';
import {
  BRAND_APPLICATION_DOCUMENT_LABELS,
  mergeLegacyBrandApplicationDocuments,
  normalizeBrandApplicationDocuments,
  type BrandApplicationDocument,
} from '@/lib/brand-application-documents';
import { displayBrandCategory } from '@/lib/cn-brand-taxonomy';

type Application = {
  id: number;
  slug: string;
  applicantUserId?: number | null;
  accountUserId?: number | null;
  brandName: string;
  companyName: string;
  category?: string;
  categoryMajorId?: string;
  categoryMinorId?: string;
  categoryMajorLabel?: string;
  categoryMinorLabel?: string;
  categoryLabel?: string;
  officialWebsite?: string;
  socialLink?: string;
  contactName: string;
  phone: string;
  wechat: string;
  introduction: string;
  registrationNo?: string;
  businessLicenseDocument?: string;
  businessLicenseName?: string;
  profileDocument?: string;
  profileDocumentName?: string;
  trademarkDocument?: string;
  trademarkName?: string;
  brandDocuments?: BrandApplicationDocument[];
  referrerBrandId?: number | null;
  referrerBrandName?: string;
  referrerBrandCode?: string;
  referrerRewardRate?: number;
  status: string;
  reviewNote: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: number | null;
};

type Product = {
  id: number;
  brandName: string;
  name: string;
  sku?: string;
  category: string;
  description?: string;
  priceCny: string;
  supplyPriceCny?: number;
  stockQuantity: number;
  fulfillmentInfo: string;
  shippingMethods?: string[];
  directRate?: number;
  upperRate?: number;
  activeRate?: number;
  status: string;
  reviewNote: string;
  imageIsTest: boolean;
  reviewedBy: number | null;
};

type PilotAccess = {
  id: string | number;
  status: string;
  memberId?: number | null;
  brandId?: number | null;
  nickname?: string;
  createdAt?: string;
  consumedAt?: string | null;
  expiresAt?: string;
  persistentAccess?: boolean;
  lastUsedAt?: string | null;
};

type BrandActivity = {
  id: string;
  action: string;
  actorId: number;
  actorName: string;
  entityType: 'brand' | 'product';
  entityId: number;
  detail: string;
  createdAt: string;
};

const statusLabels: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已退回',
};

function DocumentLink({ token, name, label }: { token?: string; name?: string; label: string }) {
  if (!token) {
    return (
      <div className="min-w-0 rounded-lg bg-slate-50 p-3">
        <div className="text-xs font-black text-slate-500">{label}</div>
        <div className="mt-1 text-sm font-bold text-stone-400">未上传</div>
      </div>
    );
  }
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 p-3">
      <div className="text-xs font-black text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-black text-slate-900" title={name || token}>{name || token}</div>
      <a
        href={`/api/cn/brand-document?token=${encodeURIComponent(token)}`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-teal-200 bg-white px-3 py-1.5 text-sm font-black text-teal-700 hover:bg-teal-50"
      >
        查看文件
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

function applicationDocuments(application: Application) {
  const listed = normalizeBrandApplicationDocuments(application.brandDocuments);
  return mergeLegacyBrandApplicationDocuments(listed, [
    { token: application.businessLicenseDocument, name: application.businessLicenseName, kind: 'license' },
    { token: application.profileDocument, name: application.profileDocumentName, kind: 'brand_profile' },
    { token: application.trademarkDocument, name: application.trademarkName, kind: 'brand_rights' },
  ]);
}

export default function BrandReviewPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rewardRates, setRewardRates] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [pilotAccessRows, setPilotAccessRows] = useState<PilotAccess[]>([]);
  const [pilotPermanentLinks, setPilotPermanentLinks] = useState<PilotAccess[]>([]);
  const [activities, setActivities] = useState<BrandActivity[]>([]);

  const load = useCallback(async () => {
    try {
      const [brandRes, productRes] = await Promise.all([
        fetch('/api/cn/brand-applications', { cache: 'no-store' }),
        fetch('/api/cn/brand-products?scope=review', { cache: 'no-store' }),
      ]);
      const pilotRes = await fetch('/api/auth/brand-pilot-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_access' }),
      });
      const brandData = await brandRes.json();
      const productData = await productRes.json();
      const pilotData = await pilotRes.json().catch(() => ({}));
      if (!brandRes.ok) throw new Error(brandData.error || '读取品牌失败');
      if (!productRes.ok) throw new Error(productData.error || '读取商品失败');
      const nextApplications = brandData.applications || [];
      setApplications(nextApplications);
      setProducts(productData.products || []);
      setActivities(brandData.audits || []);
      if (pilotRes.ok) {
        setPilotAccessRows(pilotData.invites || []);
        setPilotPermanentLinks(pilotData.accessLinks || []);
      }
      setRewardRates(Object.fromEntries(nextApplications.map((row: Application) => [row.id, String(row.referrerRewardRate ?? 0)])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取失败');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reviewBrand = async (id: number, decision: 'approved' | 'rejected') => {
    const note = notes[`b${id}`] || '';
    if (decision === 'rejected' && !note.trim()) return setMessage('退回品牌时请填写原因。');
    const key = `brand-${id}`;
    setBusyKey(key);
    setMessage('');
    try {
      const res = await fetch('/api/cn/brand-applications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision, reviewNote: note, referrerRewardRate: Number(rewardRates[id] || 0) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      setMessage(decision === 'approved' ? '品牌已通过，申请人的品牌工作台已开通。' : '品牌申请已退回。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyKey('');
    }
  };

  const reviewProduct = async (id: number, decision: 'approved' | 'rejected') => {
    const note = notes[`p${id}`] || '';
    if (decision === 'rejected' && !note.trim()) return setMessage('退回商品时请填写原因。');
    const key = `product-${id}`;
    setBusyKey(key);
    setMessage('');
    try {
      const res = await fetch('/api/cn/brand-products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'review', decision, reviewNote: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      setMessage(decision === 'approved' ? '商品已通过并上架。' : '商品已退回修改。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyKey('');
    }
  };

  const revokePilotAccessLink = async (accessId: string) => {
    setBusyKey(`revoke-${accessId}`);
    setMessage('');
    try {
      const res = await fetch('/api/auth/brand-pilot-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke_access_link', accessId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '撤销专属链接失败');
      setMessage('专属测试链接已撤销。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销专属链接失败');
    } finally {
      setBusyKey('');
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <Link href="/cn/ops" className="inline-flex items-center gap-2 font-bold text-slate-600"><ArrowLeft className="h-4 w-4" />返回平台运营台</Link>
          <Link href="/cn/shop" className="font-bold text-teal-700">查看商城</Link>
        </div>
        <div className="mt-6 flex items-center gap-3"><ClipboardCheck className="h-9 w-9 text-teal-700" /><h1 className="text-3xl font-black">品牌与商品审核</h1></div>
        {message ? <div role="status" className="sticky top-3 z-10 mt-5 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm font-bold text-teal-950 shadow-sm">{message}</div> : null}

        <section className="mt-6 rounded-lg border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">品牌测试账号纪录</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">长期专属链接与首次进入纪录。</p>
            </div>
          </div>
          {pilotPermanentLinks.length ? (
            <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black text-slate-500"><tr><th className="px-3 py-2">专属链接</th><th className="px-3 py-2">memberId</th><th className="px-3 py-2">最后使用</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">操作</th></tr></thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pilotPermanentLinks.map((row) => (
                    <tr key={String(row.id)}>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{String(row.id).slice(0, 18)}…</td>
                      <td className="px-3 py-2 font-black">{row.memberId || '-'}</td>
                      <td className="px-3 py-2 text-slate-600">{row.lastUsedAt || '尚未使用'}</td>
                      <td className="px-3 py-2 font-bold">{row.status === 'active' ? '可使用' : '已撤销'}</td>
                      <td className="px-3 py-2">{row.status === 'active' ? <button disabled={Boolean(busyKey)} onClick={() => revokePilotAccessLink(String(row.id))} className="rounded border border-red-200 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50">撤销</button> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {pilotAccessRows.length ? (
            <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black text-slate-500">
                  <tr>
                    <th className="px-3 py-2">memberId</th>
                    <th className="px-3 py-2">昵称</th>
                    <th className="px-3 py-2">建立时间</th>
                    <th className="px-3 py-2">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {pilotAccessRows.map((row) => (
                    <tr key={String(row.id)}>
                      <td className="px-3 py-2 font-black text-slate-900">{row.memberId || '-'}</td>
                      <td className="px-3 py-2 font-bold text-slate-700">{row.nickname || '未填写'}</td>
                      <td className="px-3 py-2 text-slate-600">{row.createdAt || '-'}</td>
                      <td className="px-3 py-2"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-black">{statusLabels[row.status] || row.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <BrandClaimAdminPanel brands={applications} onChanged={() => void load()} />

        <section id="brand-review" className="mt-6 scroll-mt-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black">品牌申请</h2><span className="text-sm text-slate-500">待审 {applications.filter((row) => row.status === 'pending').length}</span></div>
          <div className="grid gap-4">
            {applications.map((row) => {
              const busy = busyKey === `brand-${row.id}`;
              return (
                <article key={row.id} className="min-w-0 rounded-lg border bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><div className="text-xl font-black">{row.brandName}</div><div className="mt-1 text-sm text-slate-600">memberId {row.accountUserId || row.applicantUserId || '-'} · {row.companyName} · {displayBrandCategory(row)}</div></div>
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold">{statusLabels[row.status] || row.status}</span>
                  </div>
                  <div className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
                    <div><div className="font-bold text-slate-500">申请联系人</div><div className="mt-1 font-black">{row.contactName} · {row.phone || row.wechat || '未填写'}</div></div>
                    <div><div className="font-bold text-slate-500">会员与时间</div><div className="mt-1 font-black">memberId {row.accountUserId || row.applicantUserId || '-'} · {row.submittedAt || '未填写'}</div></div>
                    <div><div className="font-bold text-slate-500">统一社会信用代码</div><div className="mt-1 font-black">{row.registrationNo || '未填写'}</div></div>
                    <div><div className="font-bold text-slate-500">官网</div><div className="mt-1 break-all">{row.officialWebsite ? <a href={row.officialWebsite} target="_blank" rel="noreferrer" className="font-black text-teal-700">{row.officialWebsite}</a> : '未填写'}</div></div>
                    <div><div className="font-bold text-slate-500">社群</div><div className="mt-1 break-all">{row.socialLink ? <a href={row.socialLink} target="_blank" rel="noreferrer" className="font-black text-teal-700">{row.socialLink}</a> : '未填写'}</div></div>
                  </div>
                  <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm">
                    <div className="mb-3 font-black text-slate-900">审核文件 · {applicationDocuments(row).length} 份</div>
                    {applicationDocuments(row).length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{applicationDocuments(row).map((document) => <DocumentLink key={document.token} token={document.token} name={document.name} label={BRAND_APPLICATION_DOCUMENT_LABELS[document.kind]} />)}</div> : <div className="text-sm font-bold text-stone-400">未上传</div>}
                  </div>
                  <BrandDocumentReview key={JSON.stringify([row.companyName, row.registrationNo, row.submittedAt, applicationDocuments(row)])} applicationId={row.id} canReview />
                  <div className="mt-4"><div className="text-xs font-bold text-slate-500">品牌简介</div><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.introduction}</p></div>
                  {row.referrerBrandName ? (
                    <div className="mt-4 grid gap-3 rounded-lg border border-teal-100 bg-teal-50 p-3 sm:grid-cols-[1fr_180px] sm:items-end">
                      <div><div className="text-xs font-bold text-teal-700">品牌推荐商</div><div className="mt-1 font-black">{row.referrerBrandName} · {row.referrerBrandCode}</div><div className="mt-1 text-xs text-slate-600">独立于会员推荐分润，按商品毛利计算。</div></div>
                      <label className="text-xs font-bold text-slate-600">审核确认比例<div className="mt-1 flex rounded-lg border border-stone-300 bg-white px-3"><input type="number" min="0" max="100" step="0.1" value={rewardRates[row.id] ?? String(row.referrerRewardRate || 0)} disabled={row.status !== 'pending'} onChange={(event) => setRewardRates((current) => ({ ...current, [row.id]: event.target.value }))} className="min-w-0 flex-1 py-2 outline-none" /><span className="py-2">%</span></div></label>
                    </div>
                  ) : null}
                  {row.status === 'pending' ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                      <input className="input-field" placeholder="退回原因（退回时必填）" value={notes[`b${row.id}`] || ''} onChange={(event) => setNotes({ ...notes, [`b${row.id}`]: event.target.value })} />
                      <button disabled={Boolean(busyKey)} onClick={() => reviewBrand(row.id, 'approved')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white disabled:opacity-50"><Check className="h-4 w-4" />{busy ? '处理中' : '通过并开通工作台'}</button>
                      <button disabled={Boolean(busyKey)} onClick={() => reviewBrand(row.id, 'rejected')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50"><X className="h-4 w-4" />退回补件</button>
                    </div>
                  ) : <div className="mt-3 text-xs text-slate-500">{row.reviewNote || '已处理'} · 审核人 {row.reviewedBy || '-'} · {row.reviewedAt || row.submittedAt}</div>}
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-lg border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-xl font-black">品牌操作记录</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">申请、商品送审、品牌前页保存与发布都会留在这里。</p>
            </div>
            <span className="text-sm font-bold text-slate-500">最近 {Math.min(activities.length, 100)} 笔</span>
          </div>
          <div className="max-h-[520px] divide-y divide-slate-100 overflow-auto">
            {activities.slice(0, 100).map((row) => (
              <div key={row.id} className="grid gap-2 px-5 py-4 text-sm md:grid-cols-[170px_1fr_auto] md:items-center">
                <div>
                  <div className="font-black text-slate-900">{row.actorName || `会员 ${row.actorId}`}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">memberId {row.actorId}</div>
                </div>
                <div>
                  <div className="font-black text-slate-800">{row.detail}</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">{row.entityType === 'product' ? '商品' : '品牌'} {row.entityId} · {row.action}</div>
                </div>
                <time className="text-xs font-bold text-slate-500">{new Date(row.createdAt).toLocaleString('zh-CN')}</time>
              </div>
            ))}
            {!activities.length ? <div className="px-5 py-8 text-center text-sm font-bold text-slate-500">尚无品牌操作记录</div> : null}
          </div>
        </section>

        <section id="product-review" className="mt-9 scroll-mt-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-black">商品审核</h2><span className="text-sm text-slate-500">待审 {products.filter((row) => row.status === 'pending').length}</span></div>
          <div className="grid gap-4">
            {products.map((row) => {
              const busy = busyKey === `product-${row.id}`;
              return (
                <article key={row.id} className="rounded-lg border bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black text-teal-700">商品品牌：{row.brandName}</div><div className="mt-1 text-xl font-black">{row.name}</div><div className="mt-1 text-sm text-slate-600">SKU {row.sku || '未填写'} · {row.category}</div></div><span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold">{statusLabels[row.status] || row.status}</span></div>
                  <div className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-3"><div><span className="font-bold text-slate-500">售价</span><div className="mt-1 font-black">¥{row.priceCny}</div></div><div><span className="font-bold text-slate-500">品牌结算价</span><div className="mt-1 font-black">¥{row.supplyPriceCny ?? 0}</div></div><div><span className="font-bold text-slate-500">库存</span><div className="mt-1 font-black">{row.stockQuantity}</div></div></div>
                  {row.description ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{row.description}</p> : null}
                  <div className="mt-3 text-sm text-slate-600">发货：{row.fulfillmentInfo}{row.shippingMethods?.length ? ` · ${row.shippingMethods.join('、')}` : ''}{row.imageIsTest ? ' · 商品参考图' : ''}</div>
                  <div className="mt-3 rounded-lg bg-teal-50 p-3 text-sm font-bold text-teal-900">可分配部分：直接推荐 {row.directRate ?? 30}% · 上层推荐 {row.upperRate ?? 5}% · 近30天销售贡献榜 {row.activeRate ?? 65}%</div>
                  {row.status === 'pending' ? <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]"><input className="input-field" placeholder="退回原因（退回时必填）" value={notes[`p${row.id}`] || ''} onChange={(event) => setNotes({ ...notes, [`p${row.id}`]: event.target.value })} /><button disabled={Boolean(busyKey)} onClick={() => reviewProduct(row.id, 'approved')} className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? '处理中' : '通过并上架'}</button><button disabled={Boolean(busyKey)} onClick={() => reviewProduct(row.id, 'rejected')} className="rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:opacity-50">退回补件</button></div> : <div className="mt-3 text-xs text-slate-500">{row.reviewNote || '已处理'} · 审核人 {row.reviewedBy || '-'}</div>}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

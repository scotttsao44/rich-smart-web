'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';

type Application = { id: string; name: string; address: string; contactName: string; contactPhone: string; applicationDocument: string; applicationDocumentName: string; applicantName: string; depositAmount: number; equipmentShareRate: number; status: string; reviewNote: string; equipmentNo: string; referrerMemberId?: number; prepay?: { tier: string; amountYuan: number; uses: number; status: 'unpaid' | 'paid'; orderNo: string; transactionId?: string; paidAt?: string; expiresAt?: string; creditStatus?: string; creditEquipmentNo?: string; creditedAt?: string }; participants: Array<{ userId: number; name: string; role: string; shareRate: number; depositContribution: number; confirmed: boolean }> };
const creditLabels: Record<string, string> = { awaiting_equipment: '待绑定设备', pending_credit: '待灌入次数', credited: '已灌入次数' };
const cnTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—');
const labels: Record<string, string> = { pending_review: '待平台审核', revision_required: '退回补件', rejected: '已拒绝', pending_deposit: '待确认设备预付金', pending_equipment: '待配置设备', pending_partner_split: '待合伙人设置分润', active: '运营中' };

export default function StoreApplicationReview() {
  const [rows, setRows] = useState<Application[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [equipment, setEquipment] = useState<Record<string, string>>({});
  const [equipmentShares, setEquipmentShares] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const load = async () => { const response = await fetch('/api/cn/store-applications'); if (response.ok) setRows((await response.json()).applications || []); };
  useEffect(() => { load(); }, []);
  const act = async (id: string, action: string) => {
    if (busyId) return;
    const row = rows.find((item) => item.id === id);
    setBusyId(id);
    setMessage('');
    try {
      const response = await fetch('/api/cn/store-applications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, reviewNote: notes[id] || '', equipmentNo: equipment[id] || '', equipmentShareRate: equipmentShares[id] ?? row?.equipmentShareRate }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作失败');
      setMessage('门店申请状态已更新。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusyId('');
    }
  };
  return <section id="store-review" className="mt-6 scroll-mt-4 rounded-lg border border-stone-200 bg-white">
    <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4"><ClipboardCheck className="h-5 w-5 text-teal-700" /><h2 className="text-lg font-black">门店申请审核</h2></div>
    {message ? <div role="status" className="mx-5 mt-4 rounded-lg bg-teal-50 px-4 py-3 text-sm font-bold text-teal-900">{message}</div> : null}
    <div className="grid gap-4 p-5">{rows.length ? rows.map((row) => <article key={row.id} className="rounded-lg border border-stone-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{row.name}</h3><p className="mt-1 text-sm text-stone-500">{row.address} · 申请人 {row.applicantName}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{labels[row.status] || row.status}</span></div>
      <div className="mt-3 grid gap-2 rounded-lg bg-stone-50 p-3 text-sm md:grid-cols-3">
        <div><span className="font-bold text-stone-500">联系人</span><div className="mt-1 font-black">{row.contactName || row.applicantName}</div></div>
        <div><span className="font-bold text-stone-500">联系电话</span><div className="mt-1 font-black">{row.contactPhone || '未填写'}</div></div>
        <div><span className="font-bold text-stone-500">申请附件</span><div className="mt-1">{row.applicationDocument ? <a href={`/api/cn/store-document?token=${encodeURIComponent(row.applicationDocument)}`} target="_blank" rel="noreferrer" className="font-black text-teal-700">查看 {row.applicationDocumentName || '门店申请文件'}</a> : '未上传'}</div></div>
      </div>
      {row.prepay ? <div className={`mt-3 grid gap-2 rounded-lg p-3 text-sm md:grid-cols-3 ${row.prepay.status === 'paid' ? 'bg-emerald-50' : 'bg-amber-50'}`}>
        <div><span className="font-bold text-stone-500">预购次数（次卡）</span><div className="mt-1 font-black">{row.prepay.tier} 档 · ¥{row.prepay.amountYuan.toLocaleString()} · {row.prepay.uses} 次 · {row.prepay.status === 'paid' ? '已付款' : '待付款'}</div></div>
        <div><span className="font-bold text-stone-500">订单号 / 微信交易号</span><div className="mt-1 break-all font-black">{row.prepay.orderNo || '—'}<br />{row.prepay.transactionId || '—'}</div></div>
        <div><span className="font-bold text-stone-500">付款时间 / 有效期至</span><div className="mt-1 font-black">{cnTime(row.prepay.paidAt)}<br />{row.prepay.expiresAt ? cnTime(row.prepay.expiresAt) : '—'}</div></div>
        {row.prepay.status === 'paid' ? <div className="md:col-span-3 flex flex-wrap items-center gap-2 font-bold">灌入状态：{creditLabels[row.prepay.creditStatus || ''] || '—'}{row.prepay.creditEquipmentNo ? ` · 设备 ${row.prepay.creditEquipmentNo}` : ''}{row.prepay.creditedAt ? ` · ${cnTime(row.prepay.creditedAt)}` : ''}{row.prepay.creditStatus === 'pending_credit' ? <button disabled={Boolean(busyId)} onClick={() => act(row.id, 'mark_credited')} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">确认已灌入 {row.prepay.uses} 次</button> : null}</div> : null}
        {row.referrerMemberId ? <div className="md:col-span-3 text-xs font-bold text-stone-500">推荐会员 ID：{row.referrerMemberId}</div> : null}
      </div> : null}
      <div className="mt-3 grid gap-2 md:grid-cols-2">{row.participants.map((person) => <div key={`${row.id}-${person.name}`} className="rounded-lg bg-stone-50 px-3 py-2 text-xs font-bold">
        <div>{person.name} · {person.role} · {person.confirmed ? '已确认' : '待确认'}</div>
        <div className="mt-1 text-teal-700">合伙分润 {person.shareRate}%</div>
      </div>)}</div>
      <div className="mt-3 grid gap-3 text-sm font-bold md:grid-cols-3"><div>{row.prepay ? '预购次数（次卡）' : '设备预付金'} ¥{row.depositAmount.toLocaleString()}</div><div>设备 {row.equipmentNo || '未配置'}</div><div>设备方比例 {row.equipmentShareRate}%</div></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <input className="input-field min-w-[240px] flex-1" placeholder="审核备注" value={notes[row.id] || ''} onChange={(event) => setNotes({ ...notes, [row.id]: event.target.value })} />
        {row.status === 'pending_review' ? <><label className="flex items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-bold">设备方 %<input className="w-20 py-2 outline-none" type="number" min="0" max="100" value={equipmentShares[row.id] ?? row.equipmentShareRate} onChange={(event) => setEquipmentShares({ ...equipmentShares, [row.id]: Number(event.target.value) })} /></label><button disabled={Boolean(busyId)} onClick={() => act(row.id, 'approve')} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busyId === row.id ? '处理中' : '审核通过'}</button><button disabled={Boolean(busyId)} onClick={() => act(row.id, 'revision')} className="rounded-lg border px-4 py-2 text-sm font-bold disabled:opacity-50">退回补件</button><button disabled={Boolean(busyId)} onClick={() => act(row.id, 'reject')} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50">拒绝</button></> : null}
        {row.status === 'pending_deposit' ? <button onClick={() => act(row.id, 'confirm_deposit')} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white">确认设备预付金到账</button> : null}
        {row.status === 'pending_equipment' ? <><input className="input-field w-52" placeholder="设备编号" value={equipment[row.id] || ''} onChange={(event) => setEquipment({ ...equipment, [row.id]: event.target.value })} /><button onClick={() => act(row.id, 'activate')} className="rounded-lg bg-stone-950 px-4 py-2 text-sm font-bold text-white">绑定设备并启用</button></> : null}
      </div>
    </article>) : <div className="rounded-lg bg-stone-50 p-6 text-center text-sm text-stone-500">目前没有门店申请</div>}</div>
  </section>;
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Building2, Check, ClipboardList, Plus, Trash2, UserPlus } from 'lucide-react';
import StorePrepayPanel, { formatCnDate } from '@/components/StorePrepayPanel';

type DirectoryMember = { id: number; name: string; email: string; phone: string };
type Participant = { userId: number; name?: string; role: string; shareRate: number; depositContribution: number; confirmed?: boolean };
type Application = {
  id: string; name: string; address: string; depositAmount: number; applicantId: number; status: string; equipmentNo: string;
  applicationDocument?: string; applicationDocumentName?: string;
  prepay?: { tier: string; amountYuan: number; uses: number; status: 'unpaid' | 'paid'; orderNo: string; paidAt?: string; expiresAt?: string; creditStatus?: string };
  equipmentShareRate: number; participants: Participant[]; reviewNote: string;
  transactions?: Array<{ id: string; amount: number; occurredAt: string; shares: Array<{ userId: number; amount: number }> }>;
};

const statusLabels: Record<string, string> = {
  pending_review: '待平台审核', revision_required: '退回补件', rejected: '已拒绝', pending_deposit: '待确认设备预付金',
  pending_equipment: '待配置设备', pending_partner_split: '待合伙人确认与分润设置', active: '运营中',
};
const roles = ['门店负责人', '场地方', '销售方', '业务推广方', '门店合伙人'];

export default function MemberStoreApplications({ userId }: { userId: number }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [directory, setDirectory] = useState<DirectoryMember[]>([]);
  const [message, setMessage] = useState('');
  const [invites, setInvites] = useState<Record<string, { userId: number; role: string }>>({});
  const [shares, setShares] = useState<Record<string, Record<number, number>>>({});
  const [usageAmounts, setUsageAmounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const response = await fetch('/api/cn/store-applications');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '门店资料读取失败');
    setApplications(data.applications || []);
    setDirectory(data.directory || []);
  }, []);

  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);

  const patch = async (body: Record<string, unknown>, success: string) => {
    setMessage('');
    const response = await fetch('/api/cn/store-applications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    setMessage(response.ok ? success : data.error || '操作失败');
    if (response.ok) await load();
  };

  const addPartner = async (application: Application) => {
    const fallback = directory.find((member) => !application.participants.some((person) => person.userId === member.id));
    const invite = invites[application.id] || { userId: fallback?.id || 0, role: '门店合伙人' };
    if (!invite.userId) return setMessage('没有可邀请的已注册会员');
    await patch({ id: application.id, action: 'add_participant', ...invite }, '合伙人邀请已建立，等待对方确认');
  };

  const saveSplit = async (application: Application) => {
    const split = application.participants.map((person) => ({ userId: person.userId, shareRate: shares[application.id]?.[person.userId] ?? person.shareRate }));
    await patch({ id: application.id, action: 'configure_split', shares: split }, '新分润比例已保存，仅适用于之后的新交易');
  };

  return (
    <section id="store-applications" className="mt-6 scroll-mt-4 rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
        <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-teal-700" /><h2 className="text-lg font-black text-stone-950">我参与的门店</h2></div>
        <div className="flex flex-wrap gap-2">
          <a href="#store-application-progress" className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold text-stone-700"><ClipboardList className="h-4 w-4" />查看申请进度</a>
          <Link href="/cn/member/store-application" className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white"><Plus className="h-4 w-4" />申请门店</Link>
        </div>
      </div>
      {message ? <div className="mx-5 mt-4 rounded-lg bg-teal-50 px-4 py-3 text-sm font-bold text-teal-800">{message}</div> : null}
      <div className="border-b border-stone-100 bg-stone-50 px-5 py-4">
        <div className="flex flex-col gap-3 rounded-lg border border-teal-100 bg-white p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-black text-stone-950">申请前先看阿富同学门店导览</div>
            <p className="mt-1 text-sm font-semibold leading-6 text-stone-600">先了解产品、门店服务流程与非医疗说明；可在导览页在线提交申请并预购次数（次卡），也可由客服协助建单。</p>
          </div>
          <Link href="/cn/member/store-application" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-stone-950 px-4 py-3 text-sm font-bold text-white">前往导览 <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </div>
      <div id="store-application-progress" className="grid scroll-mt-4 gap-3 p-5 xl:grid-cols-2">
        {applications.length ? applications.map((application) => {
          const mine = application.participants.find((row) => row.userId === userId);
          const canManage = application.applicantId === userId;
          const transactions = application.transactions || [];
          const myEquipmentIncome = transactions.reduce((sum, transaction) => sum + Number(transaction.shares.find((share) => share.userId === userId)?.amount || 0), 0);
          const available = directory.filter((member) => !application.participants.some((person) => person.userId === member.id));
          const invite = invites[application.id] || { userId: available[0]?.id || 0, role: '门店合伙人' };
          const editable = canManage && ['pending_partner_split', 'active'].includes(application.status);
          const partnerTotal = application.participants.reduce((sum, person) => sum + Number(shares[application.id]?.[person.userId] ?? person.shareRate), 0);
          return <article key={application.id} className="rounded-lg border border-stone-200 p-4">
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-black text-stone-950">{application.name}</h3><p className="mt-1 text-sm text-stone-500">{application.address}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{statusLabels[application.status] || application.status}</span></div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">{application.prepay ? <div>预购次数（次卡）：<b>{application.prepay.tier} 档 · {application.prepay.uses} 次 · {application.prepay.status === 'paid' ? `已付款${application.prepay.expiresAt ? `，有效期至 ${formatCnDate(application.prepay.expiresAt)}` : ''}` : '待付款'}</b>{application.prepay.status === 'paid' ? <div className="text-xs text-stone-500">{application.prepay.creditStatus === 'credited' ? '次数已灌入设备' : '设备绑定后灌入次数'}</div> : null}</div> : <div>设备预付金：<b>¥{application.depositAmount.toLocaleString()}</b></div>}<div>设备方比例：<b>{application.equipmentShareRate}%</b></div><div>设备：<b>{application.equipmentNo || '尚未配置'}</b></div><div>我的收益：<b>¥{myEquipmentIncome.toFixed(2)}</b></div></div>
            {application.reviewNote ? <div className="mt-3 rounded-lg bg-stone-50 p-3 text-sm">审核备注：{application.reviewNote}</div> : null}
            {canManage && application.prepay && application.prepay.status !== 'paid' && ['pending_review', 'revision_required', 'pending_deposit'].includes(application.status) ? <div className="mt-3"><StorePrepayPanel compact applicationId={application.id} initialTier={application.prepay.tier} returnPath="/cn/member/store-application" onPaid={() => { void load(); }} /></div> : null}

            {['pending_partner_split', 'active'].includes(application.status) ? <div className="mt-4 border-t border-stone-100 pt-4">
              <div className="mb-3 flex items-center justify-between"><div className="font-black">合伙成员分润</div><div className="text-xs font-bold text-stone-500">可分配 {100 - application.equipmentShareRate}% · 当前 {partnerTotal}%</div></div>
              <div className="space-y-2">{application.participants.map((person) => <div key={person.userId} className="grid items-center gap-2 rounded-lg bg-stone-50 p-3 md:grid-cols-[1fr_1fr_110px_auto]">
                <div><b>{person.name}</b><div className="text-xs text-stone-500">{person.confirmed ? '已确认' : '待本人确认'}</div></div>
                <div className="text-sm font-bold">{person.role}</div>
                {editable ? <label className="text-xs font-bold text-stone-500">分润 %<input className="input-field mt-1" type="number" min="0" max="100" value={shares[application.id]?.[person.userId] ?? person.shareRate} onChange={(event) => setShares({ ...shares, [application.id]: { ...(shares[application.id] || {}), [person.userId]: Number(event.target.value) } })} /></label> : <b>{person.shareRate}%</b>}
                {editable && person.userId !== application.applicantId ? <button type="button" aria-label="移除成员" onClick={() => patch({ id: application.id, action: 'remove_participant', userId: person.userId }, '成员已移除')} className="flex h-10 w-10 items-center justify-center text-red-700"><Trash2 className="h-4 w-4" /></button> : <span />}
              </div>)}</div>
              {mine && !mine.confirmed ? <button type="button" onClick={() => patch({ id: application.id, action: 'confirm' }, '已确认参与该门店')} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white"><Check className="h-4 w-4" />确认参与</button> : null}
              {editable ? <>
                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <select className="input-field" value={invite.userId} onChange={(event) => setInvites({ ...invites, [application.id]: { ...invite, userId: Number(event.target.value) } })}>{available.length ? available.map((member) => <option key={member.id} value={member.id}>{member.name}</option>) : <option value="0">没有可邀请会员</option>}</select>
                  <select className="input-field" value={invite.role} onChange={(event) => setInvites({ ...invites, [application.id]: { ...invite, role: event.target.value } })}>{roles.map((role) => <option key={role}>{role}</option>)}</select>
                  <button type="button" onClick={() => addPartner(application)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-2 text-sm font-bold"><UserPlus className="h-4 w-4" />邀请</button>
                </div>
                <button type="button" onClick={() => saveSplit(application)} className="mt-3 w-full rounded-lg bg-teal-700 px-4 py-3 text-sm font-bold text-white">保存分润并启用</button>
              </> : null}
            </div> : null}

            {application.status === 'active' ? <div className="mt-4 flex gap-2"><input className="input-field" type="number" min="0.01" step="0.01" placeholder="本次设备使用费" value={usageAmounts[application.id] || ''} onChange={(event) => setUsageAmounts({ ...usageAmounts, [application.id]: Number(event.target.value) })} /><button type="button" onClick={() => patch({ id: application.id, action: 'record_usage', amount: Number(usageAmounts[application.id] || 0) }, '设备使用费已登记并按当前比例分润')} className="shrink-0 rounded-lg bg-stone-950 px-4 py-2 text-sm font-bold text-white">登记并分润</button></div> : null}
          </article>;
        }) : <div className="col-span-full rounded-lg bg-stone-50 p-6 text-center text-sm font-semibold text-stone-500">
          <div>目前没有门店申请记录。可阅读导览后在线提交申请，或联系糙米健康服务协助建立申请。</div>
          <Link href="/cn/member/store-application" className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-white">了解阿富同学门店申请 <ArrowRight className="h-4 w-4" /></Link>
        </div>}
      </div>
    </section>
  );
}

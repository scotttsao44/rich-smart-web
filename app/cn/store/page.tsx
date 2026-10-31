'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  HeartPulse,
  PackageCheck,
  ScanLine,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import ChinaLogoutButton from '@/components/ChinaLogoutButton';

type Appointment = {
  id: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  service: string;
  status: '已预约' | '检测完成' | '已取消';
  note: string;
};

type Member = {
  id: string;
  userId?: number;
  name: string;
  phone: string;
  level: string;
  lastVisit: string;
  healthStatus: string;
  recommendation: string;
  totalSpent: number;
  source: string;
};

type RevenueRow = {
  time: string;
  type: string;
  source: string;
  item: string;
  amount: number;
  income: number;
  status: string;
};

type RevenueDetails = Record<'total' | 'device' | 'product', RevenueRow[]>;

const emptyRevenueDetails: RevenueDetails = { total: [], device: [], product: [] };

function recentMonths() {
  return Array.from({ length: 3 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - index);
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}

const monthOptions = recentMonths();

function money(value: number) {
  return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
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

function statusClass(status: Appointment['status']) {
  if (status === '检测完成') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === '已取消') return 'bg-stone-100 text-stone-600 border-stone-200';
  return 'bg-amber-50 text-amber-700 border-amber-100';
}

export default function ChinaStoreWorkspacePage() {
  const [storeName, setStoreName] = useState('我的门店');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [revenueDetails, setRevenueDetails] = useState<RevenueDetails>(emptyRevenueDetails);
  const [selectedRevenue, setSelectedRevenue] = useState<'total' | 'device' | 'product'>('total');
  const [selectedDate, setSelectedDate] = useState('09/13');
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [newAppointmentOpen, setNewAppointmentOpen] = useState(false);
  const [newAppointment, setNewAppointment] = useState({ time: '', name: '', phone: '', service: '设备体验' });
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]);
  const [healthForm, setHealthForm] = useState({ category: '健康优选', value: '报告已上传', summary: '', fileName: '', dValue: '', consentGranted: false, hasPacemaker: false, isPregnant: false, isUnderFive: false });
  const [healthSaving, setHealthSaving] = useState(false);
  const [healthSaved, setHealthSaved] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/cn/workspaces/store').then(async (response) => response.ok ? response.json() : null),
      fetch('/api/cn/store-applications').then(async (response) => response.ok ? response.json() : null),
    ])
      .then(([workspace, stores]) => {
        if (workspace) {
          if (Array.isArray(workspace.appointments)) setAppointments(workspace.appointments);
          if (Array.isArray(workspace.members)) setMembers(workspace.members);
          if (Array.isArray(workspace.followUps)) setFollowUps(workspace.followUps.map((item: { memberId?: string }) => String(item.memberId || '')));
          if (Array.isArray(workspace.settlements)) {
            const total = workspace.settlements.map((row: Record<string, unknown>) => ({
              time: String(row.time || row.createdAt || ''),
              type: String(row.type || '分润'),
              source: String(row.source || row.memberName || ''),
              item: String(row.item || row.title || ''),
              amount: Number(row.amount || 0),
              income: Number(row.income || row.reward || 0),
              status: String(row.status || '待确认'),
            }));
            setRevenueDetails({
              total,
              device: total.filter((row: RevenueRow) => row.type.includes('设备') || row.type.includes('机器')),
              product: total.filter((row: RevenueRow) => row.type.includes('商品') || row.type.includes('订单')),
            });
          }
        }
        const activeStore = stores?.applications?.find((row: { status?: string }) => row.status === 'active') || stores?.applications?.[0];
        if (activeStore?.name) setStoreName(String(activeStore.name));
      })
      .catch(() => undefined);
  }, []);

  const revenueCards = useMemo(() => ([
    { key: 'total' as const, title: '本月收益', value: revenueDetails.total.reduce((sum, row) => sum + row.income, 0), detail: `${revenueDetails.total.length} 笔记录`, icon: BadgeDollarSign },
    { key: 'device' as const, title: '机器使用费', value: revenueDetails.device.reduce((sum, row) => sum + row.income, 0), detail: `${revenueDetails.device.length} 次体验`, icon: ScanLine },
    { key: 'product' as const, title: '商品成交', value: revenueDetails.product.reduce((sum, row) => sum + row.income, 0), detail: `${revenueDetails.product.length} 笔订单`, icon: PackageCheck },
  ]), [revenueDetails]);

  const appointmentStats = useMemo(() => ({
    booked: appointments.filter((item) => item.date === selectedDate && item.status === '已预约').length,
    completed: appointments.filter((item) => item.date === selectedDate && item.status === '检测完成').length,
    cancelled: appointments.filter((item) => item.date === selectedDate && item.status === '已取消').length,
  }), [appointments, selectedDate]);

  const calendarDays = useMemo(() => ['09/13', '09/14', '09/15', '09/16', '09/17'].map((date) => ({
    date,
    count: appointments.filter((item) => item.date === date).length,
  })), [appointments]);

  const selectedAppointments = useMemo(() => appointments.filter((item) => item.date === selectedDate), [appointments, selectedDate]);

  const updateAppointmentStatus = async (id: string, status: Appointment['status']) => {
    const response = await fetch('/api/cn/workspaces/store', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: 'appointments', id, updates: { status } }) });
    if (!response.ok) return;
    setAppointments((current) => current.map((item) => (
      item.id === id ? { ...item, status } : item
    )));
  };

  const createAppointment = async () => {
    if (!newAppointment.time.trim() || !newAppointment.name.trim() || !newAppointment.phone.trim()) return;
    const item: Appointment = {
      id: `A${Date.now()}`,
      date: selectedDate,
      time: newAppointment.time,
      name: newAppointment.name,
      phone: newAppointment.phone,
      service: newAppointment.service,
      status: '已预约',
      note: '门店新增预约',
    };
    const response = await fetch('/api/cn/workspaces/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: 'appointments', item }) });
    if (!response.ok) return;
    setAppointments((current) => [
      ...current,
      item,
    ]);
    setNewAppointment({ time: '', name: '', phone: '', service: '设备体验' });
    setNewAppointmentOpen(false);
  };

  const createFollowUp = async (member: Member) => {
    if (followUps.includes(member.id)) return;
    const response = await fetch('/api/cn/workspaces/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collection: 'followUps', item: { id: `FU-${Date.now()}`, memberId: member.id, memberName: member.name, status: '待回访', createdAt: new Date().toISOString() } }) });
    if (!response.ok) return;
    setFollowUps((current) => [...current, member.id]);
  };

  const saveHealthRecord = async () => {
    if (!selectedMember || !healthForm.fileName || !healthForm.consentGranted) return;
    setHealthSaving(true);
    setHealthSaved(false);
    const response = await fetch('/api/cn/member-health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: selectedMember.userId, memberName: selectedMember.name, ...healthForm, source: storeName }),
    });
    setHealthSaving(false);
    if (!response.ok) {
      const data = await response.json();
      window.alert(data.error || '健康资料保存失败');
      return;
    }
    setHealthSaved(true);
  };

  const exportAppointments = () => downloadCsv(`richsmart-store-appointments-${selectedMonth}.csv`, appointments.map((item) => ({
    月份: selectedMonth,
    日期: item.date,
    时间: item.time,
    客人: item.name,
    手机号: item.phone,
    服务: item.service,
    状态: item.status,
    备注: item.note,
  })));

  const exportRevenue = () => downloadCsv(`richsmart-store-revenue-${selectedMonth}-${selectedRevenue}.csv`, revenueDetails[selectedRevenue].map((row) => ({
    月份: selectedMonth,
    时间: row.time,
    类型: row.type,
    会员: row.source,
    项目: row.item,
    交易金额: row.amount,
    门店收益: row.income,
    状态: row.status,
  })));

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200 pb-5">
          <div>
            <p className="text-sm font-bold text-teal-700">{storeName}</p>
            <h1 className="text-3xl font-black text-stone-950">门店工作台</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-800"
            >
              {monthOptions.map((month) => <option key={month}>{month}</option>)}
            </select>
            <button
              type="button"
              onClick={exportAppointments}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-800"
            >
              <Download className="h-4 w-4" />
              导出预约
            </button>
            <button
              type="button"
              onClick={() => setNewAppointmentOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-800"
            >
              <CalendarClock className="h-4 w-4" />
              新增预约
            </button>
            <Link href="/cn/experience" className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white">
              <UserPlus className="h-4 w-4" />
              新建会员
            </Link>
            <ChinaLogoutButton />
          </div>
        </header>

        <section className="mt-6 grid gap-3 md:grid-cols-4">
          <a href="#store-appointments" className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
            <div className="text-sm font-bold text-stone-500">今日预约</div>
            <div className="mt-2 text-2xl font-black text-stone-950">{selectedAppointments.length}</div>
          </a>
          <a href="#store-appointments" className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
            <div className="text-sm font-bold text-stone-500">待完成</div>
            <div className="mt-2 text-2xl font-black text-amber-700">{appointmentStats.booked}</div>
          </a>
          <a href="#store-appointments" className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
            <div className="text-sm font-bold text-stone-500">已完成</div>
            <div className="mt-2 text-2xl font-black text-emerald-700">{appointmentStats.completed}</div>
          </a>
          <a href="#store-appointments" className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
            <div className="text-sm font-bold text-stone-500">已取消</div>
            <div className="mt-2 text-2xl font-black text-stone-500">{appointmentStats.cancelled}</div>
          </a>
        </section>

        <section id="store-appointments" className="mt-6 scroll-mt-4 grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-lg border border-stone-200 bg-white">
            <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4">
              <CalendarClock className="h-5 w-5 text-teal-700" />
              <h2 className="text-lg font-black text-stone-950">预约日历</h2>
            </div>
            <div className="grid grid-cols-5 gap-2 border-b border-stone-100 p-4">
              {calendarDays.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => setSelectedDate(day.date)}
                  className={`rounded-lg border px-3 py-3 text-left ${selectedDate === day.date ? 'border-teal-600 bg-teal-50' : 'border-stone-200 bg-white'}`}
                >
                  <div className="text-sm font-black text-stone-950">{day.date}</div>
                  <div className="mt-1 text-xs font-bold text-stone-500">{day.count} 笔预约</div>
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-5 py-3">时间</th>
                    <th className="px-4 py-3">客人</th>
                    <th className="px-4 py-3">服务</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">备注</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {selectedAppointments.map((item) => (
                    <tr key={item.id}>
                      <td className="px-5 py-4 text-xl font-black text-stone-950">{item.time}</td>
                      <td className="px-4 py-4">
                        <div className="font-black text-stone-950">{item.name}</div>
                        <div className="mt-1 text-xs font-semibold text-stone-500">{item.phone}</div>
                      </td>
                      <td className="px-4 py-4 text-stone-700">{item.service}</td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClass(item.status)}`}>{item.status}</span>
                      </td>
                      <td className="px-4 py-4 text-stone-600">{item.note}</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          {item.status !== '检测完成' && item.status !== '已取消' ? (
                            <button type="button" onClick={() => updateAppointmentStatus(item.id, '检测完成')} className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white">完成</button>
                          ) : null}
                          {item.status !== '已取消' ? (
                            <button type="button" onClick={() => updateAppointmentStatus(item.id, '已取消')} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700">取消</button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!selectedAppointments.length ? <tr><td colSpan={6} className="px-5 py-10 text-center font-bold text-stone-400">目前没有预约记录</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white">
            <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4">
              <BadgeDollarSign className="h-5 w-5 text-teal-700" />
              <h2 className="text-lg font-black text-stone-950">收益数据看板</h2>
            </div>
            <div className="grid gap-3 p-5">
              {revenueCards.map((card) => {
                const Icon = card.icon;
                const active = selectedRevenue === card.key;
                return (
                  <button
                    key={card.key}
                    type="button"
                    aria-label={`切换收益类型：${card.title}`}
                    onClick={() => setSelectedRevenue(card.key as 'total' | 'device' | 'product')}
                    className={`flex items-center justify-between rounded-lg border p-4 text-left ${active ? 'border-teal-500 bg-teal-50' : 'border-stone-200 bg-white'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${active ? 'bg-teal-700 text-white' : 'bg-stone-100 text-stone-700'}`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="font-black text-stone-950">{card.title}</div>
                        <div className="mt-1 text-xs font-semibold text-stone-500">{card.detail}</div>
                      </div>
                    </div>
                    <div className="font-black text-stone-950">{money(card.value)}</div>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-stone-100 p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-black text-stone-950">交易流水账</div>
                <button
                  type="button"
                  onClick={exportRevenue}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-stone-800"
                >
                  <Download className="h-4 w-4" />
                  导出流水
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                    <tr>
                      <th className="px-3 py-2">时间</th>
                      <th className="px-3 py-2">类型</th>
                      <th className="px-3 py-2">会员</th>
                      <th className="px-3 py-2">项目</th>
                      <th className="px-3 py-2 text-right">交易</th>
                      <th className="px-3 py-2 text-right">收益</th>
                      <th className="px-3 py-2">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                {revenueDetails[selectedRevenue].map((row) => (
                  <tr key={`${row.time}-${row.item}`}>
                    <td className="px-3 py-3 font-semibold text-stone-700">{row.time}</td>
                    <td className="px-3 py-3 font-bold text-stone-950">{row.type}</td>
                    <td className="px-3 py-3 text-stone-700">{row.source}</td>
                    <td className="px-3 py-3 text-stone-700">{row.item}</td>
                    <td className="px-3 py-3 text-right font-bold text-stone-950">{money(row.amount)}</td>
                    <td className="px-3 py-3 text-right font-black text-teal-700">{money(row.income)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${row.status === '已入账' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{row.status}</span>
                    </td>
                  </tr>
                ))}
                {!revenueDetails[selectedRevenue].length ? <tr><td colSpan={7} className="px-3 py-10 text-center font-bold text-stone-400">目前没有交易记录</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-teal-700" />
              <h2 className="text-lg font-black text-stone-950">会员总览</h2>
            </div>
            <span className="text-sm font-bold text-stone-500">{members.length} 位会员</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                <tr>
                  <th className="px-5 py-3">会员</th>
                  <th className="px-4 py-3">等级</th>
                  <th className="px-4 py-3">最近到店</th>
                  <th className="px-4 py-3">检测状态</th>
                  <th className="px-4 py-3">推送商品</th>
                  <th className="px-4 py-3 text-right">消费</th>
                  <th className="px-4 py-3 text-right">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="px-5 py-4">
                      <div className="font-black text-stone-950">{member.name}</div>
                      <div className="mt-1 text-xs font-semibold text-stone-500">{member.phone}</div>
                    </td>
                    <td className="px-4 py-4 font-bold text-stone-700">{member.level}</td>
                    <td className="px-4 py-4 text-stone-700">{member.lastVisit}</td>
                    <td className="px-4 py-4 text-stone-700">{member.healthStatus}</td>
                    <td className="px-4 py-4">
                      <div className="font-bold text-teal-700">{member.recommendation}</div>
                      {followUps.includes(member.id) ? <div className="mt-1 text-xs font-bold text-emerald-700">已建立回访</div> : null}
                    </td>
                    <td className="px-4 py-4 text-right font-black text-stone-950">{money(member.totalSpent)}</td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedMember(member)}
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-stone-800"
                      >
                        查看
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {!members.length ? <tr><td colSpan={7} className="px-5 py-10 text-center font-bold text-stone-400">目前没有会员记录</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {newAppointmentOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <section className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-stone-950">新增预约</h2>
              <button type="button" onClick={() => setNewAppointmentOpen(false)} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-3">
              <input className="rounded-lg border border-stone-300 px-3 py-3 outline-none focus:border-teal-600" placeholder="时间，例如 16:30" value={newAppointment.time} onChange={(event) => setNewAppointment((current) => ({ ...current, time: event.target.value }))} />
              <input className="rounded-lg border border-stone-300 px-3 py-3 outline-none focus:border-teal-600" placeholder="客人姓名" value={newAppointment.name} onChange={(event) => setNewAppointment((current) => ({ ...current, name: event.target.value }))} />
              <input className="rounded-lg border border-stone-300 px-3 py-3 outline-none focus:border-teal-600" placeholder="手机号" value={newAppointment.phone} onChange={(event) => setNewAppointment((current) => ({ ...current, phone: event.target.value }))} />
              <select className="rounded-lg border border-stone-300 px-3 py-3 outline-none focus:border-teal-600" value={newAppointment.service} onChange={(event) => setNewAppointment((current) => ({ ...current, service: event.target.value }))}>
                <option>设备体验</option>
                <option>检测复查</option>
                <option>检测复查</option>
                <option>会员回访</option>
              </select>
              <button
                type="button"
                onClick={createAppointment}
                disabled={!newAppointment.time.trim() || !newAppointment.name.trim() || !newAppointment.phone.trim()}
                className="rounded-lg bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50"
              >
                建立预约
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {selectedMember ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
          <section className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black text-stone-950">会员资料</h2>
              <button type="button" onClick={() => setSelectedMember(null)} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-3">
              <div className="rounded-lg bg-stone-50 p-4">
                <div className="text-2xl font-black text-stone-950">{selectedMember.name}</div>
                <div className="mt-1 text-sm font-semibold text-stone-500">{selectedMember.phone} · {selectedMember.level}</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-stone-200 p-4">
                  <div className="text-xs font-bold text-stone-500">最近到店</div>
                  <div className="mt-2 font-black text-stone-950">{selectedMember.lastVisit}</div>
                </div>
                <div className="rounded-lg border border-stone-200 p-4">
                  <div className="text-xs font-bold text-stone-500">累计消费</div>
                  <div className="mt-2 font-black text-stone-950">{money(selectedMember.totalSpent)}</div>
                </div>
              </div>
              <div className="rounded-lg border border-stone-200 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-stone-500">
                  <HeartPulse className="h-4 w-4" />
                  检测状态
                </div>
                <div className="mt-2 font-bold text-stone-950">{selectedMember.healthStatus}</div>
              </div>
              <div className="rounded-lg border border-stone-200 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-stone-500">
                  <ClipboardList className="h-4 w-4" />
                  推送商品
                </div>
                <div className="mt-2 font-bold text-teal-700">{selectedMember.recommendation}</div>
              </div>
              <div className="rounded-lg border border-stone-200 p-4">
                <div className="text-xs font-bold text-stone-500">来源</div>
                <div className="mt-2 font-bold text-stone-950">{selectedMember.source}</div>
              </div>
              <div className="rounded-lg border border-teal-100 bg-teal-50 p-4">
                <div className="flex items-center gap-2 font-black text-teal-900"><HeartPulse className="h-4 w-4" />上传会员健康记录</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <select className="input-field bg-white" value={healthForm.category} onChange={(event) => setHealthForm((current) => ({ ...current, category: event.target.value }))}>
                    <option>健康优选</option><option>睡眠调理</option><option>酵素调理</option><option>益生菌</option><option>门店复查</option>
                  </select>
                  <input className="input-field bg-white" type="number" min="0" step="0.001" value={healthForm.dValue} onChange={(event) => setHealthForm((current) => ({ ...current, dValue: event.target.value }))} placeholder="D 值（如报告提供）" />
                </div>
                <input className="input-field mt-3 bg-white" value={healthForm.summary} onChange={(event) => setHealthForm((current) => ({ ...current, summary: event.target.value }))} placeholder="检测摘要与建议" />
                <input className="input-field mt-3 bg-white" type="file" accept="application/pdf,.pdf" onChange={(event) => setHealthForm((current) => ({ ...current, fileName: event.target.files?.[0]?.name || '' }))} />
                <div className="mt-3 grid gap-2 rounded-lg border border-teal-100 bg-white p-3 text-sm font-semibold text-stone-700 sm:grid-cols-2">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={healthForm.consentGranted} onChange={(event) => setHealthForm((current) => ({ ...current, consentGranted: event.target.checked }))} />会员本人已授权保存</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={healthForm.hasPacemaker} onChange={(event) => setHealthForm((current) => ({ ...current, hasPacemaker: event.target.checked }))} />有心脏起搏器</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={healthForm.isPregnant} onChange={(event) => setHealthForm((current) => ({ ...current, isPregnant: event.target.checked }))} />孕妇</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={healthForm.isUnderFive} onChange={(event) => setHealthForm((current) => ({ ...current, isUnderFive: event.target.checked }))} />5 岁以下</label>
                </div>
                <button type="button" onClick={saveHealthRecord} disabled={healthSaving || !healthForm.fileName || !healthForm.consentGranted} className="mt-3 w-full rounded-lg bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">{healthSaving ? '保存中' : healthSaved ? '已保存到会员档案' : '保存健康记录'}</button>
              </div>
              {followUps.includes(selectedMember.id) ? (
                <div className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 font-bold text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" />
                  回访已建立
                </div>
              ) : (
                <button type="button" onClick={() => createFollowUp(selectedMember)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-3 font-bold text-white">
                  <CheckCircle2 className="h-5 w-5" />
                  建立回访
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

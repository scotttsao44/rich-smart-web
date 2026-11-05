'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  BadgeDollarSign,
  Bell,
  Building2,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  HeartPulse,
  Home,
  Link as LinkIcon,
  MessageCircle,
  QrCode,
  RefreshCw,
  Send,
  ShoppingBag,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trash2,
  Users,
  WalletCards,
} from 'lucide-react';
import { useAuth } from '@/app/providers';
import MemberStoreApplications from '@/components/MemberStoreApplications';
import ReferralQrCode from '@/components/ReferralQrCode';
import StoreOwnerNotifyCard from '@/components/StoreOwnerNotifyCard';
import ChinaMobileTabBar from '@/components/ChinaMobileTabBar';

type WorkspaceRow = Record<string, any>;
type ReferralRange = '7d' | '30d' | '90d' | 'month';
type ReferralTemplate = 'winback' | 'appointment';
type ReferralEngagement = {
  range?: ReferralRange;
  rangeLabel?: string;
  metrics?: Record<string, any>;
  details?: Record<string, WorkspaceRow[]>;
  members?: WorkspaceRow[];
  wakeup?: { coverUrl?: string; linkTitle?: string; themeLabel?: string; wechatMedia?: 'article' | 'image' | 'news' | 'none'; templateFallback?: boolean };
};
type PromotionQualification = {
  status?: 'not_applied' | 'granted' | 'disabled' | 'not_found';
  canApply?: boolean;
  reason?: string;
  appliedAt?: string | null;
  approvedAt?: string | null;
  policyVersion?: string | null;
};
type MemberWorkspace = { profile?: WorkspaceRow; metrics?: Array<{ label: string; value: string }>; referralCode?: string; referralPath?: string; referralRelation?: WorkspaceRow | null; referrals?: WorkspaceRow[]; referralEngagement?: ReferralEngagement; appointments?: WorkspaceRow[]; orders?: WorkspaceRow[]; purchases?: WorkspaceRow[]; commissions?: WorkspaceRow[]; health?: WorkspaceRow[]; isDemoData?: boolean };
type BrandApplication = { brandName: string; status: 'pending' | 'approved' | 'rejected' };
type PilotIdentity = { memberId?: number | null; nickname?: string; status?: string; createdAt?: string; identityComplete?: boolean } | null;
type MemberNotification = { id: string; title: string; message: string; imageUrl?: string; linkUrl?: string; readAt?: string | null; createdAt: string };

const monthOptions = ['2026/09', '2026/08', '2026/07'];

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

export default function ChinaMemberDashboardPage() {
  const { user, login, logout } = useAuth();
  const [ownCodeCopied, setOwnCodeCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('2026/09');
  const [workspace, setWorkspace] = useState<MemberWorkspace>({});
  const [brandApplication, setBrandApplication] = useState<BrandApplication | null>(null);
  const [pilotIdentity, setPilotIdentity] = useState<PilotIdentity>(null);
  const [wechatBindingConfigured, setWechatBindingConfigured] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameMessage, setNicknameMessage] = useState('');
  const [editingMemberName, setEditingMemberName] = useState(false);
  const [memberNameInput, setMemberNameInput] = useState('');
  const [memberNameSaving, setMemberNameSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [referralRange, setReferralRange] = useState<ReferralRange>('30d');
  const [referralFilter, setReferralFilter] = useState('all');
  const [selectedReferralMembers, setSelectedReferralMembers] = useState<number[]>([]);
  const [detailKey, setDetailKey] = useState<'visits' | 'orders' | 'appointments' | 'registrations'>('visits');
  const [preview, setPreview] = useState<{ template: ReferralTemplate; recipients: WorkspaceRow[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [promotionApplying, setPromotionApplying] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [notifications, setNotifications] = useState<MemberNotification[]>([]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/wechat/config', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return false;
      const config = await response.json();
      return /MicroMessenger/i.test(navigator.userAgent) ? config?.officialConfigured === true : config?.openConfigured === true;
    }).then((configured) => {
      if (!cancelled) setWechatBindingConfigured(configured);
    }).catch(() => {
      if (!cancelled) setWechatBindingConfigured(false);
    });
    return () => { cancelled = true; };
  }, []);

  const loadMemberWorkspace = useCallback(async (range: ReferralRange) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/cn/workspaces/member?range=${range}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '会员资料读取失败');
      setWorkspace(data);
      setSelectedReferralMembers([]);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '会员资料读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadMemberWorkspace(referralRange);
  }, [user, referralRange, loadMemberWorkspace]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/cn/member-notifications').then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      setNotifications(data.notifications || []);
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/cn/brand-applications?scope=self').then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      setBrandApplication((data.applications || [])[0] || null);
      setPilotIdentity(data.pilotIdentity || null);
      if (data.pilotIdentity?.nickname) setNicknameDraft(data.pilotIdentity.nickname);
    }).catch(() => {});
  }, [user]);

  const referralRows = workspace.referrals || [];
  const engagement = workspace.referralEngagement || {};
  const engagementMembers = engagement.members || [];
  const filteredEngagementMembers = engagementMembers.filter((row) => referralFilter === 'all' || row.activityKey === referralFilter);
  const appointmentRows = workspace.appointments || [];
  const recommendedOrders = workspace.orders || [];
  const orderRows = workspace.purchases || [];
  const commissionRows = workspace.commissions || [];
  const healthRows: WorkspaceRow[] = (workspace.health || []).map((row): WorkspaceRow => ({ ...row, href: row.recommendationBlocked ? '' : `/cn/shop?category=${encodeURIComponent(String(row.category || '健康优选'))}` }));
  const promotionQualification = (workspace.profile?.promotionQualification || {}) as PromotionQualification;
  const promotionStatus = promotionQualification.status || 'not_applied';
  const promotionDisabled = user?.referralSharingEnabled === false || promotionStatus === 'disabled';
  const referralSharingEnabled = promotionStatus === 'granted' && user?.referralSharingEnabled !== false && workspace.profile?.referralSharingEnabled !== false;
  const referralLink = referralSharingEnabled && origin && workspace.referralPath ? `${origin}${workspace.referralPath}` : '';
  const metricValue = (label: string) => workspace.metrics?.find((item) => item.label === label)?.value || '0';
  const brandAccess = !brandApplication
    ? { label: '申请品牌入驻', status: '未申请', href: '/cn/brand/apply' }
    : brandApplication.status === 'approved'
      ? { label: '我的品牌', status: `${brandApplication.brandName} · 已开通`, href: '/vendor' }
      : brandApplication.status === 'rejected'
        ? { label: '补充品牌申请', status: `${brandApplication.brandName} · 待补件`, href: '/cn/brand/apply' }
        : { label: '品牌申请进度', status: `${brandApplication.brandName} · 审核中`, href: '/cn/brand/apply' };
  const selectedRows = engagementMembers.filter((row) => selectedReferralMembers.includes(Number(row.id)));
  const previewText = (template: ReferralTemplate, recipient: WorkspaceRow) => {
    if (template === 'appointment') return recipient.appointmentPreview || `Hi ${recipient.name}，你还没有完成门店预约。我在富智慧帮你留意了入口，回来后可以继续预约体验。`;
    return recipient.winbackPreview || `Hi ${recipient.name}，转发给朋友前，先生成你的专属二维码，朋友扫码关注就记在你名下。`;
  };

  const copyReferralLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const applyPromotionQualification = async () => {
    setPromotionApplying(true);
    setActionMessage('');
    try {
      const response = await fetch('/api/cn/referral-promotion', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '推广资格开通失败');
      if (data.workspace) {
        setWorkspace(data.workspace);
      } else {
        await loadMemberWorkspace(referralRange);
      }
      setActionMessage(data.idempotent ? '推广资格已开通' : '推广资格已自动开通');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '推广资格开通失败');
    } finally {
      setPromotionApplying(false);
    }
  };

  const reloadEngagement = async () => {
    const response = await fetch(`/api/cn/referral-engagement?range=${referralRange}`);
    const data = await response.json();
    if (!response.ok) return setActionMessage(data.error || '刷新失败');
    setWorkspace((current) => ({ ...current, referralEngagement: data, appointments: data.details?.appointments || current.appointments }));
    setActionMessage('推荐数据已刷新');
  };

  const toggleSelectedMember = (id: number) => {
    setSelectedReferralMembers((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const openReminderPreview = (template: ReferralTemplate) => {
    const sourceRows = selectedRows.length ? selectedRows : filteredEngagementMembers;
    const eligible = sourceRows.filter((row) => template === 'winback' ? ['cooling', 'sleeping', 'pending_start'].includes(String(row.activityKey)) : row.canRemindAppointment === true);
    const recipients = eligible.slice(0, 20);
    if (!recipients.length) return setActionMessage(template === 'appointment' ? '请选择未预约或预约未完成的成员' : '请选择待启动、降温或沉睡成员');
    setPreview({ template, recipients });
    setActionMessage(eligible.length > 20 ? '单次最多提醒 20 人，本次已带入前 20 人' : '');
  };

  const sendReminder = async () => {
    if (!preview) return;
    setSending(true);
    try {
      const response = await fetch('/api/cn/referral-engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: preview.template, recipientIds: preview.recipients.map((row) => row.id) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '发送失败');
      const sentRows: Array<{ channel?: string }> = data.sent || [];
      const wechatCount = sentRows.filter((row) => String(row.channel || '').includes('服务号')).length;
      setActionMessage(`已写入 ${sentRows.length} 条站内通知${wechatCount ? `，其中 ${wechatCount} 人同时收到服务号消息` : ''}`);
      setPreview(null);
      await reloadEngagement();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const markNotificationRead = async (id: string) => {
    const response = await fetch('/api/cn/member-notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (!response.ok) return;
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
  };

  const saveMemberNickname = async () => {
    const nickname = memberNameInput.trim();
    if (!nickname) return;
    setMemberNameSaving(true);
    try {
      const response = await fetch('/api/auth/wechat/quick-login', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '昵称更新失败');
      if (data.user) login(data.user);
      setWorkspace((current) => ({ ...current, profile: { ...(current.profile || {}), name: nickname } }));
      setEditingMemberName(false);
      setActionMessage('微信昵称已同步更新');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : '昵称更新失败');
    } finally {
      setMemberNameSaving(false);
    }
  };

  const savePilotNickname = async () => {
    const nickname = nicknameDraft.trim();
    if (!nickname) return setNicknameMessage('请填写昵称');
    setNicknameSaving(true);
    setNicknameMessage('');
    try {
      const response = await fetch('/api/auth/brand-pilot-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_nickname', nickname }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '更新失败');
      if (data.user) login(data.user);
      setPilotIdentity(data.pilotIdentity || null);
      setWorkspace((current) => ({ ...current, profile: { ...(current.profile || {}), name: nickname } }));
      setNicknameMessage('昵称已更新');
    } catch (error) {
      setNicknameMessage(error instanceof Error ? error.message : '更新失败');
    } finally {
      setNicknameSaving(false);
    }
  };

  const deleteHealthRecord = async (id: string) => {
    if (!window.confirm('确认删除这笔健康记录并撤回该笔资料授权？')) return;
    const response = await fetch(`/api/cn/member-health?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) return window.alert((await response.json()).error || '删除失败');
    setWorkspace((current) => ({ ...current, health: (current.health || []).filter((row) => String(row.id) !== id) }));
  };

  const exportMemberReport = () => downloadCsv(`richsmart-member-${selectedMonth}.csv`, [
    ...referralRows.map((row) => ({
      月份: selectedMonth,
      类型: '推荐成员',
      名称: row.name,
      状态: row.relation,
      金额: row.amount || '¥0.00',
      收益: row.reward || '¥0.00',
    })),
    ...orderRows.map((row) => ({
      月份: selectedMonth,
      类型: '我的订单',
      名称: row.product,
      状态: row.status,
      金额: row.amount || '¥0.00',
      收益: row.reward || '¥0.00',
    })),
  ]);

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f4ec] px-4">
        <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-2xl font-black text-stone-950">会员中心</h1>
          <Link href="/cn/login?next=%2Fcn%2Fmember" className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-teal-700 px-5 py-3 font-bold text-white">
            前往登录
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 pb-24 pt-6 md:pb-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-4 border-b border-stone-200 pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            {editingMemberName ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={memberNameInput}
                  onChange={(e) => setMemberNameInput(e.target.value.slice(0, 60))}
                  placeholder="请输入您的微信昵称或会员名称"
                  className="rounded-lg border border-teal-600 bg-white px-3 py-1.5 text-lg font-black text-stone-950 outline-none"
                />
                <button
                  type="button"
                  onClick={saveMemberNickname}
                  disabled={memberNameSaving || !memberNameInput.trim()}
                  className="rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-teal-800 disabled:opacity-50"
                >
                  {memberNameSaving ? '保存中...' : '保存昵称'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingMemberName(false)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-bold text-stone-600"
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-3xl font-black text-stone-950">{workspace.profile?.name || user.name || '会员'}</h1>
                <button
                  type="button"
                  onClick={() => {
                    const currentName = String(workspace.profile?.name || user.name || '');
                    setMemberNameInput(currentName.startsWith('微信会员') ? '' : currentName);
                    setEditingMemberName(true);
                  }}
                  className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-bold text-teal-800 hover:bg-teal-100"
                >
                  {String(workspace.profile?.name || user.name || '').startsWith('微信会员') ? '同步/修改微信昵称' : '修改昵称'}
                </button>
              </div>
            )}
            <p className="mt-1 text-sm font-semibold text-stone-500">{workspace.profile?.role || '会员'}</p>
            {(workspace.referralCode || user.referralCode) ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-stone-500">
                <span className="inline-flex items-center gap-1.5">
                  我的推荐码：<span className="font-black text-stone-900">{workspace.referralCode || user.referralCode}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(String(workspace.referralCode || user.referralCode));
                        setOwnCodeCopied(true);
                        setTimeout(() => setOwnCodeCopied(false), 2000);
                      } catch {
                        // ignore
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[11px] font-bold text-teal-800"
                  >
                    <Copy className="h-3 w-3" />
                    {ownCodeCopied ? '已复制' : '复制'}
                  </button>
                </span>
                {workspace.referralRelation?.referrerName ? (
                  <span>归属推荐人：<span className="font-black text-stone-900">{String(workspace.referralRelation.referrerName)}</span></span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-2">
            <Link href="/cn/member/share" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#07C160] px-4 py-3.5 text-base font-bold text-white hover:bg-[#06ad56] md:rounded-lg md:py-2 md:text-sm">
              <QrCode className="h-4 w-4" />
              推广工作台
            </Link>
            {workspace.referralCode ? (
              <Link href="/cn/member/follow-qr" className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#07C160] bg-white px-4 py-3.5 text-base font-bold text-[#07C160] hover:bg-emerald-50 md:rounded-lg md:py-2 md:text-sm">
                <QrCode className="h-4 w-4" />
                生成我的专属关注码
              </Link>
            ) : null}
            <Link href="/cn/orders" className="inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3.5 text-base font-bold text-stone-800 md:rounded-lg md:py-2 md:text-sm">
              <ClipboardList className="h-4 w-4" />
              我的订单
            </Link>
            {/* 桌面版没有底部导航（ChinaMobileTabBar 仅手机显示），补回首页／商城入口；手机端不显示 */}
            <Link href="/cn/home" className="hidden items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-800 md:inline-flex">
              <Home className="h-4 w-4" />
              首页
            </Link>
            <Link href="/cn/shop" className="hidden items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-800 md:inline-flex">
              <ShoppingBag className="h-4 w-4" />
              商城
            </Link>
            {user.platformAdmin ? (
              <Link href="/cn/ops" className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-stone-950 px-4 py-2 text-sm font-bold text-white">
                <ShieldCheck className="h-4 w-4" />
                平台后台
              </Link>
            ) : null}
          </div>
        </header>

        <div className="mt-6 flex items-center justify-end gap-2">
          <select
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-bold text-stone-700"
          >
            {monthOptions.map((month) => <option key={month}>{month}</option>)}
          </select>
          <button
            type="button"
            onClick={exportMemberReport}
            className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs font-bold text-stone-700"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
        </div>
        <section className="mt-2 grid gap-3 md:grid-cols-4">
          <Link href="/cn/member/wallet" className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500">
            <div className="text-sm font-bold text-stone-500">可提现收益</div>
            <div className="mt-2 flex items-center justify-between"><div className="text-2xl font-black text-teal-700">{metricValue('可提现收益')}</div><WalletCards className="h-5 w-5 text-teal-700" /></div>
          </Link>
          <a href="#member-referrals" className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
            <div className="text-sm font-bold text-stone-500">直接推荐</div>
            <div className="mt-2 text-2xl font-black text-stone-950">{metricValue('直接推荐')} 人</div>
          </a>
          <a href="#member-orders" className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
            <div className="text-sm font-bold text-stone-500">推荐订单</div>
            <div className="mt-2 text-2xl font-black text-stone-950">{metricValue('推荐订单')} 笔</div>
          </a>
          <a href="#health-records" className="rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
            <div className="text-sm font-bold text-stone-500">健康推荐</div>
            <div className="mt-2 text-2xl font-black text-amber-700">{healthRows.length} 项</div>
          </a>
        </section>

        {pilotIdentity ? (
          <section className="mt-6 rounded-lg border border-teal-100 bg-white p-5">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="block min-w-0">
                <span className="text-sm font-black text-stone-700">品牌测试昵称</span>
                <input
                  value={nicknameDraft}
                  onChange={(event) => {
                    setNicknameDraft(event.target.value.slice(0, 80));
                    setNicknameMessage('');
                  }}
                  maxLength={80}
                  className="mt-2 w-full rounded-lg border border-stone-200 px-4 py-3 font-bold text-stone-950 outline-none focus:border-teal-600"
                />
              </label>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button type="button" onClick={savePilotNickname} disabled={nicknameSaving || !nicknameDraft.trim()} className="rounded-lg bg-teal-700 px-5 py-3 font-black text-white disabled:opacity-50">
                  {nicknameSaving ? '保存中' : '保存昵称'}
                </button>
                {workspace.profile?.wechatBound === true ? (
                  <span className="inline-flex items-center gap-2 rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 font-bold text-teal-800">
                    <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    已绑定微信
                  </span>
                ) : wechatBindingConfigured && workspace.profile?.wechatBound === false ? (
                  <a href="/api/auth/wechat/start?bind=1&returnTo=%2Fcn%2Fmember" className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-3 font-bold text-stone-800 transition hover:border-teal-500 hover:bg-teal-50">
                    <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    绑定微信
                  </a>
                ) : (
                  <button type="button" disabled className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 font-bold text-stone-500">
                    <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    微信绑定建置中
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 break-words text-xs font-bold text-stone-500">memberId {pilotIdentity.memberId || user.id} · {pilotIdentity.status || 'active'} · {pilotIdentity.createdAt || ''}</div>
            {nicknameMessage ? <div className="mt-2 text-sm font-bold text-teal-800">{nicknameMessage}</div> : null}
          </section>
        ) : null}

        <StoreOwnerNotifyCard />

        <section className="mt-6">
          <h2 className="text-lg font-black text-stone-950">经营功能</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Link href={brandAccess.href} className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><Building2 className="h-5 w-5" /></span>
                <div className="min-w-0"><div className="font-black text-stone-950">{brandAccess.label}</div><div className="mt-1 truncate text-xs font-bold text-stone-500">{brandAccess.status}</div></div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-stone-400" />
            </Link>
            <Link href="/vendor/products/new" className="flex items-center justify-between gap-4 rounded-lg border border-teal-200 bg-gradient-to-r from-teal-50 to-white p-4 transition hover:border-teal-600">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-white"><Sparkles className="h-5 w-5" /></span>
                <div className="min-w-0"><div className="font-black text-stone-950">✨ AI 一句话上架商品</div><div className="mt-1 truncate text-xs font-bold text-teal-800">Agent 大脑 · 3秒生商品+对话式改价改文</div></div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-teal-700" />
            </Link>
            <Link href="/vendor/page-builder" className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Sparkles className="h-5 w-5" /></span>
                <div className="min-w-0"><div className="font-black text-stone-950">AI 品牌馆设计器</div><div className="mt-1 truncate text-xs font-bold text-stone-500">一句话生成品牌旗舰落地页</div></div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-stone-400" />
            </Link>
            <a href="#store-applications" className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-4 transition hover:border-teal-500 hover:bg-teal-50">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><ShoppingBag className="h-5 w-5" /></span>
                <div><div className="font-black text-stone-950">我的门店</div><div className="mt-1 truncate text-xs font-bold text-stone-500">门店入驻与核销管理</div></div>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-stone-400" />
            </a>
          </div>
        </section>

        <MemberStoreApplications userId={user.id} />

        {notifications.length ? (
          <section className="mt-6 rounded-lg border border-teal-100 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-teal-700" />
                <h2 className="text-lg font-black text-stone-950">我的通知</h2>
              </div>
              <span className="text-xs font-black text-teal-700">{notifications.filter((item) => !item.readAt).length} 条未读</span>
            </div>
            <div className="divide-y divide-stone-100">
              {notifications.slice(0, 3).map((item) => (
                <div key={item.id} role="button" tabIndex={0} onClick={() => markNotificationRead(item.id)} onKeyDown={(event) => { if (event.key === 'Enter') markNotificationRead(item.id); }} className="block w-full cursor-pointer px-5 py-4 text-left transition hover:bg-teal-50">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-black text-stone-950">{item.title}</div>
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.readAt ? 'bg-stone-100 text-stone-500' : 'bg-teal-50 text-teal-700'}`}>{item.readAt ? '已读' : '未读'}</span>
                  </div>
                  <div className="mt-1 text-sm font-semibold leading-6 text-stone-600">{item.message}</div>
                  {item.imageUrl || item.linkUrl ? (
                    <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
                      {item.imageUrl ? <img src={item.imageUrl} alt="" className="aspect-[900/383] w-full object-cover" loading="lazy" /> : null}
                      {item.linkUrl ? (
                        <a
                          href={item.linkUrl}
                          onClick={(event) => { event.stopPropagation(); markNotificationRead(item.id); }}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm font-black text-teal-800"
                        >
                          查看详情
                          <ArrowRight className="h-4 w-4" />
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
          {referralSharingEnabled ? (
            <div id="health-records" className="scroll-mt-4 rounded-lg border border-stone-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <QrCode className="h-5 w-5 text-teal-700" />
                  <h2 className="text-lg font-black text-stone-950">分享专属链接</h2>
                </div>
                <Link
                  href="/cn/member/share"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800"
                >
                  推广工作台与海报中心 →
                </Link>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[190px_1fr]">
                <ReferralQrCode value={referralLink} />
                <div>
                  <div className="rounded-lg bg-teal-50 px-4 py-3">
                    <div className="text-xs font-bold text-teal-700">自动绑定</div>
                    <div className="mt-1 text-base font-black leading-6 text-stone-950">这是您的专属链接，复制后即可分享。</div>
                  </div>
                  {origin && (workspace.referralCode || user?.referralCode) ? (
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
                      <div className="text-xs font-black text-emerald-900">全能对外主入口短链（推荐直接发给客户/代理/品牌方）</div>
                      <div className="mt-1 break-all font-mono text-xs font-bold text-emerald-950">
                        {`${origin}/cn?ref=${workspace.referralCode || user?.referralCode}`}
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await navigator.clipboard.writeText(`${origin}/cn?ref=${workspace.referralCode || user?.referralCode}`);
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1600);
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#07C160] px-3.5 py-2 text-xs font-black text-white hover:bg-[#06ad56]"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copied ? '已复制主入口链接' : '一键复制主入口短链'}
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-3 break-all rounded-lg border border-stone-200 bg-stone-50 px-4 py-2.5 text-xs font-semibold text-stone-600">
                    加密防伪追踪链：{referralLink}
                  </div>
                  <button
                    type="button"
                    onClick={copyReferralLink}
                    className="mt-2 inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-bold text-stone-800 hover:bg-stone-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? '已复制' : '复制加密防伪链接'}
                  </button>
                  <div className="mt-2 text-xs font-bold leading-5 text-stone-500">转发别人的链接不会算您的直接推广。</div>
                  {workspace.referralRelation?.referrerName ? (
                    <div className="mt-3 rounded-lg border border-stone-200 px-4 py-3 text-sm font-semibold leading-6 text-stone-600">
                      我的直接推荐人：<span className="font-black text-stone-900">{String(workspace.referralRelation.referrerName)}</span>
                      {workspace.referralRelation.boundAt ? <span> · 建立于 {String(workspace.referralRelation.boundAt).slice(0, 10)}</span> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div id="health-records" className="scroll-mt-4 rounded-lg border border-stone-200 bg-white p-5">
              <div className="flex items-center gap-2">
                {promotionDisabled ? <ShieldCheck className="h-5 w-5 text-teal-700" /> : <Sparkles className="h-5 w-5 text-teal-700" />}
                <h2 className="text-lg font-black text-stone-950">{promotionDisabled ? '推广资格未开放' : '申请推广资格'}</h2>
              </div>
              {promotionDisabled ? (
                <p className="mt-4 text-sm font-semibold leading-7 text-stone-600">此账号目前未开放推广分享。平台新建立的品牌邀请统一归属 Scoot。</p>
              ) : (
                <>
                  <p className="mt-4 text-sm font-semibold leading-7 text-stone-600">申请后立即开通您的专属推广链接。</p>
                  <button
                    type="button"
                    onClick={applyPromotionQualification}
                    disabled={promotionApplying}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {promotionApplying ? '开通中' : '申请推广'}
                  </button>
                </>
              )}
              {workspace.referralRelation?.referrerName ? (
                <div className="mt-4 rounded-lg border border-stone-200 px-4 py-3 text-sm font-semibold leading-6 text-stone-600">
                  我的直接推荐人：<span className="font-black text-stone-900">{String(workspace.referralRelation.referrerName)}</span>
                  {workspace.referralRelation.boundAt ? <span> · 建立于 {String(workspace.referralRelation.boundAt).slice(0, 10)}</span> : null}
                </div>
              ) : null}
            </div>
          )}

          <div className="rounded-lg border border-stone-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <HeartPulse className="h-5 w-5 text-red-600" />
              <h2 className="text-lg font-black text-stone-950">最近健康记录</h2>
            </div>
            <div className="mt-4 grid gap-3">
              {healthRows.length ? healthRows.map((row) => (
                <div key={row.id || row.label} className={`flex items-center justify-between gap-3 rounded-lg border p-4 ${row.recommendationBlocked ? 'border-red-200 bg-red-50' : 'border-stone-200'}`}>
                  <div>
                    <div className="font-black text-stone-950">{row.label}：{row.value}</div>
                    <div className="mt-1 text-sm font-semibold text-stone-500">{row.advice}</div>
                    {row.followUp30At || row.followUp90At ? <div className="mt-2 text-xs font-bold text-stone-500">30 天回访 {String(row.followUp30At || '').slice(0, 10)} · 90 天回访 {String(row.followUp90At || '').slice(0, 10)}</div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {row.href ? <Link href={row.href} aria-label="查看推荐商品" className="flex h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white"><ArrowRight className="h-5 w-5 text-stone-500" /></Link> : null}
                    {row.id ? <button type="button" aria-label="删除健康记录" onClick={() => deleteHealthRecord(String(row.id))} className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-white text-red-700"><Trash2 className="h-4 w-4" /></button> : null}
                  </div>
                </div>
              )) : <div className="rounded-lg bg-stone-50 p-5 text-sm font-semibold text-stone-500">目前没有健康推荐记录</div>}
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-teal-700" />
              <h2 className="text-lg font-black text-stone-950">推荐码成效</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={referralRange} onChange={(event) => setReferralRange(event.target.value as ReferralRange)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-800">
                <option value="7d">近 7 天</option>
                <option value="30d">近 30 天</option>
                <option value="90d">近 90 天</option>
                <option value="month">本月</option>
              </select>
              <button type="button" onClick={reloadEngagement} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-800">
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-stone-100 md:grid-cols-4">
            {[
              ['visits', '访问', engagement.metrics?.visits ?? 0, '真实访问事件'],
              ['visits', '唯一访客', engagement.metrics?.uniqueVisitors ?? 0, '匿名 session 去重'],
              ['orders', '下单率', engagement.metrics?.orderRate ?? '0%', engagement.metrics?.orderRateBasis || '有效推荐订单人数 / 唯一访客'],
              ['appointments', '预约率', engagement.metrics?.appointmentRate ?? '0%', engagement.metrics?.appointmentRateBasis || '推荐预约人数 / 唯一访客'],
            ].map(([key, label, value, helper]) => (
              <button key={`${label}`} type="button" onClick={() => setDetailKey(key as typeof detailKey)} className="bg-white p-4 text-left transition hover:bg-teal-50">
                <div className="text-xs font-black text-stone-500">{label}</div>
                <div className="mt-2 text-2xl font-black text-stone-950">{String(value)}</div>
                <div className="mt-1 text-xs font-bold leading-5 text-stone-500">{String(helper)}</div>
              </button>
            ))}
          </div>
          <div className="border-t border-stone-100 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black text-stone-950">明细 · {detailKey === 'visits' ? '访问' : detailKey === 'orders' ? '订单' : detailKey === 'appointments' ? '预约' : '注册'}</div>
              <button type="button" onClick={() => setDetailKey(detailKey === 'visits' ? 'orders' : detailKey === 'orders' ? 'appointments' : detailKey === 'appointments' ? 'registrations' : 'visits')} className="text-xs font-black text-teal-700">切换明细</button>
            </div>
            <div className="mt-3 grid gap-2">
              {(engagement.details?.[detailKey] || []).slice(0, 6).map((row) => (
                <div key={row.id || row.orderNo || row.createdAt} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-3 text-sm">
                  <span className="font-black text-stone-800">{row.orderNo || row.name || row.sourcePath || row.id}</span>
                  <span className="font-bold text-stone-500">{row.totalAmount || row.status || String(row.createdAt || row.paidAt || row.time || '').slice(0, 16)}</span>
                </div>
              ))}
              {!(engagement.details?.[detailKey] || []).length ? <div className="rounded-lg bg-stone-50 p-4 text-sm font-semibold text-stone-500">这个筛选范围内暂无明细</div> : null}
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-teal-700" />
                <h2 className="text-lg font-black text-stone-950">推荐成员活跃度</h2>
              </div>
              <div className="mt-1 text-xs font-bold text-stone-500">口径：7 天内活跃，8-30 天降温，超过 30 天沉睡；从未完成订单/预约为待启动。</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={referralFilter} onChange={(event) => setReferralFilter(event.target.value)} className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-800">
                <option value="all">全部状态</option>
                <option value="active">活跃</option>
                <option value="cooling">降温</option>
                <option value="sleeping">沉睡</option>
                <option value="pending_start">待启动</option>
              </select>
              <button type="button" onClick={() => openReminderPreview('winback')} className="inline-flex items-center gap-2 rounded-lg bg-stone-950 px-3 py-2 text-sm font-bold text-white">
                <Send className="h-4 w-4" />
                一键唤醒
              </button>
              <button type="button" onClick={() => openReminderPreview('appointment')} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-800">
                <CalendarPlus className="h-4 w-4" />
                预约提醒
              </button>
            </div>
          </div>
          {actionMessage ? <div className="mx-5 mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{actionMessage}</div> : null}
          <div className="divide-y divide-stone-100">
            {loading ? <div className="px-5 py-8 text-sm text-stone-500">读取会员资料中...</div> : filteredEngagementMembers.length ? filteredEngagementMembers.map((row) => {
              const id = Number(row.id);
              const selected = selectedReferralMembers.includes(id);
              return (
                <div key={row.id} className="grid gap-3 px-5 py-4 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <label className="flex items-center gap-3">
                    <input type="checkbox" checked={selected} onChange={() => toggleSelectedMember(id)} className="h-5 w-5 accent-teal-700" />
                    <span className={`rounded-full px-2 py-1 text-xs font-black ${row.activityKey === 'active' ? 'bg-emerald-50 text-emerald-700' : row.activityKey === 'cooling' ? 'bg-amber-50 text-amber-700' : row.activityKey === 'sleeping' ? 'bg-red-50 text-red-700' : 'bg-stone-100 text-stone-700'}`}>{row.activityLabel}</span>
                  </label>
                  <div className="min-w-0">
                    <div className="truncate font-black text-stone-950">{row.name} <span className="text-xs text-stone-500">memberId {row.memberId}</span></div>
                    <div className="mt-1 text-xs font-semibold leading-5 text-stone-500">加入 {String(row.joinedAt || '').slice(0, 10)} · 最近活动 {row.lastActivityAt ? String(row.lastActivityAt).slice(0, 10) : '无'} · 最近下单 {row.lastOrderAt ? String(row.lastOrderAt).slice(0, 10) : '无'}</div>
                    <div className="mt-1 text-xs font-bold text-stone-600">预约：{row.appointmentStatus} · 下一步：{row.nextAction}</div>
                  </div>
                  <div className="text-left md:text-right">
                    <div className="font-black text-stone-950">{row.contributionAmount}</div>
                    <div className="mt-1 text-xs font-bold text-teal-700">收益 {row.rewardAmount}</div>
                  </div>
                </div>
              );
            }) : <div className="px-5 py-8 text-sm font-semibold text-stone-500">尚无符合条件的直接推荐成员</div>}
          </div>
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div id="member-referrals" className="scroll-mt-4 rounded-lg border border-stone-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
              <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-teal-700" />
              <h2 className="text-lg font-black text-stone-950">推荐成员</h2>
              </div>
              <span className="text-sm font-black text-teal-700">全部 {referralRows.length} 人</span>
            </div>
            <div className="divide-y divide-stone-100">
              {loading ? <div className="px-5 py-8 text-sm text-stone-500">读取会员资料中...</div> : referralRows.length ? referralRows.map((row) => (
                <div key={row.name} className="flex items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="font-black text-stone-950">{row.name}</div>
                    <div className="mt-1 text-xs font-semibold text-stone-500">{row.relation} · {row.joinedAt} · {row.orders} 笔订单</div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-stone-950">{row.amount || '¥0.00'}</div>
                    <div className="mt-1 text-xs font-bold text-teal-700">收益 {row.reward || '¥0.00'} · {row.rewardStatus}</div>
                  </div>
                </div>
              )) : <div className="px-5 py-8 text-sm font-semibold text-stone-500">尚无推荐成员</div>}
            </div>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
              <div className="flex items-center gap-2">
              <BadgeDollarSign className="h-5 w-5 text-teal-700" />
              <h2 className="text-lg font-black text-stone-950">收益记录</h2>
              </div>
              <Link href="/cn/member/wallet" className="text-sm font-black text-teal-700">查看全部</Link>
            </div>
            <div className="grid gap-3 p-5">
              {commissionRows.length ? commissionRows.map((item) => {
                const Icon = item.type?.includes('二层') ? LinkIcon : item.type?.includes('积分') ? Sparkles : TrendingUp;
                return (
                  <Link href={item.entryId ? `/cn/member/wallet/${encodeURIComponent(item.entryId)}` : '/cn/member/wallet'} key={item.id || item.type} className="flex items-center justify-between rounded-lg bg-stone-50 p-4 transition hover:bg-teal-50">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-teal-700">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="font-black text-stone-950">{item.type}</div>
                        <div className="mt-1 text-xs font-bold text-stone-500">{item.status}</div>
                      </div>
                    </div>
                    <div className="font-black text-teal-700">{item.amount}</div>
                  </Link>
                );
              }) : <div className="rounded-lg bg-stone-50 p-5 text-sm font-semibold text-stone-500">尚无分润记录</div>}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-2">
          <div id="member-orders" className="scroll-mt-4 rounded-lg border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-5 py-4"><h2 className="text-lg font-black text-stone-950">推荐产生的预约</h2></div>
            <div className="divide-y divide-stone-100">{appointmentRows.length ? appointmentRows.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-4"><div><div className="font-black text-stone-950">{row.name}</div><div className="mt-1 text-xs font-semibold text-stone-500">{row.store} · {row.time} · 推荐码 {row.source}</div></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{row.status}</span></div>) : <div className="px-5 py-8 text-sm font-semibold text-stone-500">尚无推荐预约</div>}</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white">
            <div className="border-b border-stone-100 px-5 py-4"><h2 className="text-lg font-black text-stone-950">推荐产生的订单</h2></div>
            <div className="divide-y divide-stone-100">{recommendedOrders.length ? recommendedOrders.map((row) => <Link href={`/cn/orders/${encodeURIComponent(row.id)}`} key={row.id} className="block px-5 py-4 transition hover:bg-teal-50"><div className="flex justify-between gap-4"><div className="font-black text-stone-950">{row.id}</div><span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">{row.status}</span></div><div className="mt-2 flex justify-between text-sm text-stone-600"><span>{row.buyer} · {row.product}</span><span>{row.amount}</span></div><div className="mt-2 text-xs font-bold text-teal-700">分润 {row.reward} · {row.rewardStatus}</div></Link>) : <div className="px-5 py-8 text-sm font-semibold text-stone-500">尚无推荐订单</div>}</div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-4">
            <ClipboardList className="h-5 w-5 text-teal-700" />
            <h2 className="text-lg font-black text-stone-950">我的购买记录</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                <tr>
                  <th className="px-5 py-3">订单</th>
                  <th className="px-4 py-3">商品</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3 text-right">金额</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {orderRows.length ? orderRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-4 font-black text-stone-950">{row.id}</td>
                    <td className="px-4 py-4 text-stone-700">{row.product}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right font-black text-stone-950">{row.amount}</td>
                    <td className="px-4 py-4 text-right">
                      <Link href={`/cn/orders/${encodeURIComponent(row.id)}`} className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-stone-800">
                        查看
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                )) : <tr><td colSpan={5} className="px-5 py-8 text-center text-sm font-semibold text-stone-500">尚无购买记录</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <div className="mt-10 flex items-center justify-center gap-4 text-xs font-semibold text-stone-400">
          <Link href="/cn/login?switch=1" className="hover:text-stone-600">切换账号</Link>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={async () => {
              await logout();
              window.location.href = '/cn/login';
            }}
            className="hover:text-stone-600"
          >
            退出
          </button>
        </div>
      </div>
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-end bg-stone-950/40 p-3 md:items-center md:justify-center">
          <section className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="border-b border-stone-100 px-5 py-4">
              <h2 className="text-lg font-black text-stone-950">{preview.template === 'appointment' ? '确认发送预约提醒' : '确认发送回流唤醒'}</h2>
              {(() => {
                const wechatCount = preview.recipients.filter((row) => row.hasWechat === true).length;
                const wakeup = engagement.wakeup || {};
                return (
                  <>
                    <p className="mt-1 text-xs font-bold leading-5 text-stone-500">
                      渠道：站内通知（{preview.recipients.length} 人）
                      {wechatCount
                        ? ` + 服务号消息（已绑定服务号 ${wechatCount} 人，文字${wakeup.wechatMedia === 'article' ? ' + 图文' : wakeup.wechatMedia === 'image' ? ' + 图片' : wakeup.wechatMedia === 'news' ? ' + 封面链接卡片' : ''}）。对方超过 48 小时未与服务号互动时${wakeup.templateFallback ? '改发模板消息' : '服务号消息会失败，只保留站内通知并记录原因'}。`
                        : '。所选成员都未绑定服务号，本次只发站内通知。'}
                    </p>
                    {preview.template === 'winback' ? <p className="mt-2 text-xs font-bold leading-5 text-teal-800">素材按日期轮换（转发拉人 / 预约体验 / 体验点导航 / 健康好物 / 门店合作），同一人不会连续收到同一主题；店主偏合作与转发，沉睡会员偏预约与体验。</p> : null}
                    {preview.template === 'winback' ? null : (
                      <div className="mt-3 overflow-hidden rounded-lg border border-stone-200">
                        <img src="/images/mp/wakeup-appointment-cover.jpg" alt="通知封面预览" className="aspect-[900/383] w-full object-cover" />
                        <div className="px-3 py-2 text-xs font-bold text-stone-500">封面预览 · 链接：预约到店体验</div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
              <div className="text-sm font-black text-stone-950">收件对象 {preview.recipients.length} 人</div>
              <div className="mt-3 grid gap-2">
                {preview.recipients.map((row) => (
                  <div key={row.id} className="rounded-lg bg-stone-50 p-3">
                    <div className="font-black text-stone-950">{row.name} · memberId {row.memberId}{row.hasWechat === true ? ' · 服务号' : ''}</div>
                    {preview.template === 'winback' && row.winbackTheme?.coverUrl ? (
                      <div className="mt-2 overflow-hidden rounded-lg border border-stone-200 bg-white">
                        <img src={row.winbackTheme.coverUrl} alt="封面预览" className="aspect-[900/383] w-full object-cover" />
                        <div className="px-3 py-1.5 text-xs font-bold text-stone-500">今日主题：{row.winbackTheme.label} · 链接：{row.winbackTheme.linkTitle}</div>
                      </div>
                    ) : null}
                    <div className="mt-2 text-sm font-semibold leading-6 text-stone-600">{previewText(preview.template, row)}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-stone-100 px-5 py-4">
              <button type="button" onClick={() => setPreview(null)} className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-bold text-stone-800">取消</button>
              <button type="button" onClick={sendReminder} disabled={sending} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                <Send className="h-4 w-4" />
                {sending ? '发送中' : '确认发送'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <ChinaMobileTabBar active="member" />
    </main>
  );
}

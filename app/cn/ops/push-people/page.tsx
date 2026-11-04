'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';

type Notice = { id: string; at: string; targetLabel: string; event: string; city: string; phoneTail: string; memberId: number; role: string; channel: string; status: string; errcode?: string; ackAt?: string; escalatedAt?: string; test?: boolean; simulated?: boolean };
type Win = { open: boolean; label: string; lastInteractionAt: string | null };
type Data = {
  owners: Array<{ memberId: number; name: string; targets: Array<{ id: string; label: string; city: string; source: string }>; eligible: boolean; enabled: boolean; bound: boolean; window: Win; lastNotice: Notice | null }>;
  admins: Array<{ openidTail: string; name: string; window: Win; lastNotice: Notice | null }>;
  points: Array<{ id: string; city: string; label: string; ownerMemberIds: number[] }>;
  recent: Notice[];
  runs: Array<{ at: string; task: string; dryRun: boolean; summary: Record<string, number> }>;
};
type WecomRow = { memberId: number; name: string; role: string; bound: boolean; window: Win; wecomAdded: boolean; wecomAddedAt: string | null; lastInvite: { at: string; status: string } | null; inviteQr: string | null };
type Wecom = { configured: boolean; callbackConfigured: boolean; count: number; cap: number; unmatched: number; defaultQr: { qrCode: string; createdAt: string } | null; syncedAt: string | null; inviteText: string; rows: WecomRow[] };
type InviteResult = { memberId: number; name: string; status: string; label: string; qrCode?: string };
const INVITE_STATUS: Record<string, string> = { sent: '已发送', unreachable: '无法触达', failed: '失败', simulated: '模拟', already_added: '已加', cap_reached: '已达上限' };

const STATUS: Record<string, string> = { sent: '已送达', failed: '发送失败', simulated: '模拟', no_openid: '未绑定', not_enabled: '未开启', member_not_found: '会员不存在', pending: '发送中' };
const EVENT: Record<string, string> = { lead: '线索', appointment: '预约', test: '测试' };
const ROLE: Record<string, string> = { owner: '店主', copy: '抄送', fallback: '兜底', escalation: '未确认升级' };

function t(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
}

function noticeText(n: Notice | null) {
  if (!n) return '暂无';
  return `${t(n.at)} · ${EVENT[n.event] || n.event} · ${STATUS[n.status] || n.status}${n.errcode && n.errcode !== '0' ? `（${n.errcode}）` : ''} · ${n.channel}${n.ackAt ? ' · 已确认' : n.escalatedAt ? ' · 已升级曹总' : ''}`;
}

export default function PushPeoplePage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [wecom, setWecom] = useState<Wecom | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [inviting, setInviting] = useState(false);
  const [inviteResults, setInviteResults] = useState<InviteResult[] | null>(null);
  const [copied, setCopied] = useState('');
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [wecomBusy, setWecomBusy] = useState('');
  const [wecomMsg, setWecomMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [plan, setPlan] = useState<{ summary: Record<string, number>; plan: Array<{ memberId: number; name: string; tierLabel: string; action: string; reason: string; channel?: string }> } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/cn/ops/push-people', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) { setDenied(true); return; }
    if (!response.ok) { setError(body.error || '读取失败'); return; }
    setDenied(false);
    setError('');
    setData(body);
    setDrafts(Object.fromEntries((body.points || []).map((p: Data['points'][number]) => [p.id, p.ownerMemberIds.join(',')])));
  }, []);

  const loadWecom = useCallback(async () => {
    const response = await fetch('/api/cn/ops/wecom', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) { setDenied(true); return; }
    if (response.ok) setWecom(body);
    else setWecomMsg({ ok: false, text: body.error || '企业微信数据读取失败' });
  }, []);

  useEffect(() => { load(); loadWecom(); }, [load, loadWecom]);

  const refresh = async () => {
    setRefreshing(true);
    try { await Promise.all([load(), loadWecom()]); setRefreshedAt(new Date()); } finally { setRefreshing(false); }
  };

  const wecomOf = (memberId: number) => wecom?.rows.find((r) => r.memberId === memberId) || null;
  const toggle = (memberId: number) => setSelected((prev) => { const next = new Set(prev); if (next.has(memberId)) next.delete(memberId); else next.add(memberId); return next; });

  const wecomAction = async (action: 'sync' | 'default-qr') => {
    setWecomBusy(action);
    setWecomMsg(null);
    try {
      const response = await fetch('/api/cn/ops/wecom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) { setDenied(true); return; }
      if (!response.ok) setWecomMsg({ ok: false, text: body.error || '操作失败' });
      else {
        if (body.overview) setWecom(body.overview);
        setWecomMsg({ ok: true, text: action === 'sync' ? `已同步：已加客户 ${body.overview?.count ?? '—'} 人` : '默认二维码已生成' });
      }
    } catch {
      setWecomMsg({ ok: false, text: '网络异常，请稍后再试' });
    } finally {
      setWecomBusy('');
    }
  };

  const invite = async () => {
    const ids = Array.from(selected).filter((id) => !wecomOf(id)?.wecomAdded);
    if (!ids.length) { setError('请勾选尚未添加企业微信的会员'); return; }
    if (!window.confirm(`将向 ${ids.length} 位会员发送企业微信邀请（48 小时内互动过的会收到服务号消息），确认发送？`)) return;
    setInviting(true);
    try {
      const response = await fetch('/api/cn/ops/wecom', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invite', memberIds: ids }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error || '邀请失败');
      else { setError(''); setInviteResults(body.results || []); if (body.overview) setWecom(body.overview); setSelected(new Set()); }
    } finally {
      setInviting(false);
    }
  };

  const copy = async (key: string, value: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); } catch { window.prompt('复制以下内容', value); }
  };

  const wecomCell = (memberId: number) => {
    const w = wecomOf(memberId);
    if (!w) return <span className="text-stone-400">—</span>;
    return w.wecomAdded ? <span className="font-bold text-teal-700">已加</span> : <span className="text-stone-500">未加{w.lastInvite ? `（${INVITE_STATUS[w.lastInvite.status] || w.lastInvite.status} ${t(w.lastInvite.at)}）` : ''}</span>;
  };

  const savePoint = async (pointId: string) => {
    const ids = String(drafts[pointId] || '').split(/[,，\s]+/).map(Number).filter((n) => n > 0);
    const response = await fetch('/api/cn/ops/push-people', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pointId, ownerMemberIds: ids }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error || '保存失败');
    else load();
  };

  const dryRun = async () => {
    const response = await fetch('/api/cn/push-jobs?task=daily', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (response.ok) { setPlan(body); load(); } else setError(body.error || '试算失败');
  };

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 text-stone-950 md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/cn/ops" className="inline-flex items-center gap-1 text-sm font-black text-teal-800"><ArrowLeft className="h-4 w-4" />运营后台</Link>
            <h1 className="mt-2 text-2xl font-black">需要推送的人</h1>
            <p className="mt-1 text-sm font-semibold text-stone-500">店主／体验点负责人、服务号绑定、最近通知与送达结果、48 小时客服消息窗口</p>
          </div>
          <div className="flex items-center gap-2">
            {refreshedAt ? <span className="text-xs font-semibold text-stone-500" data-testid="refreshed-at">已刷新 {refreshedAt.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</span> : null}
            <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? '刷新中…' : '刷新'}</button>
          </div>
        </div>

        {denied ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" data-testid="push-denied">
            <div className="font-black text-amber-900">当前登录身份没有平台管理员权限，以下数据和按钮无法使用。</div>
            <p className="mt-1 font-semibold text-amber-800">请在微信内点「以管理员身份进入」，或用管理员账号登录后再打开本页。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="/api/auth/wechat/kefu-admin?next=%2Fcn%2Fops%2Fpush-people" className="rounded-lg bg-teal-700 px-3 py-2 font-bold text-white">以管理员身份进入</a>
              <a href="/login?mode=admin&next=%2Fcn%2Fops%2Fpush-people" className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-bold">管理员登录</a>
            </div>
          </div>
        ) : null}
        {denied ? null : <>
        {error ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

        <section className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white" data-testid="push-owners">
          <h2 className="border-b border-stone-100 px-4 py-3 font-black">店主／体验点负责人（{data?.owners.length ?? 0}）</h2>
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500"><tr><th className="px-2 py-2"><span className="sr-only">选择</span></th><th className="px-4 py-2">会员</th><th className="px-4 py-2">负责</th><th className="px-4 py-2">通知</th><th className="px-4 py-2">服务号</th><th className="px-4 py-2">48 小时窗口</th><th className="px-4 py-2">企业微信</th><th className="px-4 py-2">最近通知</th></tr></thead>
            <tbody>
              {(data?.owners || []).map((o) => (
                <tr key={o.memberId} className="border-t border-stone-100">
                  <td className="px-2 py-2"><input type="checkbox" aria-label={`选择 ${o.name}`} checked={selected.has(o.memberId)} disabled={Boolean(wecomOf(o.memberId)?.wecomAdded)} onChange={() => toggle(o.memberId)} /></td>
                  <td className="px-4 py-2 font-bold">{o.name}<div className="text-xs text-stone-400">ID {o.memberId}</div></td>
                  <td className="px-4 py-2">{o.targets.map((x) => `${x.label}（${x.city || '城市待补'}·${x.source}）`).join('、') || '—'}</td>
                  <td className="px-4 py-2">{o.enabled ? <span className="font-bold text-teal-700">已开启</span> : <span className="text-stone-500">未开启</span>}</td>
                  <td className="px-4 py-2">{o.bound ? '已绑定' : <span className="font-bold text-amber-700">未绑定</span>}</td>
                  <td className="px-4 py-2">{o.window.open ? <span className="text-teal-700">{o.window.label}</span> : <span className="text-stone-500">{o.window.label}</span>}</td>
                  <td className="px-4 py-2">{wecomCell(o.memberId)}</td>
                  <td className="px-4 py-2 text-xs">{noticeText(o.lastNotice)}</td>
                </tr>
              ))}
              {data && !data.owners.length ? <tr><td colSpan={8} className="px-4 py-4 text-stone-500">暂无店主。可在下方为体验点指定负责人会员 ID，或等门店申请开通后自动列入。</td></tr> : null}
            </tbody>
          </table>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white" data-testid="wecom-section">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-100 px-4 py-3">
            <div>
              <h2 className="font-black">企业微信客户联系</h2>
              <p className="mt-1 text-sm font-semibold text-stone-500">
                已加客户 <span data-testid="wecom-count" className={wecom && wecom.count >= wecom.cap ? 'text-red-700' : 'text-teal-800'}>{wecom ? `${wecom.count}/${wecom.cap}` : '—'}</span>（企业未认证上限 {wecom?.cap ?? 100} 人）{wecom?.unmatched ? ` · 未对应会员 ${wecom.unmatched}` : ''} · 回调{wecom?.callbackConfigured ? '已配置' : '未配置'} · 最近同步 {t(wecom?.syncedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => wecomAction('sync')} disabled={Boolean(wecomBusy)} className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-bold disabled:opacity-60">{wecomBusy === 'sync' ? '同步中…' : '同步客户数'}</button>
              <button type="button" onClick={invite} disabled={inviting || !selected.size} data-testid="wecom-invite" className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">{inviting ? '发送中…' : `邀请加企业微信${selected.size ? `（${selected.size}）` : ''}`}</button>
            </div>
          </div>
          {wecomMsg ? <div data-testid="wecom-msg" className={`mx-4 mt-3 rounded-lg p-2 text-sm font-bold ${wecomMsg.ok ? 'bg-teal-50 text-teal-800' : 'bg-red-50 text-red-700'}`}>{wecomMsg.text}</div> : null}
          <div className="grid gap-4 p-4 md:grid-cols-[200px_1fr]">
            <div className="text-center">
              {wecom?.defaultQr ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/api/cn/ops/wecom/qr?inline=1" alt="企业微信默认二维码" className="mx-auto h-44 w-44 rounded border border-stone-200 object-contain" />
                  <div className="mt-1 text-xs text-stone-500">默认「联系我」二维码</div>
                  <a href="/api/cn/ops/wecom/qr" className="mt-2 inline-block rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-bold text-teal-800">下载二维码</a>
                </>
              ) : (
                <button type="button" onClick={() => wecomAction('default-qr')} disabled={Boolean(wecomBusy) || !wecom} className="mt-8 rounded-lg border border-teal-600 px-3 py-2 text-sm font-bold text-teal-800 disabled:opacity-50">{wecomBusy === 'default-qr' ? '生成中…' : wecom ? '生成默认二维码' : '读取中…'}</button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm" data-testid="wecom-rows">
                <thead className="bg-stone-50 text-xs text-stone-500"><tr><th className="px-2 py-2"><span className="sr-only">选择</span></th><th className="px-3 py-2">会员</th><th className="px-3 py-2">分层</th><th className="px-3 py-2">48 小时窗口</th><th className="px-3 py-2">企业微信</th></tr></thead>
                <tbody>
                  {(wecom?.rows || []).map((r) => (
                    <tr key={r.memberId} className="border-t border-stone-100">
                      <td className="px-2 py-2"><input type="checkbox" aria-label={`选择 ${r.name}`} checked={selected.has(r.memberId)} disabled={r.wecomAdded} onChange={() => toggle(r.memberId)} /></td>
                      <td className="px-3 py-2 font-bold">{r.name}<div className="text-xs text-stone-400">ID {r.memberId}</div></td>
                      <td className="px-3 py-2">{r.role}</td>
                      <td className="px-3 py-2">{r.window.open ? <span className="text-teal-700">{r.window.label}</span> : <span className="text-stone-500">{r.window.label}</span>}</td>
                      <td className="px-3 py-2">{wecomCell(r.memberId)}</td>
                    </tr>
                  ))}
                  {wecom && !wecom.rows.length ? <tr><td colSpan={5} className="px-3 py-4 text-stone-500">暂无已绑定服务号的会员</td></tr> : null}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-stone-500">勾选后点「邀请加企业微信」：48 小时内与服务号互动过的会员会收到文字＋专属二维码（扫码添加后自动对应会员）；其余标记「无法触达（超过48小时）」，可复制邀请内容或下载二维码手动转发。</p>
            </div>
          </div>
          {inviteResults ? (
            <div className="border-t border-stone-100 p-4 text-sm" data-testid="wecom-invite-results">
              <div className="font-black">邀请结果</div>
              <ul className="mt-2 grid gap-2">
                {inviteResults.map((r) => (
                  <li key={r.memberId} className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{r.name}（{r.memberId}）</span>
                    <span className={r.status === 'sent' ? 'text-teal-700' : r.status === 'unreachable' ? 'text-amber-700' : 'text-stone-600'}>{r.label}</span>
                    {r.qrCode && r.status !== 'sent' ? (
                      <>
                        <button type="button" onClick={() => copy(`t${r.memberId}`, `${wecom?.inviteText || ''}\n二维码：${r.qrCode}`)} className="rounded border border-stone-300 px-2 py-0.5 text-xs font-bold">{copied === `t${r.memberId}` ? '已复制' : '复制邀请内容'}</button>
                        <button type="button" onClick={() => copy(`l${r.memberId}`, r.qrCode || '')} className="rounded border border-stone-300 px-2 py-0.5 text-xs font-bold">{copied === `l${r.memberId}` ? '已复制' : '复制二维码链接'}</button>
                        <a href={`/api/cn/ops/wecom/qr?memberId=${r.memberId}`} className="rounded border border-stone-300 px-2 py-0.5 text-xs font-bold">下载二维码</a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <h2 className="border-b border-stone-100 px-4 py-3 font-black">抄送／兜底接收人</h2>
          <table className="w-full min-w-[700px] text-left text-sm">
            <tbody>
              {(data?.admins || []).map((a) => (
                <tr key={a.openidTail} className="border-t border-stone-100"><td className="px-4 py-2 font-bold">{a.name}<div className="text-xs text-stone-400">openid …{a.openidTail}</div></td><td className="px-4 py-2">{a.window.label}</td><td className="px-4 py-2 text-xs">{noticeText(a.lastNotice)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="font-black">体验点负责人设置</h2>
          <div className="mt-3 grid gap-3">
            {(data?.points || []).map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3">
                <div className="w-64 text-sm font-bold">{p.label}（{p.city}）</div>
                <input value={drafts[p.id] || ''} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))} placeholder="会员 ID，多个用逗号分隔" className="w-64 rounded-lg border border-stone-300 px-3 py-2 text-sm" />
                <button type="button" onClick={() => savePoint(p.id)} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-bold text-white">保存</button>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-black">分层唤醒排程</h2><p className="text-sm font-semibold text-stone-500">店主每日简报；活跃每周 ≤1 次；降温每周 1–2 次；沉睡每月 2–3 次后停止。只走 48 小时内客服消息。</p></div>
            <button type="button" onClick={dryRun} className="rounded-lg border border-teal-600 px-3 py-2 text-sm font-bold text-teal-800">试算今天（不发送）</button>
          </div>
          {plan ? (
            <div className="mt-3 text-sm">
              <div className="font-bold">合计 {plan.summary.total}：可发 {plan.summary.send}，跳过 {plan.summary.skip}</div>
              <ul className="mt-2 max-h-64 overflow-auto text-xs text-stone-600">
                {plan.plan.slice(0, 80).map((r) => <li key={`${r.memberId}-${r.tierLabel}`}>{r.name}（{r.memberId}）· {r.tierLabel} · {r.action === 'send' ? '可发' : '跳过'} · {r.reason}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 text-xs text-stone-500">最近运行：{(data?.runs || []).map((r) => `${t(r.at)} ${r.task}${r.dryRun ? '（试算）' : ''} 可发 ${r.summary.send ?? 0}/跳过 ${r.summary.skip ?? 0}`).join('；') || '—'}</div>
        </section>

        <section className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <h2 className="border-b border-stone-100 px-4 py-3 font-black">最近通知记录</h2>
          <table className="w-full min-w-[760px] text-left text-xs">
            <tbody>
              {(data?.recent || []).map((n) => (
                <tr key={n.id} className="border-t border-stone-100"><td className="px-4 py-2">{t(n.at)}</td><td className="px-4 py-2">{n.test ? '【测试】' : ''}{EVENT[n.event] || n.event}</td><td className="px-4 py-2">{n.targetLabel}</td><td className="px-4 py-2">{ROLE[n.role] || n.role}{n.memberId ? ` · ${n.memberId}` : ''}</td><td className="px-4 py-2">{STATUS[n.status] || n.status} · {n.channel}{n.errcode && n.errcode !== '0' ? `（${n.errcode}）` : ''}</td><td className="px-4 py-2">{n.ackAt ? '已确认' : n.escalatedAt ? '已升级' : ''}</td></tr>
              ))}
              {data && !data.recent.length ? <tr><td className="px-4 py-4 text-stone-500">暂无记录</td></tr> : null}
            </tbody>
          </table>
        </section>
        </>}
      </div>
    </main>
  );
}

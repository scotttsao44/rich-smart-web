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
  const [plan, setPlan] = useState<{ summary: Record<string, number>; plan: Array<{ memberId: number; name: string; tierLabel: string; action: string; reason: string }> } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/cn/ops/push-people', { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error || '读取失败'); return; }
    setError('');
    setData(body);
    setDrafts(Object.fromEntries((body.points || []).map((p: Data['points'][number]) => [p.id, p.ownerMemberIds.join(',')])));
  }, []);

  useEffect(() => { load(); }, [load]);

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
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4" />刷新</button>
        </div>
        {error ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div> : null}

        <section className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white" data-testid="push-owners">
          <h2 className="border-b border-stone-100 px-4 py-3 font-black">店主／体验点负责人（{data?.owners.length ?? 0}）</h2>
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500"><tr><th className="px-4 py-2">会员</th><th className="px-4 py-2">负责</th><th className="px-4 py-2">通知</th><th className="px-4 py-2">服务号</th><th className="px-4 py-2">48 小时窗口</th><th className="px-4 py-2">最近通知</th></tr></thead>
            <tbody>
              {(data?.owners || []).map((o) => (
                <tr key={o.memberId} className="border-t border-stone-100">
                  <td className="px-4 py-2 font-bold">{o.name}<div className="text-xs text-stone-400">ID {o.memberId}</div></td>
                  <td className="px-4 py-2">{o.targets.map((x) => `${x.label}（${x.city || '城市待补'}·${x.source}）`).join('、') || '—'}</td>
                  <td className="px-4 py-2">{o.enabled ? <span className="font-bold text-teal-700">已开启</span> : <span className="text-stone-500">未开启</span>}</td>
                  <td className="px-4 py-2">{o.bound ? '已绑定' : <span className="font-bold text-amber-700">未绑定</span>}</td>
                  <td className="px-4 py-2">{o.window.open ? <span className="text-teal-700">{o.window.label}</span> : <span className="text-stone-500">{o.window.label}</span>}</td>
                  <td className="px-4 py-2 text-xs">{noticeText(o.lastNotice)}</td>
                </tr>
              ))}
              {data && !data.owners.length ? <tr><td colSpan={6} className="px-4 py-4 text-stone-500">暂无店主。可在下方为体验点指定负责人会员 ID，或等门店申请开通后自动列入。</td></tr> : null}
            </tbody>
          </table>
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
      </div>
    </main>
  );
}

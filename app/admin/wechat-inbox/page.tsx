'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Row = {
  openid: string;
  memberId: number | null;
  memberName: string | null;
  status: 'ai' | 'pending' | 'human' | 'closed';
  unread: number;
  tags: string[];
  attribution: string;
  handoffReason: string | null;
  lastMessageAt: string;
  lastText: string;
  windowLeftMs: number;
  simulated: boolean;
};

type Msg = { id: string; role: 'user' | 'ai' | 'admin' | 'system'; type: string; text: string; at: string; delivery?: string; errcode?: string; tag?: string; adminName?: string };

type Detail = {
  conversation: {
    openid: string;
    memberId?: number | null;
    memberName?: string | null;
    source?: string | null;
    status: Row['status'];
    handoffReason?: string | null;
    pausedUntil?: string | null;
    attribution: { status: string; answer?: string; note?: string; reviewedBy?: string };
    messages: Msg[];
  };
  windowLeftMs: number;
  notifications: Array<{ id: string; at: string; reason: string; results: Array<{ channel: string; status: string; errcode?: string }> }>;
};

const ACTION_DONE: Record<string, string> = { takeover: '已接手人工（AI 暂停 12 小时）', release: '已交回 AI', close: '已标记处理' };
function humanActive(c: { status: string; pausedUntil?: string | null }) {
  return c.status === 'human' && !!c.pausedUntil && Date.parse(c.pausedUntil) > Date.now();
}

const STATUS_LABEL: Record<Row['status'], string> = { ai: 'AI 回复中', pending: '待人工', human: '人工处理中', closed: '已处理' };
const STATUS_CLASS: Record<Row['status'], string> = {
  ai: 'bg-green-50 text-green-700',
  pending: 'bg-red-50 text-red-700',
  human: 'bg-amber-50 text-amber-700',
  closed: 'bg-gray-100 text-gray-500',
};
const ATTR_LABEL: Record<string, string> = { none: '', known: '已有推荐人', asked: '已询问来源', pending_review: '来源待审核', confirmed: '来源已确认', rejected: '来源已驳回' };
const DELIVERY_LABEL: Record<string, string> = { passive: '已回复', custom: '已发送', failed: '发送失败', simulated: '模拟', none: '发送中' };

function fmt(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function hoursLeft(ms: number) {
  if (ms <= 0) return '已超 48 小时';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `可回复剩 ${h} 小时 ${m} 分`;
}

function displayName(r: { memberName?: string | null; openid: string; simulated?: boolean }) {
  return `${r.simulated ? '[模拟] ' : ''}${r.memberName || `访客 ${r.openid.slice(-6)}`}`;
}

function Inbox() {
  const search = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(search.get('openid'));
  const [detail, setDetail] = useState<Detail | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  useEffect(() => setNotice(''), [selected]);
  const [error, setError] = useState('');

  const loadList = useCallback(async () => {
    const res = await fetch('/api/admin/wechat-inbox', { cache: 'no-store' });
    if (res.ok) setRows((await res.json()).conversations || []);
  }, []);

  const loadDetail = useCallback(async (openid: string) => {
    const res = await fetch(`/api/admin/wechat-inbox?openid=${encodeURIComponent(openid)}`, { cache: 'no-store' });
    if (res.ok) setDetail(await res.json());
    else setDetail(null);
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, 15000);
    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    loadDetail(selected);
    const t = setInterval(() => loadDetail(selected), 10000);
    return () => clearInterval(t);
  }, [selected, loadDetail]);

  const act = async (payload: Record<string, unknown>) => {
    if (!selected || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/wechat-inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openid: selected, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || '操作失败');
      if (res.ok && payload.action === 'reply') setReply('');
      if (res.ok && ACTION_DONE[String(payload.action)]) setNotice(`${ACTION_DONE[String(payload.action)]}${data.unchanged ? '（之前已是此状态）' : ''}`);
      await Promise.all([loadDetail(selected), loadList()]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const conv = detail?.conversation;
  const pending = rows.filter((r) => r.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">服务号客服</h1>
          <p className="text-sm text-gray-500 mt-1">「糙米量子」服务号的客人消息、AI 回复与人工接手。待人工 {pending} 个。</p>
        </div>
        <button onClick={loadList} className="btn-outline text-sm">刷新</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {rows.length === 0 && <div className="p-6 text-sm text-gray-500">暂无对话</div>}
          {rows.map((r) => (
            <button
              key={r.openid}
              onClick={() => setSelected(r.openid)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${selected === r.openid ? 'bg-amber-50' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900 truncate">{displayName(r)}</span>
                <span className="text-xs text-gray-400 shrink-0">{fmt(r.lastMessageAt)}</span>
              </div>
              <div className="text-xs text-gray-500 truncate mt-1">{r.lastText}</div>
              <div className="flex flex-wrap gap-1 mt-2">
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                {r.unread > 0 && <span className="text-xs px-2 py-0.5 rounded bg-red-500 text-white">{r.unread} 条未读</span>}
                {r.tags.includes('health') && <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700">健康问题</span>}
                {ATTR_LABEL[r.attribution] && <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700">{ATTR_LABEL[r.attribution]}</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 flex flex-col min-h-[480px]">
          {!conv && <div className="p-6 text-sm text-gray-500">请选择左侧对话</div>}
          {conv && detail && (
            <>
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{displayName({ memberName: conv.memberName, openid: conv.openid, simulated: conv.openid.startsWith('SIMULATED_') })}</div>
                  <div className="text-xs text-gray-500">
                    {STATUS_LABEL[conv.status]}
                    {conv.handoffReason ? ` · ${conv.handoffReason}` : ''}
                    {conv.memberId ? ` · 会员 ${conv.memberId}` : ' · 未关联会员'}
                    {conv.source ? ` · 来源 ${conv.source}` : ''}
                    {` · ${hoursLeft(detail.windowLeftMs)}`}
                  </div>
                </div>
                <div className="flex gap-2">
                  {humanActive(conv) ? (
                    <span className="text-xs px-2 py-1 rounded bg-orange-50 text-orange-700">人工处理中</span>
                  ) : (
                    <button disabled={busy} onClick={() => act({ action: 'takeover' })} className="btn-outline text-xs">{busy ? '处理中…' : '接手人工'}</button>
                  )}
                  {conv.status === 'ai' ? (
                    <span className="text-xs px-2 py-1 rounded bg-green-50 text-green-700">已交回 AI</span>
                  ) : (
                    <button disabled={busy} onClick={() => act({ action: 'release' })} className="btn-outline text-xs">{busy ? '处理中…' : '交回 AI'}</button>
                  )}
                  {conv.status === 'closed' ? (
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">已标记处理</span>
                  ) : (
                    <button disabled={busy} onClick={() => act({ action: 'close' })} className="btn-outline text-xs">{busy ? '处理中…' : '标记已处理'}</button>
                  )}
                  {notice && <span className="text-xs text-green-700 self-center">✓ {notice}</span>}
                </div>
              </div>

              {(conv.attribution.status === 'pending_review' || conv.attribution.status === 'asked') && (
                <div className="mx-4 mt-3 p-3 rounded-lg bg-purple-50 text-sm text-purple-900">
                  <div>推荐来源：{conv.attribution.answer || '（已询问，客人尚未回答）'}</div>
                  <div className="text-xs text-purple-700 mt-1">没有推荐码的客人不默认归为官方直属，请核对后处理。</div>
                  {conv.attribution.status === 'pending_review' && (
                    <div className="flex gap-2 mt-2">
                      <button disabled={busy} onClick={() => act({ action: 'attribution', status: 'confirmed' })} className="btn-outline text-xs">确认来源</button>
                      <button disabled={busy} onClick={() => act({ action: 'attribution', status: 'rejected' })} className="btn-outline text-xs">驳回</button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-auto p-4 space-y-3">
                {conv.messages.map((m) => (
                  <div key={m.id} className={m.role === 'user' ? 'flex justify-start' : m.role === 'system' ? 'flex justify-center' : 'flex justify-end'}>
                    {m.role === 'system' ? (
                      <span className="text-xs text-gray-400">{fmt(m.at)} {m.text}</span>
                    ) : (
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-gray-100 text-gray-900' : m.role === 'ai' ? 'bg-green-50 text-green-900' : 'bg-amber-50 text-amber-900'}`}>
                        <div className="text-[11px] text-gray-400 mb-1">
                          {m.role === 'user' ? '客人' : m.role === 'ai' ? 'AI' : `客服${m.adminName ? ` ${m.adminName}` : ''}`} · {fmt(m.at)}
                          {m.role !== 'user' && m.delivery ? ` · ${DELIVERY_LABEL[m.delivery] || m.delivery}${m.errcode ? `（${m.errcode}）` : ''}` : ''}
                        </div>
                        {m.text}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {detail.notifications.length > 0 && (
                <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
                  最近通知：{fmt(detail.notifications[0].at)} {detail.notifications[0].reason}（
                  {detail.notifications[0].results.map((r) => `${r.channel}:${r.status}${r.errcode ? `/${r.errcode}` : ''}`).join('，')}）
                </div>
              )}

              <div className="p-4 border-t border-gray-100 space-y-2">
                {error && <div className="text-sm text-red-600">{error}</div>}
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  placeholder={detail.windowLeftMs > 0 ? '输入回复，发送后客人会在服务号收到（发送后 AI 暂停 12 小时）' : '已超过 48 小时，需等客人再次发消息后才能回复'}
                  disabled={detail.windowLeftMs <= 0}
                  className="w-full border border-gray-200 rounded-lg p-2 text-sm"
                />
                <div className="flex justify-end">
                  <button disabled={busy || !reply.trim() || detail.windowLeftMs <= 0} onClick={() => act({ action: 'reply', text: reply })} className="btn-primary text-sm">
                    发送
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WechatInboxPage() {
  return (
    <Suspense fallback={<div className="text-gray-500">加载中...</div>}>
      <Inbox />
    </Suspense>
  );
}

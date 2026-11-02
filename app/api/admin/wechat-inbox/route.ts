import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, requireAdmin } from '@/lib/auth';
import {
  appendKefuMessage,
  getKefuConversation,
  listKefuConversations,
  listKefuNotifications,
  setKefuMessageDelivery,
  updateKefuConversation,
} from '@/lib/local-cn-wechat-kefu';
import { isSimulatedOpenid } from '@/lib/wechat-kefu-notify';
import { sendMpCustomText } from '@/lib/wechat-mp-api';

// 服务号客服收件箱（仅平台管理员）
export const dynamic = 'force-dynamic';

const WINDOW_MS = 48 * 60 * 60 * 1000;

function windowLeftMs(lastUserAt?: string) {
  if (!lastUserAt) return 0;
  return Math.max(0, Date.parse(lastUserAt) + WINDOW_MS - Date.now());
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const openid = request.nextUrl.searchParams.get('openid');
  if (openid) {
    const conv = getKefuConversation(openid);
    if (!conv) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (conv.unread) updateKefuConversation(openid, (c) => { c.unread = 0; });
    return NextResponse.json({
      conversation: { ...conv, unread: 0, aiCalls: undefined },
      windowLeftMs: windowLeftMs(conv.lastUserAt),
      notifications: listKefuNotifications(openid).slice(0, 20),
    });
  }
  const rows = listKefuConversations().map((c) => {
    const last = c.messages[c.messages.length - 1];
    return {
      openid: c.openid,
      memberId: c.memberId ?? null,
      memberName: c.memberName ?? null,
      status: c.status,
      unread: c.unread,
      tags: c.tags,
      attribution: c.attribution.status,
      handoffReason: c.handoffReason || null,
      lastMessageAt: c.lastMessageAt,
      lastText: last ? `${last.role === 'user' ? '' : last.role === 'ai' ? 'AI：' : last.role === 'admin' ? '客服：' : ''}${last.text}`.slice(0, 80) : '',
      windowLeftMs: windowLeftMs(c.lastUserAt),
      simulated: isSimulatedOpenid(c.openid),
    };
  });
  return NextResponse.json({ conversations: rows, pending: rows.filter((r) => r.status === 'pending').length });
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const admin = await getFreshSessionUser(request);
  const adminName = admin?.name || `管理员 ${admin?.id ?? ''}`.trim();
  const body = await request.json().catch(() => ({}));
  const openid = String(body?.openid || '');
  const action = String(body?.action || '');
  const conv = openid ? getKefuConversation(openid) : null;
  if (!conv) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (action === 'reply') {
    const content = String(body?.text || '').trim().slice(0, 1000);
    if (!content) return NextResponse.json({ error: '请输入回复内容' }, { status: 400 });
    if (!windowLeftMs(conv.lastUserAt)) return NextResponse.json({ error: '已超过 48 小时，需等客人再次发消息后才能回复' }, { status: 409 });
    const { message } = appendKefuMessage(openid, { role: 'admin', type: 'text', text: content, delivery: 'none', adminName }, (c) => {
      c.status = 'human';
      c.pausedUntil = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    });
    if (isSimulatedOpenid(openid)) {
      setKefuMessageDelivery(openid, message.id, 'simulated');
      return NextResponse.json({ ok: true, delivery: 'simulated' });
    }
    const r = await sendMpCustomText(openid, content);
    setKefuMessageDelivery(openid, message.id, r.ok ? 'custom' : 'failed', r.ok ? undefined : String(r.errcode));
    if (!r.ok) return NextResponse.json({ error: `发送失败（${r.errcode}）`, errcode: r.errcode }, { status: 502 });
    return NextResponse.json({ ok: true, delivery: 'custom' });
  }

  if (action === 'takeover' || action === 'release' || action === 'close') {
    // 幂等：状态没有变化就不再写系统消息（避免重复点击刷出多条「交回 AI」）
    const humanActive = conv.status === 'human' && !!conv.pausedUntil && Date.parse(conv.pausedUntil) > Date.now();
    const already = action === 'takeover' ? humanActive : action === 'release' ? conv.status === 'ai' : conv.status === 'closed';
    if (already) return NextResponse.json({ ok: true, unchanged: true, status: conv.status });
    updateKefuConversation(openid, (c) => {
      if (action === 'takeover') {
        c.status = 'human';
        c.pausedUntil = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      } else if (action === 'release') {
        c.status = 'ai';
        c.pausedUntil = null;
        c.handoffReason = null;
      } else {
        c.status = 'closed';
        c.pausedUntil = null;
      }
    });
    appendKefuMessage(openid, { role: 'system', type: 'event', text: `${adminName}：${action === 'takeover' ? '接手人工' : action === 'release' ? '交回 AI' : '标记已处理'}` });
    return NextResponse.json({ ok: true, unchanged: false, status: action === 'takeover' ? 'human' : action === 'release' ? 'ai' : 'closed' });
  }

  if (action === 'attribution') {
    const status = body?.status === 'confirmed' ? 'confirmed' : body?.status === 'rejected' ? 'rejected' : null;
    if (!status) return NextResponse.json({ error: 'bad_status' }, { status: 400 });
    updateKefuConversation(openid, (c) => {
      c.attribution = { ...c.attribution, status, note: String(body?.note || '').slice(0, 200) || c.attribution.note, reviewedAt: new Date().toISOString(), reviewedBy: adminName };
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'bad_action' }, { status: 400 });
}

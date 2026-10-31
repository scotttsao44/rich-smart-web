'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, MessageCircle, FileText, AlertCircle, Clock,
  CheckCircle, XCircle, Send, RefreshCw
} from 'lucide-react';

const typeLabels: Record<string, string> = {
  inquiry: '产品咨询',
  complaint: '消费者投诉',
  refund: '退换货申请',
  shipping: '物流查询',
  other: '其他问题',
};

const statusLabels: Record<string, { label: string; color: string }> = {
  open: { label: '待处理', color: 'bg-amber-100 text-amber-800' },
  processing: { label: '处理中', color: 'bg-blue-100 text-blue-800' },
  resolved: { label: '已解決', color: 'bg-green-100 text-green-800' },
  closed: { label: '已结案', color: 'bg-gray-100 text-gray-800' },
};

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [replyText, setReplyText] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/support');
      const data = await res.json();
      setTickets(data.tickets || []);
    } catch {
      alert('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleUpdate = async (id: number, status: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/support', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) {
        fetchTickets();
        if (selectedTicket?.id === id) {
          setSelectedTicket({ ...selectedTicket, status });
        }
      }
    } catch {
      alert('更新失败');
    } finally {
      setSaving(false);
    }
  };

  const handleReply = async () => {
    if (!selectedTicket || !replyText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/support', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedTicket.id,
          status: 'resolved',
          adminReply: replyText.trim(),
        }),
      });
      if (res.ok) {
        setReplyText('');
        fetchTickets();
        setSelectedTicket({ ...selectedTicket, status: 'resolved', adminReply: replyText.trim() });
      }
    } catch {
      alert('回覆失败');
    } finally {
      setSaving(false);
    }
  };

  const openCount = tickets.filter((t) => t.status === 'open').length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-gray-500 hover:text-gray-700">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">客服工单管理</h1>
        </div>
        <button onClick={fetchTickets} className="btn-outline text-sm flex items-center gap-1">
          <RefreshCw size={14} /> 重新整理
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-sm text-gray-500">待处理</p>
          <p className="text-2xl font-bold text-amber-600">{openCount}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">总工单</p>
          <p className="text-2xl font-bold text-gray-900">{tickets.length}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">加载中...</p>
      ) : tickets.length === 0 ? (
        <div className="card text-center py-12">
          <MessageCircle size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">尚无客服工单</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Ticket List */}
          <div className="space-y-3">
            {tickets.map((t) => {
              const s = statusLabels[t.status] || statusLabels.open;
              return (
                <button
                  key={t.id}
                  onClick={() => { setSelectedTicket(t); setReplyText(''); }}
                  className={`w-full text-left card hover:shadow-md transition-shadow ${
                    selectedTicket?.id === t.id ? 'ring-2 ring-amber-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">#{t.id} · {typeLabels[t.type] || t.type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>
                      {s.label}
                    </span>
                  </div>
                  <p className="font-medium text-gray-900 truncate">{t.subject}</p>
                  <p className="text-sm text-gray-500 mt-1 truncate">{t.name} · {t.email}</p>
                </button>
              );
            })}
          </div>

          {/* Detail Panel */}
          <div>
            {selectedTicket ? (
              <div className="card sticky top-20">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-gray-900">案件详情 #{selectedTicket.id}</h2>
                  <div className="flex gap-2">
                    {selectedTicket.status === 'open' && (
                      <button
                        onClick={() => handleUpdate(selectedTicket.id, 'processing')}
                        disabled={saving}
                        className="text-xs px-3 py-1 bg-blue-600 text-white rounded-full hover:bg-blue-700"
                      >
                        标记处理中
                      </button>
                    )}
                    {(selectedTicket.status === 'open' || selectedTicket.status === 'processing') && (
                      <button
                        onClick={() => handleUpdate(selectedTicket.id, 'closed')}
                        disabled={saving}
                        className="text-xs px-3 py-1 bg-gray-600 text-white rounded-full hover:bg-gray-700"
                      >
                        结案
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-3 mb-6">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-gray-500">姓名</div>
                    <div className="text-gray-900">{selectedTicket.name}</div>
                    <div className="text-gray-500">Email</div>
                    <div className="text-gray-900">{selectedTicket.email}</div>
                    <div className="text-gray-500">电话</div>
                    <div className="text-gray-900">{selectedTicket.phone || '—'}</div>
                    <div className="text-gray-500">类型</div>
                    <div className="text-gray-900">{typeLabels[selectedTicket.type]}</div>
                    {selectedTicket.orderId && (
                      <>
                        <div className="text-gray-500">相关订单</div>
                        <div className="text-gray-900">#{selectedTicket.orderId}</div>
                      </>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-1">主旨</p>
                  <p className="text-gray-900 mb-3">{selectedTicket.subject}</p>
                  <p className="text-sm font-medium text-gray-700 mb-1">内容</p>
                  <p className="text-gray-900 whitespace-pre-line">{selectedTicket.message}</p>
                </div>

                {selectedTicket.adminReply && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium text-green-700 mb-1">客服回覆</p>
                    <p className="text-green-900 whitespace-pre-line">{selectedTicket.adminReply}</p>
                    {selectedTicket.repliedAt && (
                      <p className="text-xs text-green-600 mt-2">
                        回覆时间：{new Date(selectedTicket.repliedAt).toLocaleString('zh-TW')}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="label">回覆客户</label>
                  <textarea
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className="input-field mb-2"
                    placeholder="输入回覆内容..."
                  />
                  <button
                    onClick={handleReply}
                    disabled={saving || !replyText.trim()}
                    className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
                  >
                    <Send size={14} />
                    {saving ? '提交中...' : '回覆並结案'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="card text-center py-12 text-gray-400">
                <MessageCircle size={48} className="mx-auto mb-4" />
                <p>选择左側工单查看详情</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

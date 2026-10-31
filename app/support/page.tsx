'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/app/providers';
import Link from 'next/link';
import {
  MessageCircle, FileText, CheckCircle, Clock, AlertCircle,
  Send, Phone, Mail, MapPin, ArrowLeft
} from 'lucide-react';

const ticketTypes = [
  { value: 'inquiry', label: '产品咨询', icon: MessageCircle },
  { value: 'complaint', label: '消费者投诉', icon: FileText },
  { value: 'refund', label: '退换货申请', icon: AlertCircle },
  { value: 'shipping', label: '物流查询', icon: Clock },
  { value: 'other', label: '其他问题', icon: MessageCircle },
];

function SupportPageBody() {
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get('tab') === 'complaint' ? 'complaint' : 'form';
  const [activeTab, setActiveTab] = useState(defaultTab);
  const { user } = useAuth();

  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: '',
    type: 'inquiry',
    subject: '',
    message: '',
    orderId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [ticketId, setTicketId] = useState<number | null>(null);
  const [myTickets, setMyTickets] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      fetch(`/api/support?userId=${user.id}`)
        .then((r) => r.json())
        .then((d) => setMyTickets(d.tickets || []))
        .catch(() => {});
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          userId: user?.id || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTicketId(data.ticketId);
        setSubmitted(true);
        setForm({ name: '', email: '', phone: '', type: 'inquiry', subject: '', message: '', orderId: '' });
      } else {
        alert(data.error || '提交失败');
      }
    } catch {
      alert('提交失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <CheckCircle size={64} className="mx-auto text-green-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {activeTab === 'complaint' ? '投诉已提交' : '讯息已提交'}
        </h2>
        <p className="text-gray-500 mb-2">
          案件编号：#{ticketId}
        </p>
        <p className="text-gray-500 mb-6">
          我们会在 1–2 个工作天内与您联系，请留意 Email 或手机号。
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/portal/shop" className="btn-primary">前往商城</Link>
          <button onClick={() => { setSubmitted(false); setTicketId(null); }} className="btn-outline">
            再写一则
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={16} /> 返回首页
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">客服中心</h1>
      <p className="text-gray-500 mb-6">有任何问题或建议，歡迎与我们联系</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('form')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'form' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <span className="flex items-center gap-1"><MessageCircle size={14} /> 联系客服</span>
        </button>
        <button
          onClick={() => setActiveTab('complaint')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'complaint' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <span className="flex items-center gap-1"><FileText size={14} /> 消费者投诉</span>
        </button>
        {user && (
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'history' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span className="flex items-center gap-1"><Clock size={14} /> 我的案件</span>
          </button>
        )}
      </div>

      {activeTab === 'history' && user ? (
        <div className="space-y-4">
          {myTickets.length === 0 ? (
            <div className="card text-center py-12">
              <MessageCircle size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">尚无客服记录</p>
            </div>
          ) : (
            myTickets.map((t) => (
              <div key={t.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500">案件 #{t.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    t.status === 'open' ? 'bg-amber-100 text-amber-800' :
                    t.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                    t.status === 'resolved' ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {t.status === 'open' ? '待处理' : t.status === 'processing' ? '处理中' : t.status === 'resolved' ? '已解決' : '已结案'}
                  </span>
                </div>
                <p className="font-medium text-gray-900">{t.subject}</p>
                <p className="text-sm text-gray-500 mt-1">{t.message}</p>
                {t.adminReply && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-xs text-green-700 font-medium mb-1">客服回覆：</p>
                    <p className="text-sm text-green-800">{t.adminReply}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          {/* Contact Info Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="card flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg"><Phone size={20} className="text-amber-600" /></div>
              <div>
                <p className="text-sm font-medium text-gray-900">客服专线</p>
                <p className="text-sm text-gray-500">+886-XXX-XXX-XXX</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg"><Mail size={20} className="text-green-600" /></div>
              <div>
                <p className="text-sm font-medium text-gray-900">电子邮件</p>
                <p className="text-sm text-gray-500">support@richsmart.net</p>
              </div>
            </div>
            <div className="card flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg"><MapPin size={20} className="text-blue-600" /></div>
              <div>
                <p className="text-sm font-medium text-gray-900">服务时间</p>
                <p className="text-sm text-gray-500">周一至周五 09:00–18:00</p>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="card">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {activeTab === 'complaint' ? '填写投诉表单' : '填写咨询表单'}
            </h2>
            {activeTab === 'complaint' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                <AlertCircle size={16} className="text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">
                  我们重视每一位客户的声音。您的投诉将直接送达管理层，我们承諾在 1–2 个工作天内回覆。
                </p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">姓名 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="input-field"
                    placeholder="您的姓名"
                  />
                </div>
                <div>
                  <label className="label">联系电话</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="input-field"
                    placeholder="您的电话"
                  />
                </div>
              </div>
              <div>
                <label className="label">Email <span className="text-red-500">*</span></label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="input-field"
                  placeholder="your@email.com"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">问题类型 <span className="text-red-500">*</span></label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="input-field"
                  >
                    {ticketTypes.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">相关订单编号（选填）</label>
                  <input
                    type="text"
                    value={form.orderId}
                    onChange={(e) => setForm({ ...form, orderId: e.target.value })}
                    className="input-field"
                    placeholder="#123"
                  />
                </div>
              </div>
              <div>
                <label className="label">主旨 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  required
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className="input-field"
                  placeholder="简短说明您的问题"
                />
              </div>
              <div>
                <label className="label">详细内容 <span className="text-red-500">*</span></label>
                <textarea
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="input-field"
                  placeholder="请详细描述您的问题，我们会尽快为您处理..."
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors ${
                  activeTab === 'complaint'
                    ? 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300'
                    : 'btn-primary disabled:opacity-50'
                }`}
              >
                <Send size={16} />
                {submitting ? '提交中...' : activeTab === 'complaint' ? '提交投诉' : '提交讯息'}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

export default function SupportPage() {
  return (
    <Suspense fallback={<div className="max-w-4xl mx-auto px-4 py-8">加载中...</div>}>
      <SupportPageBody />
    </Suspense>
  );
}

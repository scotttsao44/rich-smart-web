'use client';

import { useAuth } from '@/app/providers';
import { useEffect, useState } from 'react';
import {
  User,
  Save,
  Mail,
  Phone,
  Star,
  TrendingUp,
  Wallet,
  Link as LinkIcon,
} from 'lucide-react';
import Link from 'next/link';

const levelNames = ['养生会员', '健康分享家', '养生顾问', '健康合伙人'];
const levelColors = [
  'bg-gray-100 text-gray-800',
  'bg-green-100 text-green-800',
  'bg-blue-100 text-blue-800',
  'bg-amber-100 text-amber-800',
];

export default function ProfilePage() {
  const { user, login } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [identities, setIdentities] = useState<any[]>([]);
  const [binding, setBinding] = useState({
    provider: 'wechat',
    providerUserId: '',
    displayName: '',
  });
  const [bindingMessage, setBindingMessage] = useState('');
  const [bindingSaving, setBindingSaving] = useState(false);

  useEffect(() => {
    async function fetchProfile() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/user?userId=${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setProfile(data.user);
          setForm({
            name: data.user.name || '',
            phone: data.user.phone || '',
            email: data.user.email || '',
          });
        }
      } catch (err) {
        console.error('加载失败:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchProfile();
  }, [user?.id]);

  useEffect(() => {
    async function fetchIdentities() {
      if (!user?.id) return;

      try {
        const res = await fetch(`/api/user/identities?userId=${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setIdentities(data.identities || []);
        }
      } catch (err) {
        console.error('加载身份绑定失败:', err);
      }
    }

    fetchIdentities();
  }, [user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setMessage('');

    try {
      const res = await fetch('/api/user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, ...form }),
      });

      if (res.ok) {
        const data = await res.json();
        setProfile(data.user);
        login({
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          agentLevel: data.user.agentLevel,
          region: data.user.region,
        });
        setMessage('资料更新成功！');
      } else {
        setMessage('更新失败，请重试');
      }
    } catch (err) {
      setMessage('更新失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleBindIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setBindingSaving(true);
    setBindingMessage('');

    try {
      const res = await fetch('/api/user/identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          provider: binding.provider,
          providerUserId: binding.providerUserId,
          displayName: binding.displayName,
          metadata: { source: 'manual_profile_binding' },
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setIdentities((current) => {
          const filtered = current.filter(
            (item) => item.provider !== data.identity.provider
          );
          return [...filtered, data.identity];
        });
        setBinding({ ...binding, providerUserId: '', displayName: '' });
        setBindingMessage('身份绑定已储存');
      } else {
        setBindingMessage(data.error || '身份绑定失败');
      }
    } catch (err) {
      setBindingMessage('身份绑定失败');
    } finally {
      setBindingSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-semibold text-gray-700 mb-4">请先登录</h2>
        <p className="text-gray-500 mb-6">您需要登录才能查看个人资料</p>
        <Link href="/login" className="btn-primary">
          前往登录
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">个人资料</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Info Card */}
        <div className="md:col-span-1">
          <div className="card text-center">
            <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <User size={32} className="text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              {profile?.name || user.name || '会员'}
            </h2>
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium mb-4 ${
                levelColors[profile?.agentLevel || 0]
              }`}
            >
              <Star size={12} className="mr-1" />
              {levelNames[profile?.agentLevel || 0]}
            </span>

            <div className="space-y-3 text-left">
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp size={16} className="text-gray-400" />
                <span className="text-gray-500">累积业绩:</span>
                <span className="font-semibold text-gray-900">
                  NT${parseFloat(profile?.totalSalesVolume || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Wallet size={16} className="text-gray-400" />
                <span className="text-gray-500">佣金余额:</span>
                <span className="font-semibold text-gray-900">
                  NT${parseFloat(profile?.commissionBalance || 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Edit Form */}
        <div className="md:col-span-2">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              编辑资料
            </h3>

            {message && (
              <div
                className={`mb-4 p-3 rounded-lg text-sm ${
                  message.includes('成功')
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {message}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">姓名</label>
                <div className="relative">
                  <User
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    className="input-field pl-10"
                    placeholder="请输入姓名"
                  />
                </div>
              </div>

              <div>
                <label className="label">电话</label>
                <div className="relative">
                  <Phone
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                    className="input-field pl-10"
                    placeholder="请输入电话"
                  />
                </div>
              </div>

              <div>
                <label className="label">Email</label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    className="input-field pl-10"
                    placeholder="请输入 Email"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <Save size={16} />
                  {saving ? '储存中...' : '储存变更'}
                </button>
              </div>
            </form>
          </div>

          <div className="card mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              LINE / 微信身份绑定
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              点击授权后会自动把 LINE 或微信身份写入会员资料。平台尚未完成设定时，可先保留手动绑定作为备援。
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              <a
                href="/api/auth/line/start?returnTo=/portal/profile"
                className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700 hover:bg-green-100 text-center"
              >
                LINE 授权绑定
              </a>
              <a
                href="/api/auth/wechat/start?returnTo=/portal/profile"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 text-center"
              >
                微信公众号授权绑定
              </a>
            </div>

            <div className="space-y-2 mb-5">
              {identities.length === 0 ? (
                <p className="text-sm text-gray-400">尚未绑定 LINE 或微信身份。</p>
              ) : (
                identities.map((identity) => (
                  <div
                    key={identity.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-semibold text-gray-900">
                        {identity.provider === 'line'
                          ? 'LINE'
                          : identity.provider === 'wechat'
                            ? '微信公众号'
                            : '微信小程序'}
                      </p>
                      <p className="text-gray-500">
                        {identity.displayName || identity.providerUserId}
                      </p>
                    </div>
                    <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded-full">
                      已绑定
                    </span>
                  </div>
                ))
              )}
            </div>

            {bindingMessage && (
              <div
                className={`mb-4 p-3 rounded-lg text-sm ${
                  bindingMessage.includes('已储存')
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {bindingMessage}
              </div>
            )}

            <form onSubmit={handleBindIdentity} className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <select
                value={binding.provider}
                onChange={(e) => setBinding({ ...binding, provider: e.target.value })}
                className="input-field"
              >
                <option value="wechat">微信公众号</option>
                <option value="wechat_mini_program">微信小程序</option>
                <option value="line">LINE</option>
              </select>
              <input
                value={binding.providerUserId}
                onChange={(e) =>
                  setBinding({ ...binding, providerUserId: e.target.value })
                }
                className="input-field"
                placeholder="OpenID / LINE ID"
              />
              <input
                value={binding.displayName}
                onChange={(e) =>
                  setBinding({ ...binding, displayName: e.target.value })
                }
                className="input-field"
                placeholder="显示名称"
              />
              <button
                type="submit"
                disabled={bindingSaving}
                className="btn-primary inline-flex items-center justify-center gap-2"
              >
                <LinkIcon size={16} />
                {bindingSaving ? '储存中...' : '储存绑定'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

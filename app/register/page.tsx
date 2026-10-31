'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/app/providers';
import { UserPlus, User, Phone, Mail, Lock } from 'lucide-react';

type PendingReferral = {
  pending: boolean;
  referrerName?: string;
  referrerMemberId?: number;
  createdAt?: string;
};

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingReferral, setPendingReferral] = useState<PendingReferral>({ pending: false });
  const [confirmReferral, setConfirmReferral] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/cn/referral-link/pending', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return { pending: false };
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setPendingReferral(data);
      })
      .catch(() => {
        if (!cancelled) setPendingReferral({ pending: false });
      });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('密码与确认密码不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码长度至少 6 位');
      return;
    }

    if (pendingReferral.pending && !confirmReferral) {
      setError('请先确认邀请人后再注册');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone,
          email,
          password,
          confirmReferral,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '注册失败');
      }

      login(data.user);
      router.push('/portal');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="card w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">注册会员</h1>
          <p className="text-gray-600 mt-2">加入糙米科技，打开健康事业</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {pendingReferral.pending ? (
          <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold leading-6 text-teal-900">
            <div>您的邀请人：<span className="font-black">{pendingReferral.referrerName || '会员'}</span></div>
            <label className="mt-3 flex items-start gap-2 text-teal-950">
              <input
                type="checkbox"
                checked={confirmReferral}
                onChange={(event) => setConfirmReferral(event.target.checked)}
                className="mt-1 h-4 w-4 accent-teal-700"
              />
              <span>确认由此邀请人完成会员注册</span>
            </label>
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold leading-6 text-teal-900">
            新会员请从邀请链接进入完成会员注册；推荐关系会自动绑定，不需要填写推荐码。
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">姓名</label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field pl-10"
                placeholder="请输入姓名"
                required
              />
            </div>
          </div>

          <div>
            <label className="label">手机号号码</label>
            <div className="relative">
              <Phone className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-field pl-10"
                placeholder="请输入手机号号码"
                required
              />
            </div>
          </div>

          <div>
            <label className="label">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field pl-10"
                placeholder="请输入 email"
                required
              />
            </div>
          </div>

          <div>
            <label className="label">密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pl-10"
                placeholder="请输入密码（至少6位）"
                required
              />
            </div>
          </div>

          <div>
            <label className="label">确认密码</label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field pl-10"
                placeholder="请再次输入密码"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <UserPlus className="h-4 w-4" />
            {loading ? '注册中...' : '立即注册'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm">
          <span className="text-gray-600">已有账号？</span>{' '}
          <Link href="/login" className="text-amber-600 hover:text-amber-700 font-medium">
            立即登录
          </Link>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/app/providers';
import { LogIn, Mail, Lock, MessageCircle } from 'lucide-react';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [referrerCode, setReferrerCode] = useState('');
  const [returnTo, setReturnTo] = useState('/portal');
  const [adminMode, setAdminMode] = useState(false);
  const [paramsReady, setParamsReady] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.get('error');
    const next = params.get('next') || '';
    const isAdminLogin = params.get('mode') === 'admin' || params.get('admin') === '1' || next.startsWith('/admin');
    const ref = params.get('ref') || localStorage.getItem('richsmart_referral_code') || '';
    setAdminMode(isAdminLogin);
    if (next.startsWith('/') && !next.startsWith('//')) {
      setReturnTo(next);
    }
    if (message) setError(message);
    if (ref && !isAdminLogin) {
      const cleaned = ref.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
      setReferrerCode(cleaned);
      localStorage.setItem('richsmart_referral_code', cleaned);
    }
    setParamsReady(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, referrerCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '登录失败');
      }

      const role = String(data.user?.role || '').toLowerCase();
      if (adminMode && !['admin', 'staff'].includes(role)) {
        throw new Error('此账号不是管理员或员工账号，不能进入商品审核。');
      }

      login(data.user);
      router.push(returnTo);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="card w-full max-w-lg">
        {!paramsReady ? (
          <div className="py-12 text-center text-gray-500">加载登录页...</div>
        ) : (
        <>
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{adminMode ? '管理员登录' : '会员登录'}</h1>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}

        {referrerCode && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            推荐码 <span className="font-bold">{referrerCode}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Email 或 手机号号码</label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="input-field pl-10"
                placeholder="请输入 email 或手机号号码"
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
                placeholder="请输入密码"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <LogIn className="h-4 w-4" />
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        {!adminMode && (
          <>
            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-400">客服</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-green-100 bg-green-50/70 p-4 text-center">
                <MessageCircle className="mx-auto mb-2 h-6 w-6 text-green-600" />
                <p className="font-semibold text-gray-900">商家 LINE</p>
                <a
                  href="https://line.me/R/ti/p/@864humrc"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700"
                >
                  加入商家 LINE
                </a>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-center">
                <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-lg">
                  <Image
                    src="/wechat-official-qr.jpg"
                    alt="糙米量子 微信公众号二维码"
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                </div>
                <p className="mt-2 font-semibold text-gray-900">微信公众号：糙米量子</p>
                <p className="mt-1 text-xs text-gray-500">微信掃码关注，后续接收大陆站服务通知</p>
              </div>
            </div>

            <div className="my-6 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs text-gray-400">会员授权登录 / 绑定</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <a
                href={`/api/auth/line/start?returnTo=/portal${referrerCode ? `&ref=${encodeURIComponent(referrerCode)}` : ''}`}
                className="w-full rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700 hover:bg-green-100 flex items-center justify-center gap-2"
              >
                <MessageCircle className="h-4 w-4" />
                使用 LINE 登录 / 绑定
              </a>
              <a
                href={`/api/auth/wechat/start?returnTo=/portal${referrerCode ? `&ref=${encodeURIComponent(referrerCode)}` : ''}`}
                className="w-full rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 flex items-center justify-center gap-2"
              >
                <MessageCircle className="h-4 w-4" />
                使用微信登录 / 绑定
              </a>
            </div>
          </>
        )}

        {!adminMode && <div className="mt-6 text-center text-sm">
          <span className="text-gray-600">还没有账号？</span>{' '}
          <Link href={`/register${referrerCode ? `?ref=${encodeURIComponent(referrerCode)}` : ''}`} className="text-amber-600 hover:text-amber-700 font-medium">
            立即注册
          </Link>
        </div>}
        </>
        )}
      </div>
    </div>
  );
}

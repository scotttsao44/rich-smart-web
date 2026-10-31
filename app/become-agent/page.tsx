'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/providers';
import { Award, TrendingUp, Users, Crown, Star, CheckCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const agentLevels = [
  {
    level: 0,
    name: '养生会员',
    description: '普通会员，可购买产品享受会员价',
    threshold: '注册即可',
    commission: '无佣金',
    benefits: ['购买产品', '累积积分'],
    icon: Users,
    color: 'gray',
  },
  {
    level: 1,
    name: '健康分享家',
    description: '开始分享产品，赚取直接推荐佣金',
    threshold: '申请成为代理',
    commission: '直接分享佣金 10%',
    benefits: ['直接推荐佣金 10%', '个人推广链接'],
    icon: Star,
    color: 'amber',
  },
  {
    level: 2,
    name: '养生顾问',
    description: '具备团队管理能力，享受多级佣金',
    threshold: '累积业绩达 10 万或推荐 5 位分享家',
    commission: '直接 15% + 二级 5%',
    benefits: ['直接推荐佣金 15%', '二级佣金 5%', '团队管理工具'],
    icon: Award,
    color: 'blue',
  },
  {
    level: 3,
    name: '健康合伙人',
    description: '最高等级合伙人，享受完整佣金制度',
    threshold: '累积业绩达 50 万或推荐 3 位顾问',
    commission: '直接 20% + 二级 10% + 三级 5%',
    benefits: ['直接推荐佣金 20%', '二级佣金 10%', '三级佣金 5%', '区域保护', '优先参与活动'],
    icon: Crown,
    color: 'purple',
  },
];

export default function BecomeAgentPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      router.push('/login');
    }
  }, [user, router]);

  const handleApply = async () => {
    if (!user) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/upgrade-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || '申请失败');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/portal');
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link href="/portal" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" />
            返回会员中心
          </Link>
        </div>

        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">代理制度说明</h1>
          <p className="text-gray-600">糙米科技四级代理制度，让您的健康事业蒸蒸日上</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg mb-6 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          {agentLevels.map((level) => {
            const Icon = level.icon;
            return (
              <div
                key={level.level}
                className={`card relative ${
                  user.agentLevel === level.level
                    ? 'ring-2 ring-amber-500 bg-amber-50'
                    : user.agentLevel > level.level
                    ? 'opacity-75'
                    : ''
                }`}
              >
                {user.agentLevel === level.level && (
                  <div className="absolute top-4 right-4">
                    <span className="badge-amber">当前等级</span>
                  </div>
                )}

                <div className="flex items-center gap-3 mb-4">
                  <Icon className={`h-8 w-8 ${
                    level.color === 'gray' ? 'text-gray-500' :
                    level.color === 'amber' ? 'text-amber-500' :
                    level.color === 'blue' ? 'text-blue-500' :
                    'text-purple-500'
                  }`} />
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{level.name}</h3>
                    <span className="text-sm text-gray-500">Lv.{level.level}</span>
                  </div>
                </div>

                <p className="text-gray-600 mb-4">{level.description}</p>

                <div className="space-y-3">
                  <div>
                    <span className="text-sm font-medium text-gray-700">晉升门檻：</span>
                    <p className="text-sm text-gray-600">{level.threshold}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-700">佣金制度：</span>
                    <p className="text-sm text-gray-600">{level.commission}</p>
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-700">权益：</span>
                    <ul className="mt-1 space-y-1">
                      {level.benefits.map((benefit, idx) => (
                        <li key={idx} className="text-sm text-gray-600 flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card text-center">
          {success ? (
            <div className="py-8">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">申请成功！</h2>
              <p className="text-gray-600">恭喜您已成为健康分享家，即将跳转到会员中心...</p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-4">准备好开始了嗎？</h2>
              <p className="text-gray-600 mb-6">
                立即申请成为代理，打开您的健康分享之旅
              </p>
              <button
                onClick={handleApply}
                disabled={loading || user.agentLevel >= 1}
                className="btn-primary inline-flex items-center gap-2"
              >
                <TrendingUp className="h-4 w-4" />
                {loading
                  ? '申请中...'
                  : user.agentLevel >= 1
                  ? '您已是代理'
                  : '立即申请'}
              </button>
              {user.agentLevel >= 1 && (
                <p className="text-sm text-gray-500 mt-3">
                  您已经是代理，可以开始分享产品赚取佣金
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

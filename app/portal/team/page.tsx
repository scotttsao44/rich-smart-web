'use client';

import { useAuth } from '@/app/providers';
import { useEffect, useState } from 'react';
import {
  Users,
  ArrowLeft,
  Star,
  TrendingUp,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';

const levelNames = ['养生会员', '健康分享家', '养生顾问', '健康合伙人'];
const levelColors = [
  'bg-gray-100 text-gray-800',
  'bg-green-100 text-green-800',
  'bg-blue-100 text-blue-800',
  'bg-amber-100 text-amber-800',
];

export default function TeamPage() {
  const { user } = useAuth();
  const [downlines, setDownlines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchTeam() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/team?userId=${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setDownlines(data.downlines || []);
        }
      } catch (err) {
        console.error('加载团队失败:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchTeam();
  }, [user?.id]);

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-semibold text-gray-700 mb-4">请先登录</h2>
        <p className="text-gray-500 mb-6">您需要登录才能查看团队</p>
        <Link href="/login" className="btn-primary">
          前往登录
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/portal" className="text-gray-500 hover:text-gray-700">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">团队管理</h1>
      </div>

      <div className="card mb-6">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-100 rounded-lg">
            <Users size={24} className="text-purple-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">团队总人数</p>
            <p className="text-2xl font-bold text-gray-900">
              {downlines.length} 人
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">加载中...</p>
        </div>
      ) : downlines.length === 0 ? (
        <div className="card text-center py-12">
          <UserPlus size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-lg text-gray-500 mb-2">暂无下线</p>
          <p className="text-sm text-gray-400">
            分享您的推荐链接，邀请更多人加入
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {downlines.map((member) => (
            <div
              key={member.id}
              className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-gray-600">
                    {member.name ? member.name[0] : '?'}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">
                    {member.name || '未命名'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {member.email || member.phone || '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 sm:text-right">
                <div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      levelColors[member.agentLevel] || levelColors[0]
                    }`}
                  >
                    <Star size={12} className="mr-1" />
                    {levelNames[member.agentLevel] || levelNames[0]}
                  </span>
                </div>
                <div className="min-w-[80px]">
                  <p className="text-xs text-gray-500">业绩</p>
                  <p className="text-sm font-semibold text-gray-900">
                    NT$
                    {parseFloat(member.totalSalesVolume || 0).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

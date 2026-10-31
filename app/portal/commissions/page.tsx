'use client';

import { useAuth } from '@/app/providers';
import { useEffect, useState } from 'react';
import {
  Coins,
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

const statusLabels: Record<
  string,
  { text: string; color: string; icon: 'clock' | 'check' | 'x' }
> = {
  pending: { text: '待处理', color: 'text-amber-600 bg-amber-50', icon: 'clock' },
  paid: { text: '已发放', color: 'text-green-600 bg-green-50', icon: 'check' },
  cancelled: { text: '已取消', color: 'text-red-600 bg-red-50', icon: 'x' },
};

export default function CommissionsPage() {
  const { user } = useAuth();
  const [commissions, setCommissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCommissions() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/commissions?userId=${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setCommissions(data.commissions || []);
        }
      } catch (err) {
        console.error('加载佣金失败:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchCommissions();
  }, [user?.id]);

  const StatusIcon = ({ icon }: { icon: 'clock' | 'check' | 'x' }) => {
    if (icon === 'check') return <CheckCircle size={14} />;
    if (icon === 'x') return <XCircle size={14} />;
    return <Clock size={14} />;
  };

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-xl font-semibold text-gray-700 mb-4">请先登录</h2>
        <p className="text-gray-500 mb-6">您需要登录才能查看佣金明细</p>
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
        <h1 className="text-2xl font-bold text-gray-900">佣金明细</h1>
      </div>

      {loading ? (
        <div className="card text-center py-12">
          <p className="text-gray-500">加载中...</p>
        </div>
      ) : commissions.length === 0 ? (
        <div className="card text-center py-12">
          <Coins size={48} className="mx-auto mb-4 text-gray-300" />
          <p className="text-lg text-gray-500 mb-2">暂无佣金记录</p>
          <p className="text-sm text-gray-400">
            完成订单后，佣金将自动计算
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {commissions.map((commission) => {
            const status =
              statusLabels[commission.status] || statusLabels.pending;
            return (
              <div
                key={commission.id}
                className="card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900">
                      {commission.commissionType === 'direct'
                        ? '直接佣金'
                        : commission.commissionType === 'indirect'
                        ? '间接佣金'
                        : commission.commissionType === 'bonus'
                        ? '奖金'
                        : commission.commissionType}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                    >
                      <StatusIcon icon={status.icon} />
                      {status.text}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">
                    {commission.description || '—'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(commission.createdAt).toLocaleString('zh-TW')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-amber-600">
                    +NT${parseFloat(commission.amount).toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-400">
                    Lv.{commission.level}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

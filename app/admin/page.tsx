'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { useRouter } from 'next/navigation';
import { Package, ShoppingBag, Users, UserCheck, TrendingUp } from 'lucide-react';

interface Stats {
  productCount: number;
  orderCount: number;
  userCount: number;
  agentCount: number;
}

export default function AdminDashboard() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({ productCount: 0, orderCount: 0, userCount: 0, agentCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/login?mode=admin&next=%2Fadmin');
      return;
    }
    fetchStats();
  }, [isAdmin, router]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { label: '商品总数', value: stats.productCount, icon: Package, color: 'bg-blue-50 text-blue-600' },
    { label: '订单总数', value: stats.orderCount, icon: ShoppingBag, color: 'bg-green-50 text-green-600' },
    { label: '会员总数', value: stats.userCount, icon: Users, color: 'bg-purple-50 text-purple-600' },
    { label: '代理总数', value: stats.agentCount, icon: UserCheck, color: 'bg-amber-50 text-amber-600' },
  ];

  if (!isAdmin) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">管理后台数据看板</h1>

      {loading ? (
        <div className="text-gray-500">加载统计资料中...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="card flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${card.color}`}>
                    <Icon size={24} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">{card.label}</p>
                    <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={20} className="text-amber-600" />
                <h2 className="text-lg font-bold text-gray-900">快速入口</h2>
              </div>
              <div className="space-y-3">
                <a href="/admin/products" className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <Package size={18} className="text-gray-600" />
                    <span className="text-sm font-medium text-gray-800">商品管理</span>
                  </div>
                  <span className="text-sm text-gray-400">管理商品库存与价格</span>
                </a>
                <a href="/admin/orders" className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <ShoppingBag size={18} className="text-gray-600" />
                    <span className="text-sm font-medium text-gray-800">订单管理</span>
                  </div>
                  <span className="text-sm text-gray-400">处理订单与更新状态</span>
                </a>
                <a href="/admin/agents" className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <Users size={18} className="text-gray-600" />
                    <span className="text-sm font-medium text-gray-800">代理管理</span>
                  </div>
                  <span className="text-sm text-gray-400">调整代理等级与权限</span>
                </a>
              </div>
            </div>

            <div className="card">
              <h2 className="text-lg font-bold text-gray-900 mb-4">系统状态</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">资料库连线</span>
                  <span className="badge-green">正常</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">商城状态</span>
                  <span className="badge-green">运作中</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">佣金计算</span>
                  <span className="badge-green">自动</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

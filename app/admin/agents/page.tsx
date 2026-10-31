'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';

interface Agent {
  id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  agentLevel: number | null;
  totalSalesVolume: string | null;
  commissionBalance: string | null;
  createdAt: string;
}

const levelMap: Record<number, string> = {
  0: '养生会员',
  1: '健康分享家',
  2: '养生顾问',
  3: '健康合伙人',
};

const levelOptions = [1, 2, 3];

export default function AdminAgents() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/login?mode=admin&next=%2Fadmin%2Fagents');
      return;
    }
    fetchAgents();
  }, [isAdmin, router]);

  const fetchAgents = async () => {
    try {
      const res = await fetch('/api/admin/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(data);
      }
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLevelChange = async (agentId: number, newLevel: number) => {
    setMessage('');
    try {
      const res = await fetch('/api/admin/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agentId, agentLevel: newLevel }),
      });
      if (res.ok) {
        setMessage(`代理等级已更新`);
        fetchAgents();
      } else {
        setMessage('更新失败');
      }
    } catch (error) {
      setMessage('更新失败');
    }
  };

  if (!isAdmin) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Users size={24} className="text-amber-600" />
        <h1 className="text-2xl font-bold text-gray-900">代理管理</h1>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">{message}</div>
      )}

      <div className="card">
        {loading ? (
          <div className="text-gray-500">加载中...</div>
        ) : agents.length === 0 ? (
          <div className="text-gray-500 text-center py-8">暂无代理</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-700">ID</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-700">姓名</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-700">联系方式</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-700">等级</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-700">累积业绩</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-700">佣金余额</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-700">调整等级</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-2 text-gray-500">{agent.id}</td>
                    <td className="py-3 px-2 font-medium text-gray-900">{agent.name || '未命名'}</td>
                    <td className="py-3 px-2 text-gray-700">
                      <div>{agent.phone || '-'}</div>
                      <div className="text-xs text-gray-400">{agent.email || '-'}</div>
                    </td>
                    <td className="py-3 px-2">
                      <span className={`badge ${getLevelBadgeClass(agent.agentLevel ?? 0)}`}>
                        {levelMap[agent.agentLevel ?? 0] || '养生会员'}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right text-gray-700">
                      {agent.totalSalesVolume || '0'}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-700">
                      {agent.commissionBalance || '0'}
                    </td>
                    <td className="py-3 px-2">
                      <select
                        value={agent.agentLevel ?? 0}
                        onChange={(e) => handleLevelChange(agent.id, Number(e.target.value))}
                        className="input-field py-1 text-xs"
                      >
                        <option value={0}>养生会员</option>
                        {levelOptions.map((level) => (
                          <option key={level} value={level}>
                            {levelMap[level]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function getLevelBadgeClass(level: number) {
  switch (level) {
    case 0:
      return 'bg-gray-100 text-gray-800';
    case 1:
      return 'bg-blue-100 text-blue-800';
    case 2:
      return 'bg-purple-100 text-purple-800';
    case 3:
      return 'bg-amber-100 text-amber-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

'use client';

import { Fragment, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { useRouter } from 'next/navigation';
import { Package, Plus, Pencil, Trash2, X } from 'lucide-react';
import ProductLeadList from '@/components/ProductLeadList';

interface Product {
  id: number;
  supplierId?: number | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceTwd: string | null;
  priceCny: string | null;
  stockQuantity: number | null;
  isActive: boolean | null;
  supplierName: string | null;
  commissionRate: string | null;
  reviewStatus: string | null;
  reviewNote: string | null;
  editUrl?: string | null;
  listingType?: string | null;
  pendingRevision?: {
    submittedAt: string;
    submittedByName?: string;
    changes: Array<{ key: string; label: string; before: string; after: string }>;
  } | null;
}

const emptyForm = {
  name: '',
  description: '',
  imageUrl: '',
  priceTwd: '',
  priceCny: '',
  stockQuantity: '',
  supplierName: '',
  commissionRate: '',
  reviewStatus: 'approved',
  reviewNote: '',
};

export default function AdminProducts() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [vendorNotice, setVendorNotice] = useState('');

  useEffect(() => {
    if (!isAdmin) {
      router.replace('/login?mode=admin&next=%2Fadmin%2Fproducts');
      return;
    }
    fetchProducts();
  }, [isAdmin, router]);

  const fetchProducts = async () => {
    try {
      const res = await fetch('/api/admin/products');
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');

    const payload = {
      name: form.name,
      description: form.description || null,
      imageUrl: form.imageUrl || null,
      priceTwd: form.priceTwd ? String(form.priceTwd) : null,
      priceCny: form.priceCny ? String(form.priceCny) : null,
      stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : 0,
      supplierName: form.supplierName || null,
      commissionRate: form.commissionRate ? String(form.commissionRate) : null,
      reviewStatus: form.reviewStatus || 'approved',
      reviewNote: form.reviewNote || null,
    };

    try {
      if (editingId) {
        const res = await fetch('/api/admin/products', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
        if (res.ok) {
          setMessage('商品已更新');
          setEditingId(null);
          setForm(emptyForm);
          fetchProducts();
        } else {
          setMessage('更新失败');
        }
      } else {
        const res = await fetch('/api/admin/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setMessage('商品已新增');
          setForm(emptyForm);
          fetchProducts();
        } else {
          setMessage('新增失败');
        }
      }
    } catch (error) {
      setMessage('操作失败');
    }
  };

  const handleEdit = (product: Product) => {
    setEditingId(product.id);
    setForm({
      name: product.name || '',
      description: product.description || '',
      imageUrl: product.imageUrl || '',
      priceTwd: product.priceTwd || '',
      priceCny: product.priceCny || '',
      stockQuantity: product.stockQuantity?.toString() || '',
      supplierName: product.supplierName || '',
      commissionRate: product.commissionRate || '',
      reviewStatus: product.reviewStatus || 'pending',
      reviewNote: product.reviewNote || '',
    });
  };

  const handleReview = async (product: Product, reviewStatus: 'approved' | 'rejected') => {
    setMessage('');
    const reviewNote =
      reviewStatus === 'approved'
        ? '平台审核通过，允許公开上架'
        : prompt('请输入退回原因') || '平台退回，请厂商修正后再提交审核';
    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: product.id,
          name: product.name,
          description: product.description,
          imageUrl: product.imageUrl,
          priceTwd: product.priceTwd,
          stockQuantity: product.stockQuantity,
          supplierName: product.supplierName,
          commissionRate: product.commissionRate,
          reviewStatus,
          reviewNote,
          isActive: reviewStatus === 'approved',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (reviewStatus === 'approved') {
          setMessage('商品已审核通过並公开');
          setVendorNotice('');
        } else {
          const notice = [
            `您的商品「${product.name}」已退回补件。`,
            `退回原因：${reviewNote}`,
            data.editUrl ? `补件链接：${data.editUrl}` : '',
            '请修改后重新提交审核，平台会再次审核。',
          ].filter(Boolean).join('\n');
          setMessage(product.supplierId
            ? '商品已退回，已同步建立厂商中心通知；下方内容可作为备用人工通知。'
            : '商品已退回。此商品未绑定厂商账号，请复制下方通知给厂商。');
          setVendorNotice(notice);
        }
      } else {
        setMessage('审核失败');
      }
      fetchProducts();
    } catch {
      setMessage('审核失败');
    }
  };

  const handleRevision = async (product: Product, revisionDecision: 'approved' | 'rejected') => {
    setMessage('');
    let reviewNote = '';
    if (revisionDecision === 'rejected') {
      reviewNote = (prompt('请输入驳回修改的原因') || '').trim();
      if (!reviewNote) return;
    } else if (!confirm(`确定通过「${product.name}」的修改并套用到线上？`)) {
      return;
    }
    try {
      const res = await fetch('/api/admin/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, revisionDecision, reviewNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage(revisionDecision === 'approved' ? '修改已通过并套用到线上商品' : '修改已驳回，线上商品保持原样');
      } else {
        setMessage(data.message || data.error || '审核修改失败');
      }
      fetchProducts();
    } catch {
      setMessage('审核修改失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此商品嗎？')) return;
    try {
      const res = await fetch('/api/admin/products', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setMessage('商品已删除');
        fetchProducts();
      } else {
        setMessage('删除失败');
      }
    } catch (error) {
      setMessage('删除失败');
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
    setMessage('');
  };

  if (!isAdmin) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Package size={24} className="text-amber-600" />
        <h1 className="text-2xl font-bold text-gray-900">商品管理</h1>
      </div>

      {message && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">{message}</div>
      )}

      {vendorNotice && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-2 font-bold">厂商退回通知内容</div>
          <pre className="whitespace-pre-wrap rounded-lg bg-white p-3 text-slate-700">{vendorNotice}</pre>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(vendorNotice)}
            className="mt-3 rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700"
          >
            复制通知
          </button>
        </div>
      )}

      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Plus size={18} />
          <h2 className="text-lg font-bold text-gray-900">
            {editingId ? '编辑商品' : '新增商品'}
          </h2>
          {editingId && (
            <button onClick={cancelEdit} className="ml-auto text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">厂商名称</label>
            <input
              type="text"
              value={form.supplierName}
              onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
              className="input-field"
              placeholder="厂商 / 联系人"
            />
          </div>
          <div>
            <label className="label">推荐人利润 %</label>
            <input
              type="number"
              value={form.commissionRate}
              onChange={(e) => setForm({ ...form, commissionRate: e.target.value })}
              className="input-field"
              placeholder="例如 30"
              min="0"
              max="100"
              step="0.01"
            />
          </div>
          <div>
            <label className="label">审核状态</label>
            <select
              value={form.reviewStatus}
              onChange={(e) => setForm({ ...form, reviewStatus: e.target.value })}
              className="input-field"
            >
              <option value="pending">待审核</option>
              <option value="approved">通过上架</option>
              <option value="rejected">退回</option>
            </select>
          </div>
          <div>
            <label className="label">审核备注</label>
            <input
              type="text"
              value={form.reviewNote}
              onChange={(e) => setForm({ ...form, reviewNote: e.target.value })}
              className="input-field"
              placeholder="审核意見"
            />
          </div>
          <div>
            <label className="label">商品名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field"
              placeholder="输入商品名称"
              required
            />
          </div>
          <div>
            <label className="label">图片 URL</label>
            <input
              type="text"
              value={form.imageUrl}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              className="input-field"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="label">价格（TWD）</label>
            <input
              type="number"
              value={form.priceTwd}
              onChange={(e) => setForm({ ...form, priceTwd: e.target.value })}
              className="input-field"
              placeholder="0"
              min="0"
            />
          </div>
          <div>
            <label className="label">价格（CNY）</label>
            <input
              type="number"
              value={form.priceCny}
              onChange={(e) => setForm({ ...form, priceCny: e.target.value })}
              className="input-field"
              placeholder="0"
              min="0"
            />
          </div>
          <div>
            <label className="label">库存数量</label>
            <input
              type="number"
              value={form.stockQuantity}
              onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })}
              className="input-field"
              placeholder="0"
              min="0"
            />
          </div>
          <div className="md:col-span-2">
            <label className="label">商品描述</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field"
              rows={3}
              placeholder="输入商品描述..."
            />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary">
              {editingId ? '更新商品' : '新增商品'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="text-lg font-bold text-gray-900 mb-4">商品列表</h2>
        {loading ? (
          <div className="text-gray-500">加载中...</div>
        ) : products.length === 0 ? (
          <div className="text-gray-500 text-center py-8">暂无商品</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-700">ID</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-700">名称</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-700">厂商</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-700">利润%</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-700">TWD</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-700">CNY</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-700">库存</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-700">状态</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <Fragment key={product.id}>
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-2 text-gray-500">{product.id}</td>
                    <td className="py-3 px-2 font-medium text-gray-900">{product.name}{product.listingType === 'shared_device' ? <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800">共享设备</span> : null}</td>
                    <td className="py-3 px-2 text-gray-700">{product.supplierName || '-'}</td>
                    <td className="py-3 px-2 text-right text-gray-700">{product.commissionRate || '0'}</td>
                    <td className="py-3 px-2 text-right text-gray-700">{product.listingType === 'shared_device' ? '-' : (product.priceTwd || '-')}</td>
                    <td className="py-3 px-2 text-right text-gray-700">{product.listingType === 'shared_device' ? '投放合作' : (product.priceCny || '-')}</td>
                    <td className="py-3 px-2 text-right text-gray-700">{product.listingType === 'shared_device' ? '-' : (product.stockQuantity ?? 0)}</td>
                    <td className="py-3 px-2">
                      {product.reviewStatus === 'approved' && product.isActive ? <span className="badge-green">审核通过 / 上架中</span> : null}
                      {product.reviewStatus === 'pending' ? <span className="badge-amber">待审核</span> : null}
                      {product.reviewStatus === 'rejected' ? <span className="badge-red">已退回</span> : null}
                      {!product.reviewStatus && !product.isActive ? <span className="badge-gray">已下架</span> : null}
                      {product.pendingRevision ? <span className="badge-amber ml-1">修改待审</span> : null}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {product.reviewStatus === 'pending' && (
                        <>
                          <button
                            onClick={() => handleReview(product, 'approved')}
                            className="mr-3 text-green-600 hover:text-green-700"
                          >
                            通过
                          </button>
                          <button
                            onClick={() => handleReview(product, 'rejected')}
                            className="mr-3 text-red-500 hover:text-red-600"
                          >
                            退回
                          </button>
                        </>
                      )}
                      {product.reviewStatus === 'rejected' && product.editUrl && (
                        <a
                          href={product.editUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mr-3 text-cyan-700 hover:text-cyan-800"
                        >
                          补件链接
                        </a>
                      )}
                      <button
                        onClick={() => handleEdit(product)}
                        className="text-amber-600 hover:text-amber-700 mr-3"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDelete(product.id)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                  {product.pendingRevision ? (
                    <tr className="border-b border-amber-100 bg-amber-50/60">
                      <td colSpan={9} className="px-2 py-3">
                        <div className="text-xs font-bold text-amber-900">
                          品牌提交的修改（线上仍显示当前版本）· {product.pendingRevision.submittedByName || '品牌'} · {new Date(product.pendingRevision.submittedAt).toLocaleString('zh-CN', { hour12: false })}
                        </div>
                        <div className="mt-2 grid gap-1">
                          {product.pendingRevision.changes.map((change) => (
                            <div key={change.key} className="grid grid-cols-[7rem_1fr] gap-2 text-xs md:grid-cols-[8rem_1fr_1fr]">
                              <span className="font-semibold text-gray-700">{change.label}</span>
                              <span className="break-all text-gray-500 line-through">{change.before}</span>
                              <span className="break-all font-semibold text-gray-900 md:col-start-3 col-start-2">{change.after}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex gap-3">
                          <button onClick={() => handleRevision(product, 'approved')} className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700">通过修改并套用</button>
                          <button onClick={() => handleRevision(product, 'rejected')} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50">驳回修改</button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProductLeadList scope="admin" title="投放合作留资（共享设备）" />
    </div>
  );
}

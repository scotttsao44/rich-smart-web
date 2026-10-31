'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';

const csvHeader = '厂商名称,联系人,联系电话,客服账号,微信 ID,Email,商品名称,售价CNY,库存数量,推荐人利润%,商品图片URL,产品详细页内容';

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, ''));
}

export default function VendorProductBulkPage() {
  const [csv, setCsv] = useState(csvHeader);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const uploadFile = async (file: File | null) => {
    if (!file) return;
    setCsv(await file.text());
  };

  const submit = async () => {
    setSubmitting(true);
    setMessage('');
    try {
      const res = await fetch('/api/vendor/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || '批量提交审核失败');
      setMessage(`已提交 ${data.count || 0} 笔商品，品牌商品清单已更新。`);
    } catch (error: any) {
      setMessage(error.message || '批量提交审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/vendor" className="font-bold text-cyan-700">返回厂商中心</Link>
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-8 w-8 text-emerald-700" />
          <div>
            <h1 className="text-3xl font-black text-slate-950">批量发布商品</h1>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a href="/api/vendor/products/template" className="btn-outline">下载 CSV 模板</a>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 font-bold text-slate-800">
            <Upload className="h-4 w-4" />
            上传 CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => uploadFile(event.target.files?.[0] || null)} />
          </label>
        </div>

        <textarea
          className="mt-5 min-h-[320px] w-full rounded-2xl border border-slate-200 p-4 font-mono text-sm"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
        />
        {message ? <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">{message}</div> : null}
        <button onClick={submit} disabled={submitting || csv.trim().split(/\r?\n/).length < 2} className="btn-primary mt-5 disabled:cursor-not-allowed disabled:opacity-50">
          {submitting ? '提交中...' : '提交批量审核'}
        </button>
        {message ? <Link href="/vendor" className="ml-3 inline-flex font-bold text-cyan-700">回商品清单</Link> : null}
      </div>
    </main>
  );
}

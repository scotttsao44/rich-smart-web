'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Save, SearchCheck } from 'lucide-react';

type Outcome = 'manual_match' | 'manual_mismatch' | 'unverified';
type RecordEntry = {
  id: string; applicationId: number; snapshotId: string; outcome: Outcome; stale: boolean; sourceUrl: string; evidenceNote: string;
  checkedCompanyName: string; checkedRegistrationNo: string; checkedAt: string; checkedBy: number;
};
type ReviewData = {
  applicationId: number; snapshotId: string; records: RecordEntry[];
  officialSources: Array<{ id: string; label: string; url: string }>;
};
const labels: Record<Outcome, string> = { manual_match: '公司主体人工核对一致', manual_mismatch: '资料有差异', unverified: '无法核实' };
const fieldClass = 'mt-1 w-full min-w-0 rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-950';
const officialEntryUrls = new Set(['https://www.gsxt.gov.cn/index.html', 'https://www.nmpa.gov.cn/ylqx/', 'https://ggfw.cnipa.gov.cn/']);
function validRecord(value: unknown): value is RecordEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return ['id', 'snapshotId', 'sourceUrl', 'evidenceNote', 'checkedCompanyName', 'checkedRegistrationNo', 'checkedAt'].every(key => typeof row[key] === 'string')
    && typeof row.applicationId === 'number' && Number.isSafeInteger(row.applicationId) && row.applicationId > 0
    && typeof row.id === 'string' && row.id.length > 0 && typeof row.stale === 'boolean'
    && typeof row.outcome === 'string' && Object.hasOwn(labels, row.outcome)
    && typeof row.checkedBy === 'number' && Number.isSafeInteger(row.checkedBy) && row.checkedBy > 0
    && typeof row.checkedAt === 'string' && Number.isFinite(Date.parse(row.checkedAt));
}

export default function BrandDocumentReview({ applicationId, canReview = false }: { applicationId: number; canReview?: boolean }) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('unverified');
  const [company, setCompany] = useState('');
  const [registration, setRegistration] = useState('');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const pending = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError(''); setData(null);
    try {
      const response = await fetch(`/api/cn/brand-document-reviews?applicationId=${applicationId}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '读取查证记录失败');
      if (!body || body.applicationId !== applicationId || typeof body.snapshotId !== 'string' || !body.snapshotId || !Array.isArray(body.records)
        || !body.records.every((item: unknown) => validRecord(item) && item.applicationId === applicationId && item.stale === (item.snapshotId !== body.snapshotId))
        || !Array.isArray(body.officialSources) || !body.officialSources.every((item: unknown) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' && typeof (item as { label?: unknown }).label === 'string' && officialEntryUrls.has((item as { url: string }).url))) throw new Error('查证记录格式不完整');
      if (generation.current === current) setData(body);
    } catch (reason) {
      if (generation.current === current) setError(reason instanceof Error ? reason.message : '读取失败，请重试');
    } finally { if (generation.current === current) setLoading(false); }
  }, [applicationId]);
  useEffect(() => { setNotice(''); setCompany(''); setRegistration(''); setSource(''); setNote(''); setOutcome('unverified'); void load(); return () => { generation.current++; }; }, [load]);
  const save = async () => {
    if (!data || pending.current) return;
    pending.current = true; setSaving(true); setError(''); setNotice('');
    const current = generation.current;
    try {
      const response = await fetch('/api/cn/brand-document-reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, snapshotId: data.snapshotId, outcome, sourceUrl: source, evidenceNote: note, checkedCompanyName: company, checkedRegistrationNo: registration }),
      });
      const body = await response.json();
      if (generation.current !== current) return;
      if (!response.ok) {
        if (response.status === 409) { await load(); throw new Error('申请资料已经变更，已重新读取。请核对新资料后再保存。'); }
        throw new Error(body.error || '保存查证记录失败');
      }
      if (!validRecord(body?.record) || body.record.applicationId !== applicationId || body.record.snapshotId !== data.snapshotId || body.record.outcome !== outcome) throw new Error('保存回执不完整，请重新读取查证记录确认，勿重复提交。');
      await load(); if (generation.current === current + 1) setNotice('查证记录已保存；品牌审核状态未改变。');
    } catch (reason) { if (generation.current === current || generation.current === current + 1) setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { pending.current = false; setSaving(false); }
  };
  return <section className="mt-5 min-w-0 border-t border-stone-200 pt-4" aria-label="独立资料查证">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-base font-bold"><SearchCheck className="h-5 w-5 shrink-0" />独立资料查证</h3>
      <button type="button" aria-label="重新读取查证记录" title="重新读取查证记录" onClick={() => void load()} disabled={loading || saving} className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-stone-300 disabled:opacity-50"><RefreshCw className="h-4 w-4" /></button>
    </div>
    <p className="mt-2 text-sm text-stone-600">人工核对记录，不是系统已向官方验证文件真伪。资料一致不代表文件真实，查无资料也不直接认定造假。</p>
    {loading ? <p role="status" className="mt-3 text-sm">读取中…</p> : null}
    {error ? <p role="alert" className="mt-3 break-words text-sm text-red-700">{error}</p> : null}
    {notice ? <p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p> : null}
    {data ? <>
      {canReview ? <>
        <nav aria-label="官方查询入口" className="my-3 flex flex-wrap gap-x-4 gap-y-2">{data.officialSources.map(item => <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-teal-800">{item.label}<ExternalLink className="h-3.5 w-3.5" /></a>)}</nav>
        <fieldset disabled={saving || loading} className="mt-3 min-w-0 space-y-3">
          <legend className="text-sm font-bold">新增平台核验记录 · 公司主体</legend>
          <label className="block text-sm">核验结果<select className={fieldClass} value={outcome} onChange={event => setOutcome(event.target.value as Outcome)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-sm">查到的公司名称<input value={company} maxLength={200} onChange={event => setCompany(event.target.value)} className={fieldClass} /></label>
            <label className="min-w-0 text-sm">查到的统一社会信用代码<input value={registration} maxLength={100} onChange={event => setRegistration(event.target.value)} className={fieldClass} /></label>
          </div>
          <label className="block text-sm">官方查证来源网址<input type="url" value={source} maxLength={2000} onChange={event => setSource(event.target.value)} className={fieldClass} /></label>
          <label className="block text-sm">查证依据／具体差异<textarea rows={3} maxLength={4000} value={note} onChange={event => setNote(event.target.value)} className={fieldClass} /></label>
          <button type="button" onClick={() => void save()} disabled={!note.trim()} className="inline-flex min-h-10 items-center gap-2 rounded bg-teal-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? '保存中…' : '保存核验记录'}</button>
        </fieldset>
      </> : null}
      <div className="mt-4 divide-y divide-stone-200">
        {!data.records.length ? <p className="py-3 text-sm text-stone-600">尚无平台核验记录。</p> : data.records.map(record => <article key={record.id} className="min-w-0 py-3 text-sm [overflow-wrap:anywhere]">
          <div className={`font-bold ${record.stale ? 'text-amber-800' : record.outcome === 'manual_mismatch' ? 'text-red-700' : 'text-stone-900'}`}>{record.stale ? '申请资料已变更 · 需重新核验' : labels[record.outcome] || '无法核实'}</div>
          <div className="mt-1 text-xs text-stone-500">平台核验人员 {record.checkedBy} · {record.checkedAt}</div>
          <dl className="mt-2 grid min-w-0 gap-x-3 gap-y-1 sm:grid-cols-[110px_minmax(0,1fr)]"><dt className="text-stone-500">查到的公司</dt><dd>{record.checkedCompanyName || '未提供'}</dd><dt className="text-stone-500">查到的代码</dt><dd>{record.checkedRegistrationNo || '未提供'}</dd><dt className="text-stone-500">查证来源</dt><dd>{record.sourceUrl || '未提供'}</dd><dt className="text-stone-500">依据／差异</dt><dd className="whitespace-pre-wrap">{record.evidenceNote}</dd></dl>
        </article>)}
      </div>
    </> : null}
  </section>;
}

'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Download, FileText, LockKeyhole, Pencil, Save, X } from 'lucide-react';
import type { IntakeFileRecord } from '@/lib/cn-brand-intake-brain';
import {
  BRAND_FIELDS, COMPANY_FIELDS, DOCUMENT_KIND_LABELS, FIELD_LABELS, PART_LABELS, ROLE_LABELS,
  assertConfirmedCompanyResponse, canChooseCompany, candidateActionError, candidateNeedsReplacement, companyFileMatchesOwner,
  confirmedCompanyAttachment, confirmedResponseField, confirmedSectionResponseField, displayConfidence, hasConfirmedCompany, isSensitiveIntakeFile,
  safeCandidateSources, sectionCandidateFields, sourceCaption, visibleCandidateFields,
  type ApplicationCandidateValues, type CandidateApplicationAttachment, type CandidateEntity, type CandidateField, type CandidateIntakeState,
} from '@/lib/brand-intake-candidate-ui';

type Props = {
  intake: CandidateIntakeState;
  currentValues: ApplicationCandidateValues;
  disabled?: boolean;
  onStateChange: (state: CandidateIntakeState) => void;
  onApply: (values: ApplicationCandidateValues, expectedCurrent: ApplicationCandidateValues) => void;
  onCompanyAttachment: (attachment: CandidateApplicationAttachment, expectedToken: string) => void;
};
type FieldProps = {
  fieldKey: string;
  field: CandidateField;
  files: IntakeFileRecord[];
  currentValue?: string;
  disabled?: boolean;
  editable?: boolean;
  applyToForm?: boolean;
  reviewRequired?: boolean;
  onSave?: (value: string) => Promise<void>;
};
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded border border-teal-700 bg-white px-3 py-2 text-sm font-bold text-teal-800 disabled:cursor-not-allowed disabled:opacity-40';
const inputClass = 'w-full min-w-0 rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-950 focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700';
const statusLabels: Record<string, string> = { confirmed: '已确认', conflict: '来源冲突', rejected: '待补充', ai_processing: '识别中', needs_confirmation: '待确认', incomplete: '待补充', approved: '已审核', reviewing: '审核中', missing: '未提供' };

function CandidateFieldEditor({ fieldKey, field, files, currentValue, disabled, editable, applyToForm = true, reviewRequired, onSave }: FieldProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.value);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const sources = safeCandidateSources(field, files).filter(source => source.extractor !== 'user');
  const differs = candidateNeedsReplacement(currentValue, value);
  const locked = field.validationStatus === 'confirmed';
  const save = async () => {
    if (!onSave || !value.trim() || (differs && !replace) || disabled || busy || saving.current) return;
    saving.current = true;
    setBusy(true); setError('');
    try { await onSave(value.trim()); setEditing(false); setReplace(false); }
    catch (error) { setError(candidateActionError(error instanceof Error ? error.message : '保存失败，请重试。')); }
    finally { saving.current = false; setBusy(false); }
  };
  return <div className="min-w-0 border-t border-stone-200 py-3" data-candidate-field={fieldKey}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold"><span>{FIELD_LABELS[fieldKey] || fieldKey}</span>{field.role ? <span className="text-xs font-normal text-stone-500">{ROLE_LABELS[field.role] || '文件资料'}</span> : null}</div>
      <span className={`text-xs font-semibold ${locked && !reviewRequired ? 'text-emerald-800' : 'text-amber-800'}`}>{locked ? reviewRequired ? '人工已保存 · 待核对' : '已确认' : field.validationStatus === 'conflict' ? '来源冲突' : field.confidence < 0.85 ? '低信心 · 待确认' : '待确认'} · {displayConfidence(field.confidence)}</span>
    </div>
    {editing ? <textarea aria-label={`更正${FIELD_LABELS[fieldKey] || fieldKey}`} rows={2} value={value} onChange={event => { setValue(event.target.value); setReplace(false); }} disabled={busy} className={`${inputClass} mt-2`} /> : <div className="mt-1 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{field.value}</div>}
    {sources.length ? <details className="mt-2 text-xs text-stone-500"><summary className="cursor-pointer break-words [overflow-wrap:anywhere]">来源：{sourceCaption(sources[0])}{sources.length > 1 ? ` · ${sources.length} 处` : ''}</summary><ul className="mt-2 space-y-2">{sources.map((source, index) => <li key={`${source.sourceFileId}-${source.page}-${index}`} className="break-words [overflow-wrap:anywhere]"><div>{sourceCaption(source)} · {displayConfidence(source.confidence)}</div><blockquote className="mt-1 border-l-2 border-stone-200 pl-2 whitespace-pre-wrap">{source.rawText.slice(0, 600)}</blockquote></li>)}</ul></details> : <div className="mt-1 text-xs text-amber-800">原文来源待补充</div>}
    {editable && onSave ? <div className="mt-2">
      {differs ? <div className="mb-2 text-xs text-amber-900"><div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">申请表当前值：{currentValue}</div><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} disabled={busy || disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700" />确认仅替换这一栏</label></div> : null}
      <div className="flex flex-wrap gap-2">
        {!reviewRequired || !editing ? <button type="button" className={buttonClass} onClick={() => { setValue(field.value); setEditing(!editing); setError(''); }} disabled={disabled || busy || locked}><Pencil className="h-4 w-4" />更正</button> : null}
        <button type="button" className={buttonClass} onClick={() => void save()} disabled={disabled || busy || !value.trim() || (reviewRequired && value.trim().length > 2000) || (differs && !replace) || (locked && (!applyToForm || !sameValue(field.value, value)))}>{reviewRequired ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}{busy ? '保存中...' : reviewRequired ? locked ? '已保存' : '保存' : locked ? applyToForm ? '填入申请表' : '已确认' : '确认此栏'}</button>
        {reviewRequired && editing ? <button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => { setValue(field.value); setEditing(false); setReplace(false); setError(''); }}><X className="h-4 w-4" />取消</button> : null}
      </div>
    </div> : null}
    {error ? <p role="alert" className="mt-2 break-words text-sm text-red-700">{error}</p> : null}
  </div>;
}

function sameValue(left: string, right: string) { return left.trim() === right.trim(); }

export default function BrandIntakeCandidates({ intake, currentValues, disabled: externallyDisabled, onStateChange, onApply, onCompanyAttachment }: Props) {
  const [tab, setTab] = useState<'files' | 'brand' | 'products'>('files');
  const [selectedCompanyFile, setSelectedCompanyFile] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [replaceIdentity, setReplaceIdentity] = useState(false);
  const [replaceAttachment, setReplaceAttachment] = useState(false);
  const [confirmingCompany, setConfirmingCompany] = useState(false);
  const [companyError, setCompanyError] = useState('');
  const [notice, setNotice] = useState('');
  const [manualKinds, setManualKinds] = useState<Record<string, string>>({});
  const [kindSaving, setKindSaving] = useState('');
  const [kindErrors, setKindErrors] = useState<Record<string, string>>({});
  const [sectionSaving, setSectionSaving] = useState('');
  const sectionSavePending = useRef(false);
  const disabled = externallyDisabled || Boolean(sectionSaving);
  const currentCompany = hasConfirmedCompany(intake);

  const patch = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/cn/brand-intake', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...(intake.brandId ? { brandId: intake.brandId } : {}) }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(candidateActionError(result?.error));
    if (!result?.intake || !Array.isArray(result.intake.files) || !result.intake.company || result.intake.memberId !== intake.memberId) throw new Error('保存结果不完整，请重新读取资料。');
    return result.intake as CandidateIntakeState;
  };

  const confirmFileField = async (file: IntakeFileRecord, key: string, value: string, company = false) => {
    setNotice('');
    const next = await patch({ action: company ? 'confirm_company_field' : 'confirm_document_field', fileId: file.id, field: key, value });
    const updated = next.files.find(item => item.id === file.id);
    const field = company ? updated?.companyDraft?.[key] : updated?.documentDraft?.[key];
    if (!field || field.validationStatus !== 'confirmed' || !sameValue(field.value, value)) throw new Error('字段未保存，请重试。');
    if (company) confirmedResponseField(next, 'company', key, value);
    onStateChange(next);
    if (company) onApply({ [key]: field.value }, currentValues);
    setNotice(company ? '公司此栏已确认并填入申请表。' : '文件此栏已确认，原件保留。');
  };

  const confirmSectionField = async (file: IntakeFileRecord, sectionIndex: number, key: string, value: string) => {
    if (disabled || sectionSavePending.current) throw new Error('资料正在保存，请稍后重试。');
    sectionSavePending.current = true;
    setSectionSaving(`${file.id}:${sectionIndex}:${key}`); setNotice('');
    try {
      const next = await patch({ action: 'confirm_document_section_field', fileId: file.id, sectionIndex, field: key, value });
      confirmedSectionResponseField(next, file, sectionIndex, key, value);
      onStateChange(next);
      setNotice('片段此栏已保存，仍待核对。');
    } finally { sectionSavePending.current = false; setSectionSaving(''); }
  };

  const saveManualKind = async (file: IntakeFileRecord) => {
    const kind = manualKinds[file.id];
    if (!kind || kindSaving || disabled) return;
    setKindSaving(file.id); setKindErrors(current => ({ ...current, [file.id]: '' })); setNotice('');
    try {
      const next = await patch({ action: 'set_document_kind', fileId: file.id, kind });
      if (next.files.find(item => item.id === file.id)?.manualKind !== kind) throw new Error('人工标记未保存，请重试。');
      onStateChange(next); setNotice('人工标记已保存，仍待核对。');
    } catch (error) { setKindErrors(current => ({ ...current, [file.id]: candidateActionError(error instanceof Error ? error.message : '') })); }
    finally { setKindSaving(''); }
  };

  const confirmField = async (entity: CandidateEntity, key: string, value: string, productDraftId?: string) => {
    setNotice('');
    const existing = entity === 'product' ? intake.productDrafts.find(product => product.id === productDraftId) : null;
    const draft = entity === 'product' ? key === 'title' ? existing?.title : existing?.fields[key] : intake[entity][key];
    if (!draft || (draft.validationStatus === 'confirmed' && !sameValue(draft.value, value))) throw new Error('已确认的字段不能覆盖，请联系平台核对。');
    const next = await patch({ entity, field: key, value, ...(productDraftId ? { productDraftId } : {}) });
    const confirmed = confirmedResponseField(next, entity, key, value, productDraftId);
    onStateChange(next);
    if (entity !== 'product') onApply({ [key]: confirmed }, currentValues);
    setNotice(entity === 'product' ? '商品草稿字段已确认，尚未上架。' : '此栏已确认并填入申请表。');
  };

  const chooseCompany = (file: IntakeFileRecord) => {
    setSelectedCompanyFile(file.id); setCompanyName(file.companyDraft?.companyName?.value || '');
    setRegistrationNo(file.companyDraft?.registrationNo?.value || ''); setReplaceIdentity(false); setReplaceAttachment(false); setCompanyError(''); setNotice('');
  };
  const identityDiffers = candidateNeedsReplacement(currentValues.companyName, companyName) || candidateNeedsReplacement(currentValues.registrationNo, registrationNo);
  const confirmCompany = async () => {
    const file = intake.files.find(file => file.id === selectedCompanyFile);
    if (!file || !canChooseCompany(file, intake) || (identityDiffers && !replaceIdentity) || (currentValues.businessLicenseDocument && !replaceAttachment)) return;
    setConfirmingCompany(true); setCompanyError(''); setNotice('');
    try {
      const next = await patch({ action: 'confirm_company_document', fileId: file.id, companyName: companyName.trim(), registrationNo: registrationNo.trim().toUpperCase() });
      const values = assertConfirmedCompanyResponse(next, file.id, companyName.trim(), registrationNo.trim());
      const attachment = confirmedCompanyAttachment(next, file.id);
      onStateChange(next); onApply(values, currentValues);
      if (attachment) onCompanyAttachment(attachment, currentValues.businessLicenseDocument || '');
      setSelectedCompanyFile(''); setNotice(attachment ? '公司主体已确认，证件已列入申请附件，仍待审核。' : '公司主体已确认；提交前仍需单独上传主体证件。');
    } catch (error) { setCompanyError(candidateActionError(error instanceof Error ? error.message : '公司主体确认失败。')); }
    finally { setConfirmingCompany(false); }
  };

  const tabs = [{ id: 'files', label: '文件候选', count: intake.files.length }, { id: 'brand', label: '品牌字段', count: visibleCandidateFields(intake.brand, intake.files).length }, { id: 'products', label: '商品草稿', count: intake.productDrafts.length }] as const;
  return <div className="mt-5 min-w-0" data-testid="brand-intake-candidates">
    {currentCompany ? <div className="mb-4 flex min-w-0 items-start gap-2 border-l-2 border-emerald-700 pl-3 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /><div className="min-w-0 break-words [overflow-wrap:anywhere]"><strong>已确认申请公司</strong><div>{intake.company.companyName.value}</div><div className="text-xs text-stone-500">{intake.company.registrationNo.value}</div></div></div> : <p className="mb-3 text-sm font-bold text-amber-800">申请公司待选择与确认</p>}
    <div className="flex w-full border-b border-stone-200" role="tablist" aria-label="资料候选类型">{tabs.map(item => <button type="button" role="tab" key={item.id} aria-selected={tab === item.id} aria-controls={`intake-${item.id}-panel`} id={`intake-${item.id}-tab`} onClick={() => setTab(item.id)} className={`min-h-11 min-w-0 flex-1 border-b-2 px-2 py-2 text-sm font-bold sm:flex-none sm:px-5 ${tab === item.id ? 'border-teal-700 text-teal-800' : 'border-transparent text-stone-500'}`}>{item.label}<span className="ml-1 text-xs">{item.count}</span></button>)}</div>
    {notice ? <p role="status" className="mt-3 text-sm font-semibold text-emerald-800">{notice}</p> : null}
    {tab === 'files' ? <div role="tabpanel" id="intake-files-panel" aria-labelledby="intake-files-tab" className="divide-y divide-stone-200">
      {!intake.files.length ? <p className="py-5 text-sm text-stone-500">还没有资料，请上传文件。</p> : intake.files.map(file => {
        const sensitive = isSensitiveIntakeFile(file);
        const fileFields = sensitive ? [] : visibleCandidateFields(file.documentDraft, intake.files);
        const companyFields = sensitive ? [] : visibleCandidateFields(file.companyDraft, intake.files);
        const hasSectionFields = file.kind === 'mixed_document' && file.identification?.sections.some((_, index) => sectionCandidateFields(file, index, intake.files).length > 0);
        const ownerFile = companyFileMatchesOwner(file, intake);
        const eligible = canChooseCompany(file, intake);
        const otherCompany = file.companyContentMatched && currentCompany && !ownerFile;
        const duplicate = intake.files.find(other => other.id === file.duplicateOf);
        return <article key={file.id} className="min-w-0 py-4" data-file-id={file.id}>
          <div className="flex min-w-0 items-start gap-2"><FileText className="mt-1 h-5 w-5 shrink-0 text-teal-700" /><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-bold [overflow-wrap:anywhere]">{file.originalName}</h3><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500"><span>{Math.max(1, Math.round(file.size / 1024))} KB</span>{file.pageCount ? <span>{file.pageCount} 页</span> : null}<span>{sensitive ? '敏感资料' : DOCUMENT_KIND_LABELS[file.kind] || '未识别'}</span><span>{statusLabels[file.status] || '待核对'}</span><span>{PART_LABELS[file.identification?.part || 'unknown'] || PART_LABELS.unknown}</span></div></div>{!sensitive ? <a href={`/api/cn/brand-intake?fileId=${encodeURIComponent(file.id)}${intake.brandId ? `&brandId=${intake.brandId}` : ''}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-stone-300 text-stone-600" aria-label={`下载原件 ${file.originalName}`} title="下载原件"><Download className="h-4 w-4" /></a> : null}</div>
          {duplicate ? <p className="mt-2 break-words text-xs text-amber-800 [overflow-wrap:anywhere]">内容重复：{duplicate.originalName}。两份原件均保留。</p> : null}
          {file.relatedFiles?.length ? <p className="mt-2 break-words text-xs text-stone-500 [overflow-wrap:anywhere]">相关资料：{file.relatedFiles.map(id => intake.files.find(other => other.id === id)?.originalName).filter(Boolean).join('、')}</p> : null}
          {sensitive ? <p className="mt-3 flex items-center gap-2 text-sm text-amber-900"><LockKeyhole className="h-4 w-4 shrink-0" />敏感资料已保留，不展示内容或作为商品资料。</p> : <>
            {file.identification?.sensitivePages.length ? <p className="mt-2 text-xs font-semibold text-amber-800">包含敏感页面，不展示这些页面的内容。</p> : null}
            {file.identification?.filenamePartHint && file.identification.filenamePartHint !== file.identification.part ? <p className="mt-2 text-xs text-amber-800">文件名提示{file.identification.filenamePartHint === 'draft' ? '草稿' : '封面'}，内容版本仍待核对。</p> : null}
            {file.coverage?.unreadPages.length ? <p className="mt-2 text-xs text-amber-800">第 {file.coverage.unreadPages.join('、')} 页尚未读出，需核对原件。</p> : null}
            {file.kind === 'unknown' ? <p className="mt-2 text-sm text-amber-900">原件已保留，类型与内容待人工核对。</p> : null}
            {file.manualKind ? <p className="mt-2 text-xs font-bold text-amber-800">人工标记：{DOCUMENT_KIND_LABELS[file.manualKind] || '待确认资料'} · 待核对</p> : null}
            <div className="mt-3 flex min-w-0 flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-bold sm:max-w-xs">人工标记类型<select aria-label={`人工标记类型 ${file.originalName}`} className={`${inputClass} mt-1`} value={manualKinds[file.id] ?? file.manualKind ?? ''} onChange={event => setManualKinds(current => ({ ...current, [file.id]: event.target.value }))} disabled={disabled || Boolean(kindSaving)}><option value="">选择类型（待核对）</option>{Object.entries(DOCUMENT_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><button type="button" className={buttonClass} onClick={() => void saveManualKind(file)} disabled={disabled || Boolean(kindSaving) || !manualKinds[file.id] || manualKinds[file.id] === file.manualKind}><Save className="h-4 w-4" />{kindSaving === file.id ? '保存中...' : '保存标记'}</button></div>
            {kindErrors[file.id] ? <p role="alert" className="mt-2 text-sm text-red-700">{kindErrors[file.id]}</p> : null}
            {file.assetCandidate ? <p className="mt-2 text-sm text-stone-600">图片素材候选 · 未关联商品</p> : null}
            {file.companyOwnerStatus === 'conflict' || otherCompany ? <p className="mt-2 flex items-center gap-2 text-sm font-bold text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" />公司与已确认主体不同，不能替换。</p> : null}
            {eligible ? <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-bold text-teal-800"><input type="radio" name="intake-company-file" checked={selectedCompanyFile === file.id} disabled={disabled || confirmingCompany} onChange={() => chooseCompany(file)} className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700" />{ownerFile ? '核对当前公司主体' : '选择此公司作为申请主体'}</label> : null}
            {selectedCompanyFile === file.id ? <div className="mt-3 border-l-2 border-teal-700 pl-3">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="min-w-0 text-xs font-bold">公司名称<input aria-label="确认公司名称" className={`${inputClass} mt-1`} value={companyName} onChange={event => { setCompanyName(event.target.value); setReplaceIdentity(false); }} disabled={confirmingCompany || currentCompany} /></label><label className="min-w-0 text-xs font-bold">统一社会信用代码<input aria-label="确认统一社会信用代码" className={`${inputClass} mt-1`} value={registrationNo} readOnly /></label></div>
              {identityDiffers ? <div className="mt-3 break-words text-xs text-amber-900 [overflow-wrap:anywhere]"><div>申请表当前公司：{currentValues.companyName || '未填写'} · {currentValues.registrationNo || '未填写'}</div><label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={replaceIdentity} onChange={event => setReplaceIdentity(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700" disabled={confirmingCompany} />确认仅替换申请表的公司名称与代码</label></div> : null}
              {currentValues.businessLicenseDocument ? <label className="mt-3 flex items-start gap-2 text-xs text-amber-900"><input type="checkbox" checked={replaceAttachment} onChange={event => setReplaceAttachment(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700" disabled={confirmingCompany} />以所选公司的证件作为主体申请附件，旧原件保留</label> : null}
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={disabled || confirmingCompany || !companyName.trim() || !registrationNo || (identityDiffers && !replaceIdentity) || Boolean(currentValues.businessLicenseDocument && !replaceAttachment)} onClick={() => void confirmCompany()}><Check className="h-4 w-4" />{confirmingCompany ? '确认中...' : '确认公司主体'}</button><button type="button" className={buttonClass} onClick={() => { setSelectedCompanyFile(''); setCompanyError(''); }} disabled={confirmingCompany}><X className="h-4 w-4" />取消</button></div>
              {companyError ? <p role="alert" className="mt-2 text-sm text-red-700">{companyError}</p> : null}
            </div> : null}
            {companyFields.length ? <details className="mt-3" open={selectedCompanyFile === file.id || ownerFile}><summary className="cursor-pointer text-sm font-bold">公司候选字段 · {companyFields.length}</summary>{companyFields.map(([key, field]) => <CandidateFieldEditor key={`${key}-${field.value}`} fieldKey={key} field={field} files={intake.files} currentValue={currentValues[key]} disabled={disabled} editable={ownerFile && !['companyName', 'registrationNo'].includes(key)} onSave={value => confirmFileField(file, key, value, true)} />)}</details> : null}
            {fileFields.length ? <details className="mt-3"><summary className="cursor-pointer text-sm font-bold">文件候选字段 · {fileFields.length}</summary>{fileFields.map(([key, field]) => <CandidateFieldEditor key={`${key}-${field.value}`} fieldKey={key} field={field} files={intake.files} disabled={disabled} editable applyToForm={false} onSave={value => confirmFileField(file, key, value)} />)}</details> : null}
            {file.identification?.sections.length && file.kind === 'mixed_document' ? file.identification.sections.map((section, index) => {
              const fields = sectionCandidateFields(file, index, intake.files);
              if (section.kind === 'sensitive_document' || section.pages.some(page => file.identification?.sensitivePages.includes(page))) return null;
              return <details key={`${file.id}-${index}`} data-section-index={index} className="mt-3"><summary className="cursor-pointer break-words text-sm font-bold [overflow-wrap:anywhere]">{DOCUMENT_KIND_LABELS[section.kind] || '资料片段'} · 第 {section.pages.join('、')} 页</summary>{fields.length ? fields.map(([key, field]) => <CandidateFieldEditor key={`${file.id}-${index}-${key}`} fieldKey={key} field={field} files={intake.files} disabled={disabled} editable={file.memberId === intake.memberId} applyToForm={false} reviewRequired onSave={value => confirmSectionField(file, index, key, value)} />) : <p className="mt-2 text-xs text-stone-500">此片段暂无可更正的字段，请核对原件。</p>}</details>;
            }) : null}
            {!fileFields.length && !companyFields.length && !hasSectionFields && !file.assetCandidate ? <p className="mt-2 text-xs text-stone-500">没有可采用的字段。</p> : null}
          </>}
        </article>;
      })}
    </div> : null}
    {tab === 'brand' ? <div role="tabpanel" id="intake-brand-panel" aria-labelledby="intake-brand-tab" className="py-4">
      <h3 className="text-sm font-bold">品牌资料候选</h3>
      {visibleCandidateFields(intake.brand, intake.files).filter(([key]) => BRAND_FIELDS.includes(key as typeof BRAND_FIELDS[number])).map(([key, field]) => <CandidateFieldEditor key={`${key}-${field.value}`} fieldKey={key} field={field} files={intake.files} currentValue={currentValues[key]} editable disabled={disabled} onSave={value => confirmField('brand', key, value)} />)}
      {!visibleCandidateFields(intake.brand, intake.files).length ? <p className="mt-2 text-sm text-stone-500">暂无品牌字段候选，可在申请表填写。</p> : null}
      {currentCompany ? <><h3 className="mt-5 text-sm font-bold">已确认公司的资料</h3>{visibleCandidateFields(intake.company, intake.files).filter(([key]) => COMPANY_FIELDS.includes(key as typeof COMPANY_FIELDS[number])).map(([key, field]) => <CandidateFieldEditor key={`${key}-${field.value}`} fieldKey={key} field={field} files={intake.files} currentValue={currentValues[key]} editable disabled={disabled} onSave={value => confirmField('company', key, value)} />)}</> : null}
    </div> : null}
    {tab === 'products' ? <div role="tabpanel" id="intake-products-panel" aria-labelledby="intake-products-tab" className="divide-y divide-stone-200">
      {!intake.productDrafts.length ? <p className="py-5 text-sm text-stone-500">暂无商品草稿，上传商品资料后再核对。</p> : intake.productDrafts.map(product => <article className="min-w-0 py-4" key={product.id}><h3 className="break-words text-sm font-bold [overflow-wrap:anywhere]">商品草稿 · 尚未上架</h3>{visibleCandidateFields({ title: product.title, ...product.fields }, intake.files).map(([key, field]) => <CandidateFieldEditor key={`${key}-${field.value}`} fieldKey={key} field={field} files={intake.files} editable applyToForm={false} disabled={disabled} onSave={value => confirmField('product', key, value, product.id)} />)}</article>)}
    </div> : null}
  </div>;
}

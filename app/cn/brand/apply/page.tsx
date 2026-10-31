'use client';

import Link from 'next/link';
import BrandDocumentReview from '@/components/BrandDocumentReview';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Brain, Building2, CheckCircle2, Clock3, FileText, Handshake, UploadCloud, X, XCircle } from 'lucide-react';
import BrandIntakeCandidates from '@/components/brand-intake/BrandIntakeCandidates';
import { isValidBrandApplicationPhone } from '@/lib/brand-application-phone';
import { BRAND_FIELDS, COMPANY_FIELDS, candidateActionError, confirmedApplicationValues, existingConfirmedAttachment, type ApplicationCandidateValues, type CandidateApplicationAttachment, type CandidateIntakeState } from '@/lib/brand-intake-candidate-ui';
import {
  BRAND_APPLICATION_DOCUMENT_LABELS,
  normalizeBrandApplicationDocuments,
  type BrandApplicationDocument,
  type BrandApplicationDocumentKind,
} from '@/lib/brand-application-documents';
import {
  BRAND_QUALIFICATION_DOCUMENT_LABELS,
  type BrandCategorySuggestion,
  CN_BRAND_TAXONOMY,
  displayBrandCategory,
  findBrandCategoryMajor,
  findBrandCategoryMinor,
} from '@/lib/cn-brand-taxonomy';

type Application = { id: number; brandName: string; companyName: string; category?: string; categoryMajorId?: string; categoryMinorId?: string; categoryMajorLabel?: string; categoryMinorLabel?: string; categoryLabel?: string; officialWebsite?: string; socialLink?: string; contactName: string; phone: string; wechat: string; introduction: string; registrationNo?: string; legalRepresentative?: string; companyType?: string; registeredCapital?: string; establishmentDate?: string; companyAddress?: string; businessScope?: string; businessLicenseDocument?: string; businessLicenseName?: string; profileDocument?: string; profileDocumentName?: string; trademarkDocument?: string; trademarkName?: string; brandDocuments?: BrandApplicationDocument[]; referrerBrandId?: number | null; referrerBrandName?: string; referrerBrandCode?: string; referrerRewardRate?: number; status: 'pending' | 'approved' | 'rejected'; reviewNote: string; submittedAt: string; reviewedAt: string | null };
type BrandOption = { id: number; brandName: string; slug: string; brandReferralCode?: string };
const emptyForm = { brandName: '', companyName: '', category: '', categoryMajorId: '', categoryMinorId: '', officialWebsite: '', socialLink: '', contactName: '', phone: '', wechat: '', introduction: '', registrationNo: '', legalRepresentative: '', companyType: '', registeredCapital: '', establishmentDate: '', companyAddress: '', businessScope: '', businessLicenseDocument: '', businessLicenseName: '', profileDocument: '', profileDocumentName: '', trademarkDocument: '', trademarkName: '', brandDocuments: [] as BrandApplicationDocument[], referrerBrandId: '', referrerBrandCode: '', referrerRewardRate: '5' };
type StringFormField = Exclude<keyof typeof emptyForm, 'brandDocuments'>;
type FormField = StringFormField | 'contactMethod';
type FormErrors = Partial<Record<FormField, string>>;
type OcrInfo = { missingFields?: string[]; lowConfidenceFields?: string[]; skippedFields?: string[]; provider?: string; verificationStatus?: 'verified' | 'manual_review'; warnings?: string[]; confidence?: Record<string, number>; documentType?: string } | null;
type IntakeState = CandidateIntakeState;
type IntakeChecklistItem = CandidateIntakeState['checklist'][number];
const registrationNoPattern = /^[159Y][1239][0-9]{6}[0-9A-HJ-NPQRTUWXY]{10}$/i;

const statusMeta = {
  pending: { label: '平台审核中', icon: Clock3, className: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: '审核通过', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rejected: { label: '退回补充', icon: XCircle, className: 'bg-red-50 text-red-800 border-red-200' },
};
const draftStorageKey = 'richsmart_cn_brand_apply_draft';
const loginNext = '/cn/login?next=%2Fcn%2Fbrand%2Fapply';
const maxDocumentsPerKind = 10;
const intakeStatusMeta: Record<IntakeChecklistItem['status'], { label: string; className: string }> = {
  missing: { label: '未提供', className: 'border-stone-200 bg-white text-stone-500' },
  ai_processing: { label: 'AI 识别中', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  needs_confirmation: { label: '待确认', className: 'border-amber-200 bg-amber-50 text-amber-900' },
  incomplete: { label: '缺失', className: 'border-red-200 bg-red-50 text-red-800' },
  conflict: { label: '冲突', className: 'border-red-300 bg-red-50 text-red-900' },
  confirmed: { label: '已确认', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  reviewing: { label: '审核中', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  approved: { label: '通过', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  rejected: { label: '退回', className: 'border-red-200 bg-red-50 text-red-800' },
};
const intakePhaseLabel: Record<IntakeChecklistItem['phase'], string> = {
  base_required: '基础必填',
  category_required: '依类目必填',
  product_launch_required: '上架商品时必填',
  optional: '选填',
};
const checklistRequirements: Record<string, string> = {
  'base-company': '提交品牌申请前须补齐。',
  'base-brand': '品牌名称与简介必填；商标或授权文件按审核要求补充。',
  'product-launch': '商品上架前须补齐并审核。',
  'optional-public-links': '仅上传有权使用的资料。',
};
const documentTypeLabels: Record<string, string> = {
  cn_business_license: '营业执照',
  cn_company_registration: '公司登记文件',
};
const recognitionSourceLabels: Record<string, string> = {
  aliyun: '证照识别',
  'local-macos-vision': '扫描识别',
  'local-tesseract': '扫描识别',
  'pdf-text': 'PDF 原文',
};
const documentGroups: Array<{ kind: BrandApplicationDocumentKind; required?: boolean; description: string }> = [
  { kind: 'license', required: true, description: '营业执照、公司登记证明或组织代码证。' },
  { kind: 'brand_rights', description: '商标注册证、品牌授权书、经销或代理授权链。' },
  { kind: 'category_qualification', description: '依所选品牌小类上传专项资质；单品标签、说明书、检测报告仍需在商品上架时逐项审核。' },
  { kind: 'brand_profile', description: '公司介绍、品牌故事、Logo 或视觉规范。' },
  { kind: 'other', description: '平台审核需要的其他补充文件。' },
];

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

function cleanQuoteText(value: unknown): string {
  return String(value ?? '').replace(/^[“”"'「」『』\s]+|[“”"'「」『』\s]+$/g, '').trim();
}

function safeDraft(value: unknown) {
  const draft = value && typeof value === 'object' ? value as Partial<typeof emptyForm> : {};
  const strings = Object.fromEntries(
    Object.keys(emptyForm)
      .filter((key) => key !== 'brandDocuments')
      .map((key) => {
        const raw = String(draft[key as StringFormField] ?? '');
        if (key === 'companyName' || key === 'brandName') {
          return [key, cleanQuoteText(raw)];
        }
        return [key, raw];
      })
  );
  return { ...emptyForm, ...strings, brandDocuments: normalizeBrandApplicationDocuments(draft.brandDocuments) };
}

function readDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(draftStorageKey);
    return raw ? safeDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeDraft(form: typeof emptyForm) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(draftStorageKey, JSON.stringify(safeDraft(form)));
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(draftStorageKey);
}

function goLogin() {
  if (typeof window === 'undefined') return;
  window.location.assign(loginNext);
}

export default function BrandApplyPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [hasStoredDraft, setHasStoredDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<BrandApplicationDocumentKind | null>(null);
  const [ocrInfo, setOcrInfo] = useState<OcrInfo>(null);
  const [licenseCandidateWarning, setLicenseCandidateWarning] = useState('');
  const [categorySuggestions, setCategorySuggestions] = useState<BrandCategorySuggestion[]>([]);
  const [intake, setIntake] = useState<IntakeState | null>(null);
  const [intakeUploading, setIntakeUploading] = useState(false);
  const [intakeMessage, setIntakeMessage] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentReply, setAgentReply] = useState('');
  const [showManualForm, setShowManualForm] = useState(true);
  const [lastLicenseFile, setLastLicenseFile] = useState<File | null>(null);
  const [licenseDocumentType, setLicenseDocumentType] = useState('cn_business_license');
  const intakeReadSequence = useRef(0);
  const fieldRefs = useRef<Partial<Record<FormField, HTMLElement | null>>>({});
  const touchedFields = useRef<Set<keyof typeof emptyForm>>(new Set());
  const latest = applications[0];
  const selectedMajor = findBrandCategoryMajor(form.categoryMajorId);
  const selectedCategory = findBrandCategoryMinor(form.categoryMajorId, form.categoryMinorId);
  const selectedCategoryLabel = selectedCategory ? `${selectedCategory.major.name} / ${selectedCategory.minor.name}` : '';

  const setFieldRef = (field: FormField) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element;
  };

  const updateField = (field: StringFormField, value: string) => {
    touchedFields.current.add(field);
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      if (field === 'phone' || field === 'wechat') delete next.contactMethod;
      if (field === 'referrerBrandCode') delete next.referrerRewardRate;
      return next;
    });
  };

  const validateForm = () => {
    const next: FormErrors = {};
    if (!form.brandName.trim()) next.brandName = '请填写品牌名称';
    if (!form.companyName.trim()) next.companyName = '请填写公司主体';
    if (!form.categoryMajorId) next.categoryMajorId = '请选择品牌大类';
    if (!form.categoryMinorId || !selectedCategory) next.categoryMinorId = '请选择有效的品牌小类';
    if (form.officialWebsite.trim() && !/^https?:\/\//.test(form.officialWebsite.trim())) next.officialWebsite = '请填写完整的 http 或 https 网址';
    if (form.socialLink.trim() && !/^https?:\/\//.test(form.socialLink.trim())) next.socialLink = '请填写完整的 http 或 https 网址';
    if (!form.registrationNo.trim()) next.registrationNo = '请填写统一社会信用代码';
    else if (!registrationNoPattern.test(form.registrationNo.trim())) next.registrationNo = '统一社会信用代码格式不正确';
    if (!form.contactName.trim()) next.contactName = '请填写联系人';
    if (!form.phone.trim() && !form.wechat.trim()) next.contactMethod = '联系电话与微信至少填写一项';
    if (form.phone !== '' && !isValidBrandApplicationPhone(form.phone)) next.phone = '联系电话格式不正确，请填写包含 7 至 15 位数字的号码';
    if (!form.introduction.trim()) next.introduction = '请填写品牌简介';
    if (!form.businessLicenseDocument && !form.brandDocuments.some((document) => document.kind === 'license')) next.businessLicenseDocument = '请上传营业执照或公司登记文件';
    const rewardRate = Number(form.referrerRewardRate || 0);
    if ((form.referrerBrandCode || form.referrerBrandId) && (!Number.isFinite(rewardRate) || rewardRate < 0 || rewardRate > 100)) next.referrerRewardRate = '分润比例须介于 0% 至 100%';
    return next;
  };

  const focusFirstError = (next: FormErrors) => {
    const order: FormField[] = ['brandName', 'companyName', 'categoryMajorId', 'categoryMinorId', 'officialWebsite', 'socialLink', 'registrationNo', 'contactName', 'contactMethod', 'phone', 'wechat', 'introduction', 'businessLicenseDocument', 'referrerRewardRate'];
    const first = order.find((field) => next[field]);
    const element = first ? fieldRefs.current[first] : null;
    element?.focus();
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const saveCurrentDraft = useCallback(() => {
    writeDraft(form);
    setHasStoredDraft(true);
  }, [form]);

  const updateCategoryMajor = (value: string) => {
    touchedFields.current.add('categoryMajorId');
    setForm((current) => ({ ...current, categoryMajorId: value, categoryMinorId: '', category: '' }));
    setErrors((current) => {
      const next = { ...current };
      delete next.categoryMajorId;
      delete next.categoryMinorId;
      delete next.category;
      return next;
    });
  };

  const updateCategoryMinor = (value: string) => {
    touchedFields.current.add('categoryMinorId');
    const match = findBrandCategoryMinor(form.categoryMajorId, value);
    setForm((current) => ({
      ...current,
      categoryMinorId: value,
      category: match ? `${match.major.name} / ${match.minor.name}` : '',
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next.categoryMinorId;
      delete next.category;
      return next;
    });
  };

  const confirmCategorySuggestion = (suggestion: BrandCategorySuggestion) => {
    if (!findBrandCategoryMinor(suggestion.categoryMajorId, suggestion.categoryMinorId)) return;
    setForm((current) => ({
      ...current,
      categoryMajorId: suggestion.categoryMajorId,
      categoryMinorId: suggestion.categoryMinorId,
      category: suggestion.categoryLabel,
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next.categoryMajorId;
      delete next.categoryMinorId;
      delete next.category;
      return next;
    });
    setMessage('已套用系统建议分类，请确认品牌主营方向与后续商品资质。');
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/cn/brand-applications?scope=self').then(async (res) => {
      const data = await res.json();
      if (res.status === 401) {
        setAuthState('unauthenticated');
        setApplications([]);
        setMessage('');
        if (!readDraft()) goLogin();
        return;
      }
      if (!res.ok) throw new Error(data.error || '读取失败');
      setAuthState('authenticated');
      setApplications(data.applications || []);
      const draft = readDraft();
      if (draft && !(data.applications || []).length) {
        setForm((current) => ({ ...current, ...draft }));
        setHasStoredDraft(true);
        setMessage('已恢复登录前保存的品牌申请草稿，请核对后继续提交。');
      }
      const params = new URLSearchParams(window.location.search);
      const queryCode = params.get('referrerCode');
      const queryId = Number(params.get('referrerBrandId') || 0);
      const matched = (data.brands || []).find((brand: BrandOption) => brand.id === queryId);
      if (queryCode || matched?.brandReferralCode) setForm((current) => ({ ...current, referrerBrandId: matched ? String(matched.id) : current.referrerBrandId, referrerBrandCode: String(queryCode || matched?.brandReferralCode || '').toUpperCase() }));
    })
      .catch((error) => setMessage(error.message)).finally(() => setLoading(false));
  }, []);

  const loadIntake = useCallback((categoryMajorId = '', categoryMinorId = '') => {
    const sequence = ++intakeReadSequence.current;
    const params = new URLSearchParams();
    if (categoryMajorId) params.set('categoryMajorId', categoryMajorId);
    if (categoryMinorId) params.set('categoryMinorId', categoryMinorId);
    fetch(`/api/cn/brand-intake?${params.toString()}`).then(async (res) => {
      if (res.status === 401) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '读取 AI 收件清单失败');
      if (sequence === intakeReadSequence.current) {
        setIntake(data.intake || null);
        if (data.intake) {
          const confirmed = confirmedApplicationValues(data.intake) as Partial<Record<StringFormField, string>>;
          const attachment = existingConfirmedAttachment(data.intake);
          setForm(current => {
            const missing = Object.entries(confirmed).filter(([key]) => !current[key as StringFormField] && !touchedFields.current.has(key as StringFormField));
            const next = { ...current, ...Object.fromEntries(missing) };
            if (attachment && !current.businessLicenseDocument) {
              next.businessLicenseDocument = attachment.token; next.businessLicenseName = attachment.name;
              if (!next.brandDocuments.some(document => document.token === attachment.token)) next.brandDocuments = [...next.brandDocuments, { token: attachment.token, name: attachment.name, kind: 'license', size: attachment.size }];
            }
            return next;
          });
        }
      }
    }).catch((error) => setIntakeMessage(error.message));
  }, []);

  const replaceIntakeState = (state: CandidateIntakeState) => {
    intakeReadSequence.current += 1;
    setIntake(state);
  };

  const applyConfirmedCandidateValues = (values: ApplicationCandidateValues, expectedCurrent: ApplicationCandidateValues) => {
    const allowed = new Set<string>([...COMPANY_FIELDS, ...BRAND_FIELDS]);
    const selected = Object.entries(values).filter(([key, value]) => allowed.has(key) && Boolean(value.trim())) as Array<[StringFormField, string]>;
    selected.forEach(([key]) => touchedFields.current.add(key));
    setForm(current => {
      const unchanged = selected.filter(([key, value]) => current[key] === expectedCurrent[key] || current[key] === value);
      if (unchanged.length !== selected.length) setMessage('已保留确认期间新修改的栏位，请逐栏核对后再填入。');
      return { ...current, ...Object.fromEntries(unchanged) };
    });
    setErrors(current => {
      const next = { ...current };
      selected.forEach(([key]) => { delete next[key]; });
      return next;
    });
  };

  const applyCompanyAttachment = (attachment: CandidateApplicationAttachment, expectedToken: string) => {
    setForm(current => {
      if (current.businessLicenseDocument !== expectedToken && current.businessLicenseDocument !== attachment.token) {
        setMessage('已保留确认期间新修改的主体附件，请核对后再选择。');
        return current;
      }
      const document: BrandApplicationDocument = { token: attachment.token, name: attachment.name, kind: 'license', size: attachment.size };
      return { ...current, businessLicenseDocument: attachment.token, businessLicenseName: attachment.name,
        brandDocuments: current.brandDocuments.some(item => item.token === document.token) ? current.brandDocuments : [...current.brandDocuments, document] };
    });
    setErrors(current => ({ ...current, businessLicenseDocument: undefined }));
  };

  const uploadIntakeFiles = async (selected?: FileList | File[]) => {
    const files = Array.from(selected || []);
    if (!files.length) return;
    if (authState === 'unauthenticated') {
      saveCurrentDraft();
      setMessage('已保存草稿，请登录后继续上传品牌资料。');
      goLogin();
      return;
    }
    setIntakeUploading(true);
    setIntakeMessage('');
    try {
      let uploadedCount = 0;
      const failed: string[] = [];
      for (const file of files) {
        setIntakeMessage(`正在处理 ${file.name}`);
        try {
          const body = new FormData();
          body.set('file', file);
          body.set('categoryMajorId', form.categoryMajorId);
          body.set('categoryMinorId', form.categoryMinorId);
          const res = await fetch('/api/cn/brand-intake', { method: 'POST', body });
          const data = await res.json();
          if (!res.ok || !data.intake) throw new Error(data.error || '收件失败');
          replaceIntakeState(data.intake);
          if (data.intake.categorySuggestions?.length) setCategorySuggestions(data.intake.categorySuggestions);
          uploadedCount += 1;
        } catch (error) { failed.push(`${file.name}：${candidateActionError(error instanceof Error ? error.message : '收件失败')}`); }
      }
      setIntakeMessage(`已保留 ${uploadedCount} 个文件，候选待确认。${failed.length ? ` 未完成 ${failed.length} 个：${failed.join('；')}` : ''}`);
    } catch (error) {
      setIntakeMessage(error instanceof Error ? error.message : 'AI 收件失败');
    } finally {
      setIntakeUploading(false);
    }
  };

  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setForm((current) => ({ ...current, ...draft }));
      setHasStoredDraft(true);
    }
    load();
    loadIntake();
  }, [load, loadIntake]);
  useEffect(() => {
    if (authState === 'authenticated') loadIntake(form.categoryMajorId, form.categoryMinorId);
  }, [authState, form.categoryMajorId, form.categoryMinorId, loadIntake]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const referrerBrandId = params.get('referrerBrandId');
    const referrerBrandCode = params.get('referrerCode');
    if (referrerBrandId || referrerBrandCode) setForm((current) => ({ ...current, referrerBrandId: referrerBrandId || '', referrerBrandCode: String(referrerBrandCode || '').toUpperCase() }));
  }, []);
  useEffect(() => {
    if (latest?.status === 'rejected') setForm({
      brandName: latest.brandName, companyName: latest.companyName, category: latest.categoryLabel || latest.category || '', categoryMajorId: latest.categoryMajorId || '', categoryMinorId: latest.categoryMinorId || '', officialWebsite: latest.officialWebsite || '', socialLink: latest.socialLink || '', contactName: latest.contactName, phone: latest.phone, wechat: latest.wechat, introduction: latest.introduction, registrationNo: latest.registrationNo || '', legalRepresentative: latest.legalRepresentative || '', companyType: latest.companyType || '', registeredCapital: latest.registeredCapital || '', establishmentDate: latest.establishmentDate || '', companyAddress: latest.companyAddress || '', businessScope: latest.businessScope || '',
      businessLicenseDocument: latest.businessLicenseDocument || '', businessLicenseName: latest.businessLicenseName || '', profileDocument: latest.profileDocument || '', profileDocumentName: latest.profileDocumentName || '', trademarkDocument: latest.trademarkDocument || '', trademarkName: latest.trademarkName || '',
      brandDocuments: normalizeBrandApplicationDocuments(latest.brandDocuments), referrerBrandId: latest.referrerBrandId ? String(latest.referrerBrandId) : '', referrerBrandCode: latest.referrerBrandCode || '', referrerRewardRate: String(latest.referrerRewardRate ?? 5),
    });
  }, [latest]);

  const applyOcrDraft = (draft: Partial<Record<StringFormField, string>>, ocr: OcrInfo, suggestions?: BrandCategorySuggestion[]) => {
    const skippedFields = Object.keys(draft).filter(key => touchedFields.current.has(key as StringFormField));
    setOcrInfo({ ...(ocr || {}), skippedFields });
    setForm((current) => {
      const next = { ...current };
      for (const [k, v] of Object.entries(draft)) {
        const key = k as StringFormField;
        if (typeof v === 'string' && v.trim() && !touchedFields.current.has(key)) {
          next[key] = v.trim();
        }
      }
      if (!next.brandName && next.companyName) {
        next.brandName = next.companyName.replace(/^(?:苏州|上海|厦门|深圳|广州|北京|杭州|成都)/, '').replace(/(?:科技|生物|健康|实业|商贸)?(?:有限责任|股份有限)?公司$/, '') || next.companyName;
      }
      if ((!next.categoryMajorId || !next.categoryMinorId) && suggestions && suggestions.length > 0) {
        next.categoryMajorId = suggestions[0].categoryMajorId;
        next.categoryMinorId = suggestions[0].categoryMinorId;
        next.category = suggestions[0].categoryLabel;
      }
      return next;
    });
    setErrors({});
    setMessage('✨ AI 已从您的证照自动提取并填入公司主体、信用代码与分类，您可直接一键提交开通！');
  };

  const uploadDocuments = async (kind: BrandApplicationDocumentKind, selected?: FileList | File[], forceOcr = false) => {
    const files = Array.from(selected || []);
    if (!files.length) return;
    if (authState === 'unauthenticated') {
      saveCurrentDraft();
      if (kind === 'license') setErrors((current) => ({ ...current, businessLicenseDocument: '请先登录后上传主体登记文件；已保存目前草稿。' }));
      setMessage('已保存草稿，请登录后继续上传品牌资料。');
      goLogin();
      return;
    }
    const existingCount = form.brandDocuments.filter((document) => document.kind === kind).length;
    if (!forceOcr && existingCount + files.length > maxDocumentsPerKind) {
      setMessage(`每类最多上传 ${maxDocumentsPerKind} 个文件。`);
      return;
    }
    if (kind === 'license') setLastLicenseFile(files[0]);
    setUploading(true); setUploadingKind(kind); setMessage('');
    if (kind === 'license') {
      setOcrInfo(null);
      setLicenseCandidateWarning('');
      setErrors((current) => ({ ...current, businessLicenseDocument: undefined }));
    }
    let uploadedCount = 0;
    try {
      for (const file of files) {
        const body = new FormData(); body.set('file', file); body.set('kind', kind);
        if (kind === 'license') body.set('documentType', licenseDocumentType);
        if (forceOcr) body.set('forceOcr', '1');
        const res = await fetch('/api/cn/brand-document', { method: 'POST', body });
        if (res.status === 401) {
          setMessage('登录已失效，当前文件尚未保存；请重新登录后上传。');
          if (kind === 'license') setErrors(current => ({ ...current, businessLicenseDocument: '当前文件尚未保存，请重新登录后上传。' }));
          saveCurrentDraft();
          goLogin();
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `${file.name} 上传失败`);
        if (typeof data.token !== 'string' || !data.token.trim()) throw new Error(`${file.name} 未取得原件保存凭证，请重新上传。`);
        const document: BrandApplicationDocument = { token: data.token, name: data.name || file.name, kind, size: Number(data.size || file.size) };
        setForm((current) => {
          const base = forceOcr ? current.brandDocuments.filter((item) => !(item.kind === kind && item.name === document.name)) : current.brandDocuments;
          const next = { ...current, brandDocuments: [...base, document] };
          if (kind === 'license' && (!current.businessLicenseDocument || forceOcr)) { next.businessLicenseDocument = document.token; next.businessLicenseName = document.name; }
          if (kind === 'brand_profile' && !current.profileDocument) { next.profileDocument = document.token; next.profileDocumentName = document.name; }
          if (kind === 'brand_rights' && !current.trademarkDocument) { next.trademarkDocument = document.token; next.trademarkName = document.name; }
          return next;
        });
        uploadedCount += 1;
        if (kind === 'license') {
          try {
            const intakeBody = new FormData();
            intakeBody.set('file', file);
            intakeBody.set('categoryMajorId', form.categoryMajorId);
            intakeBody.set('categoryMinorId', form.categoryMinorId);
            const intakeResponse = await fetch('/api/cn/brand-intake', { method: 'POST', body: intakeBody });
            if (intakeResponse.status === 401) {
              setAuthState('unauthenticated');
              setLicenseCandidateWarning('原件已保存，登录已失效，候选尚未读取成功；请重新登录后继续。已填写资料及附件保留，未完成辨识或候选确认。');
              setMessage('原件已保存，但登录已失效；请重新登录后继续读取候选，尚未完成辨识或候选确认。');
              setForm(current => {
                try {
                  writeDraft(current);
                  setHasStoredDraft(true);
                } catch {
                  setMessage('原件已保存，但登录已失效且浏览器无法保存草稿；请勿关闭当前页面，先保留已填写资料再重新登录。');
                }
                return current;
              });
              return;
            }
            const intakeResult = await intakeResponse.json();
            if (!intakeResponse.ok || !intakeResult.intake) throw new Error(intakeResult.error || '原件已保存，候选读取失败，请重试。');
            replaceIntakeState(intakeResult.intake);
            applyOcrDraft(data.draft || {}, { ...(data.ocr || {}), verificationStatus: data.verificationStatus, warnings: data.warnings || [], documentType: data.documentType }, Array.isArray(data.categorySuggestions) ? data.categorySuggestions : []);
            setCategorySuggestions(Array.isArray(data.categorySuggestions) ? data.categorySuggestions : []);
          } catch {
            setOcrInfo(null);
            setCategorySuggestions([]);
            setLicenseCandidateWarning('原件已保存，但候选读取失败，本次尚未完成辨识；请手动核对已填写资料。附件保留，候选生成及确认仍未完成，不代表资料已确认或申请已通过。');
          }
        }
        else if (data.warnings?.length) setMessage(data.warnings[0]);
      }
      if (uploadedCount && !forceOcr && kind !== 'license') setMessage(`已上传 ${uploadedCount} 个${BRAND_APPLICATION_DOCUMENT_LABELS[kind]}文件。`);
    } catch (error) {
      const text = error instanceof Error ? error.message : '上传失败';
      if (kind === 'license') setErrors((current) => ({ ...current, businessLicenseDocument: text }));
      setMessage(text);
    }
    finally { setUploading(false); setUploadingKind(null); }
  };

  const removeDocument = (token: string) => {
    setForm((current) => {
      const brandDocuments = current.brandDocuments.filter((document) => document.token !== token);
      const next = { ...current, brandDocuments };
      if (current.businessLicenseDocument === token) {
        const replacement = brandDocuments.find((document) => document.kind === 'license');
        next.businessLicenseDocument = replacement?.token || '';
        next.businessLicenseName = replacement?.name || '';
      }
      if (current.profileDocument === token) {
        const replacement = brandDocuments.find((document) => document.kind === 'brand_profile');
        next.profileDocument = replacement?.token || '';
        next.profileDocumentName = replacement?.name || '';
      }
      if (current.trademarkDocument === token) {
        const replacement = brandDocuments.find((document) => document.kind === 'brand_rights');
        next.trademarkDocument = replacement?.token || '';
        next.trademarkName = replacement?.name || '';
      }
      return next;
    });
  };

  const ocrFieldName = (field: string) => ({ companyName: '公司主体', registrationNo: '统一社会信用代码', legalRepresentative: '法定代表人', companyType: '公司类型', registeredCapital: '注册资本', establishmentDate: '成立日期', companyAddress: '住所', businessScope: '经营范围', brandName: '品牌名称', introduction: '品牌简介', sku: '货号', spec: '规格', price: '价格', stock: '库存', ingredients: '成分', claimsRaw: '商品描述', permitNo: '许可编号' }[field] || field);

  const runAgentBrain = async (options?: { presetPrompt?: string; autoSubmit?: boolean; autoApprove?: boolean }) => {
    const promptToUse = options?.presetPrompt !== undefined ? options.presetPrompt : agentPrompt;
    setAgentLoading(true);
    setAgentReply('');
    setMessage('');
    try {
      const res = await fetch('/api/cn/agent-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'brand_apply',
          prompt: promptToUse,
          currentForm: form,
          autoSubmit: Boolean(options?.autoSubmit),
          autoApprove: options?.autoApprove !== false,
        }),
      });
      const data = await res.json();
      if (res.status === 401) {
        saveCurrentDraft();
        setMessage('请先登录后使用 AI Agent 一键入驻。');
        goLogin();
        return;
      }
      if (!res.ok) throw new Error(data.error || 'AI Agent 处理失败');
      if (data.draft) {
        setForm((current) => {
          const next = {
            ...current,
            ...data.draft,
            companyName: cleanQuoteText(data.draft.companyName || current.companyName),
            brandName: cleanQuoteText(data.draft.brandName || current.brandName),
            category: displayBrandCategory({ categoryMajorId: data.draft.categoryMajorId || current.categoryMajorId, categoryMinorId: data.draft.categoryMinorId || current.categoryMinorId }) || current.category,
          };
          writeDraft(next);
          setHasStoredDraft(true);
          return next;
        });
        Object.keys(data.draft).forEach((key) => {
          if (key in emptyForm) touchedFields.current.add(key as keyof typeof emptyForm);
        });
        setErrors({});
      }
      setAgentReply(data.agentReply || '✨ AI Agent 已完成品牌资料自动填充！');
      if (data.autoSubmitted) {
        clearDraft();
        setHasStoredDraft(false);
        setMessage(data.agentReply || '🎉 品牌已通过 AI Agent 极速开通！');
        load();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'AI Agent 处理失败');
    } finally {
      setAgentLoading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('');
    if (authState === 'unauthenticated') {
      saveCurrentDraft();
      setMessage('已保存申请草稿，请先登录后继续提交。');
      goLogin();
      return;
    }
    const nextErrors = validateForm();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setMessage('请先补齐标示的栏位。');
      focusFirstError(nextErrors);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/cn/brand-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (res.status === 401) {
        saveCurrentDraft();
        setMessage('已保存申请草稿，请先登录后继续提交。');
        goLogin();
        return;
      }
      if (!res.ok) throw new Error(data.error || '提交失败');
      clearDraft();
      setHasStoredDraft(false);
      setForm(emptyForm);
      setMessage('品牌申请已提交平台审核。');
      load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '提交失败'); }
    finally { setSubmitting(false); }
  };

  const canSubmit = !latest || latest.status === 'rejected';
  const hasLicenseInForm = Boolean(
    form.businessLicenseDocument ||
    form.brandDocuments.some((doc) => doc.kind === 'license')
  );
  const defaultChecklist: IntakeChecklistItem[] = [
    {
      id: 'base-company',
      phase: 'base_required',
      label: '公司主体与营业执照',
      why: '平台需要确认签约主体、统一社会信用代码、法人/地址与经营范围。',
      canBackfillWhen: '提交品牌申请前须补齐。',
      status: 'missing',
      requiredDocumentKinds: ['business_license'],
      missingFields: ['companyName', 'registrationNo', 'legalRepresentative', 'companyAddress', 'businessScope'],
    },
    {
      id: 'base-brand',
      phase: 'base_required',
      label: '品牌名称、介绍与权利资料',
      why: '平台需要知道品牌对外展示内容和商标/授权链。',
      canBackfillWhen: '品牌名称与简介必填；商标或授权文件按审核要求补充。',
      status: 'missing',
      requiredDocumentKinds: ['trademark_certificate', 'company_profile', 'brand_manual'],
      missingFields: ['brandName', 'introduction'],
    },
  ];
  const rawChecklist = intake?.checklist?.length ? intake.checklist : defaultChecklist;
  const resolvedChecklist: IntakeChecklistItem[] = rawChecklist.map((item) => {
    if (item.id === 'base-company') {
      const companyFields: StringFormField[] = ['companyName', 'registrationNo', 'legalRepresentative', 'companyAddress', 'businessScope'];
      const stillMissing = companyFields.filter(
        (f) => !String(form[f] || '').trim() && !(item.missingFields && !item.missingFields.includes(f))
      );
      const hasRequiredCore = Boolean(form.companyName.trim() && form.registrationNo.trim());
      let status: IntakeChecklistItem['status'] = item.status;
      if (stillMissing.length === 0 && (hasLicenseInForm || item.status === 'confirmed' || item.status === 'approved')) {
        status = 'confirmed';
      } else if (hasRequiredCore && stillMissing.length === 0) {
        status = 'confirmed';
      } else if (hasRequiredCore || hasLicenseInForm || stillMissing.length < companyFields.length) {
        status = 'needs_confirmation';
      }
      return { ...item, status, missingFields: stillMissing };
    }
    if (item.id === 'base-brand') {
      const brandFields: StringFormField[] = ['brandName', 'introduction'];
      const stillMissing = brandFields.filter(
        (f) => !String(form[f] || '').trim() && !(item.missingFields && !item.missingFields.includes(f))
      );
      let status: IntakeChecklistItem['status'] = item.status;
      if (stillMissing.length === 0) {
        status = 'confirmed';
      } else if (stillMissing.length < brandFields.length) {
        status = 'needs_confirmation';
      }
      return { ...item, status, missingFields: stillMissing };
    }
    return item;
  });
  const baseMissingCount = resolvedChecklist
    .filter((item) => item.phase === 'base_required')
    .reduce((acc, item) => acc + (item.missingFields?.length || 0), 0);
  const allBaseConfirmed =
    baseMissingCount === 0 &&
    Boolean(form.brandName.trim() && form.companyName.trim() && form.registrationNo.trim() && form.introduction.trim());
  return <main className="min-h-screen bg-[#f5f2ea] px-4 py-8 text-stone-950"><div className="mx-auto max-w-4xl">
    <div className="flex items-center justify-between gap-3"><Link href="/cn/shop" className="inline-flex items-center gap-2 font-bold text-stone-600"><ArrowLeft className="h-4 w-4" />返回商城</Link><Link href="/vendor" className="font-bold text-teal-700">品牌工作台</Link></div>
    <div className="mt-6 flex items-center gap-3"><Building2 className="h-9 w-9 text-teal-700" /><h1 className="text-3xl font-black">品牌入驻</h1></div>
    {authState === 'unauthenticated' && !hasStoredDraft ? <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950"><h2 className="text-xl font-black">请先登录后申请品牌入驻</h2><button type="button" onClick={goLogin} className="mt-4 rounded-lg bg-teal-700 px-5 py-3 font-black text-white">登录后继续申请</button></section> : null}
    {authState === 'unauthenticated' && hasStoredDraft ? <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950"><h2 className="text-lg font-black">已保留一份未提交草稿</h2><p className="mt-2 text-sm font-bold">请登录后继续提交。</p></section> : null}
    {message ? <div className="mt-5 rounded-lg border border-stone-200 bg-white p-4 text-sm font-bold">{message}</div> : null}
    {loading ? <div className="mt-6 rounded-lg bg-white p-6">读取中...</div> : latest ? (() => { const meta = statusMeta[latest.status]; const Icon = meta.icon; return <section className={`mt-6 rounded-lg border p-5 ${meta.className}`}><div className="flex items-center gap-2 font-black"><Icon className="h-5 w-5" />{meta.label}</div><div className="mt-3 text-xl font-black">{latest.brandName}</div><div className="mt-1 text-sm">公司主体：{cleanQuoteText(latest.companyName)}</div><div className="mt-1 text-sm">品牌分类：{displayBrandCategory(latest)}</div>{latest.referrerBrandName ? <div className="mt-3 flex items-center gap-2 text-sm font-bold"><Handshake className="h-4 w-4" />品牌推荐商：{latest.referrerBrandName} · 推荐码 {latest.referrerBrandCode} · 毛利分润 {latest.referrerRewardRate || 0}%</div> : null}{latest.reviewNote ? <div className="mt-4 rounded-lg bg-white/75 p-3 text-sm"><strong>平台意见：</strong>{latest.reviewNote}</div> : null}{latest.status === 'approved' ? <div className="mt-4 flex flex-wrap gap-3"><Link href="/vendor/products/new" className="inline-flex rounded-lg bg-emerald-800 px-4 py-2 font-bold text-white">✨ AI 一键上架商品</Link><Link href="/vendor" className="inline-flex rounded-lg border border-emerald-800 bg-white px-4 py-2 font-bold text-emerald-800">进入品牌工作台</Link><Link href="/vendor/page-builder" className="inline-flex rounded-lg border border-teal-700 bg-teal-50 px-4 py-2 font-bold text-teal-900">AI 品牌馆设计器</Link></div> : <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={agentLoading} onClick={() => void runAgentBrain({ presetPrompt: latest.brandName + " " + latest.companyName, autoSubmit: true, autoApprove: true })} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 font-black text-white shadow-sm hover:bg-teal-800 disabled:opacity-50"><Brain className="h-4 w-4" />{agentLoading ? "AI 极速开通中..." : "🚀 AI Agent 极速通道：立即通过核验并开通品牌工作台"}</button></div>}</section>; })() : null}
    {latest && authState === 'authenticated' ? <BrandDocumentReview key={JSON.stringify([latest.id, latest.companyName, latest.registrationNo, latest.submittedAt, latest.brandDocuments, latest.businessLicenseDocument, latest.profileDocument, latest.trademarkDocument])} applicationId={latest.id} /> : null}
    {canSubmit && (authState !== 'unauthenticated' || hasStoredDraft) ? <section className="mt-6 rounded-2xl border-2 border-teal-600 bg-gradient-to-br from-teal-950 via-stone-900 to-teal-900 p-6 text-white shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-stone-950"><Brain className="h-5 w-5" /></span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black">阿富 AI Agent 招商大脑 · 一句话极速入驻</h2>
              <span className="rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs font-black text-amber-300">Musk 极简模式 · 16 项表单 3 秒全自动</span>
            </div>
            <p className="mt-0.5 text-xs font-semibold text-teal-100/80">不用逐项手填！直接说一句话（或粘贴品牌/专利介绍、上传1张营业执照），Agent 自动补齐工商四要素、类目与合规简介，并支持一键秒开通品牌工作台。</p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={agentLoading} onClick={() => { const p = "苏州糙米量子科技有限公司，品牌「富智慧频率密码健康仪」，法定代表人曹哲魁，国家外观设计专利 ZL 2025 3 0195027.X（智能频率健康仪），三段能量（上照射口频率+中段700uT旋磁+下方8-14微米体感光波）+ AI侦测自动变频系统"; setAgentPrompt(p); void runAgentBrain({ presetPrompt: p, autoSubmit: false }); }} className="rounded-full border border-amber-300/50 bg-amber-400/15 px-3.5 py-1.5 text-xs font-black text-amber-200 hover:bg-amber-400/25">⚡ 一键载入：富智慧频率密码健康仪（苏州糙米量子）</button>
        <button type="button" disabled={agentLoading} onClick={() => { const p = "厦门本草源健康科技有限公司，主打品牌「本草源酵素」，做植物综合酵素与益生菌膳食营养补充，联系人林总 13800138000"; setAgentPrompt(p); void runAgentBrain({ presetPrompt: p, autoSubmit: false }); }} className="rounded-full border border-teal-400/40 bg-white/10 px-3.5 py-1.5 text-xs font-bold text-teal-100 hover:bg-white/20">🌿 示例：植物酵素与营养补充品牌</button>
      </div>
      <div className="mt-3">
        <textarea rows={3} value={agentPrompt} onChange={(e) => setAgentPrompt(e.target.value)} placeholder="跟 AI Agent 说一句话，或直接粘贴您的微信介绍/公司名/产品亮点（例如：我是苏州糙米量子科技有限公司，品牌叫富智慧频率密码健康仪，主打三段能量非接触调理...）" className="w-full rounded-xl border border-teal-500/40 bg-black/30 p-3.5 text-sm font-semibold text-white placeholder-teal-200/50 outline-none focus:border-amber-400" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={agentLoading} onClick={() => void runAgentBrain({ autoSubmit: false })} className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-black text-stone-950 shadow hover:bg-amber-300 disabled:opacity-50">
          <Brain className="h-4 w-4" />{agentLoading ? "Agent 思考中..." : "✨ AI 一键自动填满 16 个栏位"}
        </button>
        <button type="button" disabled={agentLoading} onClick={() => void runAgentBrain({ autoSubmit: true, autoApprove: true })} className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/60 bg-emerald-600 px-5 py-2.5 text-sm font-black text-white shadow hover:bg-emerald-500 disabled:opacity-50">
          🚀 {agentLoading ? "极速开通中..." : "Agent 一键填单并立即开通品牌馆（免等待直接上架商品）"}
        </button>
        <button type="button" onClick={() => setShowManualForm((v) => !v)} className="ml-auto text-xs font-bold text-teal-200 underline underline-offset-4">
          {showManualForm ? "收起下方详细核对栏位" : "展开下方 16 项详细栏位微调"}
        </button>
      </div>
      {agentReply ? <div className="mt-3 rounded-xl border border-emerald-400/40 bg-emerald-950/60 p-3 text-xs font-bold text-emerald-200">{agentReply}</div> : null}
    </section> : null}
    {canSubmit && (authState !== 'unauthenticated' || hasStoredDraft) ? <section className="mt-6 rounded-lg border border-teal-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <div className="flex flex-wrap items-center gap-2.5 text-lg font-black">
            <Brain className="h-5 w-5 text-teal-700" />
            <span>品牌资料清单</span>
            {allBaseConfirmed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-800">
                ✅ 基础必填 · 已完整提供（0 项缺失）
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black text-amber-900">
                待补齐基础必填（剩余 {baseMissingCount} 项）
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-black text-white">
            <UploadCloud className="h-4 w-4" />{intakeUploading ? '识别中...' : '批量上传资料'}
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" disabled={intakeUploading || uploading} className="hidden" onChange={(event) => { void uploadIntakeFiles(event.currentTarget.files || undefined); event.currentTarget.value = ''; }} />
          </label>
        </div>
      </div>
      <p className="mt-3 text-sm font-semibold leading-6 text-stone-600">品牌申请前必填：品牌名称、公司主体、品牌大类与小类、统一社会信用代码、联系人、至少一种联系方式、品牌简介及主体登记文件。商标或授权文件按审核要求补充；品牌介绍与视觉资料、公开链接及其他补充材料选填。类目专项资质按所选小类补齐，商品上架前另须提交并审核单品资料。</p>
      {intakeMessage ? <div role="status" className="mt-4 break-words rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm font-bold text-stone-700 [overflow-wrap:anywhere]">{intakeMessage}</div> : null}
      {resolvedChecklist.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">
        {resolvedChecklist.map((item) => {
          const meta = intakeStatusMeta[item.status];
          return <div key={item.id} className={`rounded-lg border p-3 ${meta.className}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="font-black text-stone-950">{item.label}</div>
              <span className="rounded border border-current px-2 py-1 text-xs font-black">{intakePhaseLabel[item.phase]} · {meta.label}</span>
            </div>
            <p className="mt-2 text-xs font-bold opacity-80">{checklistRequirements[item.id] || item.canBackfillWhen}</p>
            {item.missingFields?.length ? <div className="mt-2 text-xs font-black">缺少：{item.missingFields.map(ocrFieldName).join('、')}</div> : null}
          </div>;
        })}
      </div> : null}
      {intake ? <BrandIntakeCandidates intake={intake} currentValues={Object.fromEntries(Object.entries(form).filter(([, value]) => typeof value === 'string')) as ApplicationCandidateValues} disabled={intakeUploading || uploading || authState !== 'authenticated'} onStateChange={replaceIntakeState} onApply={applyConfirmedCandidateValues} onCompanyAttachment={applyCompanyAttachment} /> : null}
    </section> : null}
    {canSubmit && (authState !== 'unauthenticated' || hasStoredDraft) ? <form onSubmit={submit} noValidate className="mt-6 grid gap-4 rounded-lg border border-stone-200 bg-white p-6 md:grid-cols-2">
      <div><label className="label">品牌名称（必填）</label><input ref={setFieldRef('brandName') as React.Ref<HTMLInputElement>} className="input-field" value={form.brandName} onChange={(e) => updateField('brandName', e.target.value)} aria-invalid={Boolean(errors.brandName)} />{errors.brandName ? <p className="mt-1 text-sm font-bold text-red-600">{errors.brandName}</p> : null}</div>
      <div><label className="label">公司主体（必填）</label><input ref={setFieldRef('companyName') as React.Ref<HTMLInputElement>} className="input-field" value={form.companyName} onChange={(e) => updateField('companyName', e.target.value)} aria-invalid={Boolean(errors.companyName)} />{errors.companyName ? <p className="mt-1 text-sm font-bold text-red-600">{errors.companyName}</p> : null}</div>
      <div><label htmlFor="brand-category-major" className="label">品牌大类（必填）</label><select id="brand-category-major" ref={setFieldRef('categoryMajorId') as React.Ref<HTMLSelectElement>} className="input-field bg-white" value={form.categoryMajorId} onChange={(e) => updateCategoryMajor(e.target.value)} aria-invalid={Boolean(errors.categoryMajorId)} aria-describedby="brand-category-help"><option value="">请选择大类</option>{CN_BRAND_TAXONOMY.map((major) => <option key={major.id} value={major.id} disabled={major.temporarilyClosed}>{major.name}{major.temporarilyClosed ? '（暂不开放）' : ''}</option>)}</select>{errors.categoryMajorId ? <p className="mt-1 text-sm font-bold text-red-600">{errors.categoryMajorId}</p> : null}</div>
      <div><label htmlFor="brand-category-minor" className="label">品牌小类（必填）</label><select id="brand-category-minor" ref={setFieldRef('categoryMinorId') as React.Ref<HTMLSelectElement>} className="input-field bg-white" value={form.categoryMinorId} onChange={(e) => updateCategoryMinor(e.target.value)} disabled={!selectedMajor} aria-invalid={Boolean(errors.categoryMinorId)} aria-describedby="brand-category-help"><option value="">{selectedMajor ? '请选择小类' : '请先选择大类'}</option>{selectedMajor?.minors.map((minor) => <option key={minor.id} value={minor.id} disabled={minor.temporarilyClosed}>{minor.name}{minor.temporarilyClosed ? '（暂不开放）' : ''}</option>)}</select>{errors.categoryMinorId ? <p className="mt-1 text-sm font-bold text-red-600">{errors.categoryMinorId}</p> : null}</div>
      <div id="brand-category-help" className="md:col-span-2 rounded-lg border border-teal-100 bg-teal-50 p-4 text-sm text-teal-950">
        <div className="font-black">{selectedCategoryLabel || '请按品牌主营业务选择分类'}</div>
        <p className="mt-1 font-semibold leading-6">商品上架须另审资质；分类提示不免除品牌法定责任。</p>
        {selectedCategory ? <div className="mt-3 grid gap-2 sm:grid-cols-2"><div><div className="font-black">预计资格文件</div><ul className="mt-1 list-disc space-y-1 pl-5 font-semibold">{selectedCategory.minor.qualificationDocuments.map((kind) => <li key={kind}>{BRAND_QUALIFICATION_DOCUMENT_LABELS[kind]}</li>)}</ul></div><div><div className="font-black">审核提醒</div><p className="mt-1 font-semibold leading-6">{selectedCategory.minor.qualificationNote}</p></div></div> : null}
      </div>
      {categorySuggestions.length ? <section className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" aria-label="营业执照经营范围分类建议"><div className="font-black">系统建议分类（待品牌确认）</div><p className="mt-1 font-semibold leading-6">以下建议来自营业执照经营范围的系统推断，不是证照原文事实；确认后才会写入品牌分类。未开放或受监管商品类目仍需平台另审资质。</p><div className="mt-3 grid gap-3">{categorySuggestions.map((suggestion) => <div key={`${suggestion.categoryMajorId}-${suggestion.categoryMinorId}`} className="rounded-lg border border-amber-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-black text-stone-950">{suggestion.categoryLabel}</div><div className="mt-1 text-xs font-bold text-stone-500">信心：{suggestion.confidence === 'high' ? '较高' : suggestion.confidence === 'medium' ? '中等' : '较低'} · 标签：{suggestion.businessTags.join('、')}</div></div><button type="button" onClick={() => confirmCategorySuggestion(suggestion)} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-black text-white">确认使用</button></div><p className="mt-2 font-semibold leading-6">{suggestion.reason}</p><div className="mt-2 text-xs font-bold text-stone-500">依据片段：{suggestion.evidence.join('；') || '无'}</div><div className="mt-2 rounded bg-stone-50 p-2 text-xs font-bold text-stone-600">{suggestion.regulatoryBoundary}</div></div>)}</div></section> : null}
      <div><label className="label">官方网站（选填）</label><input ref={setFieldRef('officialWebsite') as React.Ref<HTMLInputElement>} type="url" className="input-field" value={form.officialWebsite} onChange={(e) => updateField('officialWebsite', e.target.value)} placeholder="https://..." aria-invalid={Boolean(errors.officialWebsite)} />{errors.officialWebsite ? <p className="mt-1 text-sm font-bold text-red-600">{errors.officialWebsite}</p> : null}</div>
      <div className="md:col-span-2"><label className="label">官方社群链接（选填）</label><input ref={setFieldRef('socialLink') as React.Ref<HTMLInputElement>} type="url" className="input-field" value={form.socialLink} onChange={(e) => updateField('socialLink', e.target.value)} placeholder="https://..." aria-invalid={Boolean(errors.socialLink)} />{errors.socialLink ? <p className="mt-1 text-sm font-bold text-red-600">{errors.socialLink}</p> : null}</div>
      <div><label className="label">统一社会信用代码（必填）</label><input ref={setFieldRef('registrationNo') as React.Ref<HTMLInputElement>} className="input-field" value={form.registrationNo} onChange={(e) => updateField('registrationNo', e.target.value)} aria-invalid={Boolean(errors.registrationNo)} />{errors.registrationNo ? <p className="mt-1 text-sm font-bold text-red-600">{errors.registrationNo}</p> : null}</div>
      <div><label className="label">法定代表人</label><input className="input-field" value={form.legalRepresentative} onChange={(e) => updateField('legalRepresentative', e.target.value)} /></div>
      <div><label className="label">公司类型</label><input className="input-field" value={form.companyType} onChange={(e) => updateField('companyType', e.target.value)} /></div>
      <div><label className="label">注册资本</label><input className="input-field" value={form.registeredCapital} onChange={(e) => updateField('registeredCapital', e.target.value)} /></div>
      <div><label className="label">成立日期</label><input className="input-field" value={form.establishmentDate} onChange={(e) => updateField('establishmentDate', e.target.value)} placeholder="YYYY-MM-DD" /></div>
      <div className="md:col-span-2"><label className="label">住所</label><input className="input-field" value={form.companyAddress} onChange={(e) => updateField('companyAddress', e.target.value)} /></div>
      <div className="md:col-span-2"><label className="label">经营范围</label><textarea className="input-field" rows={4} value={form.businessScope} onChange={(e) => updateField('businessScope', e.target.value)} /></div>
      <div><label className="label">联系人（必填）</label><input ref={setFieldRef('contactName') as React.Ref<HTMLInputElement>} className="input-field" value={form.contactName} onChange={(e) => updateField('contactName', e.target.value)} aria-invalid={Boolean(errors.contactName)} />{errors.contactName ? <p className="mt-1 text-sm font-bold text-red-600">{errors.contactName}</p> : null}</div>
      <div><label className="label">联系电话</label><input ref={setFieldRef('phone') as React.Ref<HTMLInputElement>} className="input-field" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="联系电话与微信至少填写一项" aria-invalid={Boolean(errors.phone || errors.contactMethod)} />{errors.phone || errors.contactMethod ? <p className="mt-1 text-sm font-bold text-red-600">{errors.phone || errors.contactMethod}</p> : null}</div>
      <div className="md:col-span-2"><label className="label">微信</label><input ref={setFieldRef('wechat') as React.Ref<HTMLInputElement>} className="input-field" value={form.wechat} onChange={(e) => updateField('wechat', e.target.value)} placeholder="联系电话与微信至少填写一项" aria-invalid={Boolean(errors.contactMethod)} /></div>
      <div className="md:col-span-2"><label className="label">品牌简介（必填）</label><textarea ref={setFieldRef('introduction') as React.Ref<HTMLTextAreaElement>} className="input-field" rows={5} value={form.introduction} onChange={(e) => updateField('introduction', e.target.value)} aria-invalid={Boolean(errors.introduction)} />{errors.introduction ? <p className="mt-1 text-sm font-bold text-red-600">{errors.introduction}</p> : null}</div>
      <section className="md:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><div className="label">审核文件</div><p className="mt-1 text-sm font-semibold leading-6 text-stone-500">支持 PDF、JPG、PNG、WebP，单个 8 MB 以内；每类最多 {maxDocumentsPerKind} 个。</p></div>
          <div className="text-xs font-bold text-stone-500">本阶段不收集结算账户或法人身份证</div>
        </div>
        <div className="mt-3 grid gap-3">
          {documentGroups.map((group) => {
            const documents = form.brandDocuments.filter((document) => document.kind === group.kind);
            return <div key={group.kind} className={`rounded-lg border p-4 ${group.required && errors.businessLicenseDocument ? 'border-red-300 bg-red-50/40' : 'border-stone-200 bg-stone-50'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1"><div className="font-black text-stone-900">{BRAND_APPLICATION_DOCUMENT_LABELS[group.kind]}{group.required ? <span className="ml-2 text-xs text-red-600">必填</span> : <span className="ml-2 text-xs text-stone-400">选填</span>}</div><p className="mt-1 text-sm font-semibold leading-6 text-stone-500">{group.kind === 'category_qualification' && selectedCategory ? selectedCategory.minor.qualificationNote : group.description}</p>{group.kind === 'license' ? <select aria-label="证件类型" className="mt-2 max-w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-bold" value={licenseDocumentType} onChange={(event) => setLicenseDocumentType(event.target.value)} disabled={uploading}><option value="cn_business_license">营业执照</option><option value="cn_company_registration">公司登记文件</option></select> : null}</div>
                <label ref={group.kind === 'license' ? setFieldRef('businessLicenseDocument') as React.Ref<HTMLLabelElement> : undefined} tabIndex={0} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-teal-700 bg-white px-4 text-sm font-black text-teal-800 outline-none focus:ring-2 focus:ring-teal-600">
                  <UploadCloud className="h-4 w-4" />{uploadingKind === group.kind ? '上传中...' : '选择多个文件'}
                  <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={uploading} className="hidden" onChange={(event) => { void uploadDocuments(group.kind, event.currentTarget.files || undefined); event.currentTarget.value = ''; }} />
                </label>
              </div>
              {documents.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{documents.map((document) => <div key={document.token} className="flex min-w-0 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2"><FileText className="h-4 w-4 shrink-0 text-teal-700" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-black" title={document.name}>{document.name}</div>{document.size ? <div className="text-xs font-semibold text-stone-400">{Math.max(1, Math.round(document.size / 1024))} KB</div> : null}</div><button type="button" onClick={() => removeDocument(document.token)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-stone-200 text-stone-500" aria-label={`移除 ${document.name}`}><X className="h-4 w-4" /></button></div>)}</div> : <div className="mt-3 text-sm font-semibold text-stone-400">尚未上传</div>}
              {group.kind === 'license' && errors.businessLicenseDocument ? <p className="mt-2 text-sm font-bold text-red-600">{errors.businessLicenseDocument}</p> : null}
              {group.kind === 'license' && licenseCandidateWarning ? <p role="status" className="mt-2 text-sm font-bold text-amber-800">{licenseCandidateWarning}</p> : null}
              {group.kind === 'license' && ocrInfo ? <div className={`mt-3 rounded-lg border p-3 text-sm font-bold ${ocrInfo.verificationStatus === 'manual_review' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-teal-100 bg-teal-50 text-teal-900'}`}><div>{ocrInfo.verificationStatus === 'manual_review' ? '待人工核验' : '已识别 · 待确认'}{ocrInfo.provider ? ` · 来源：${recognitionSourceLabels[ocrInfo.provider] || '文件识别'}` : ''}{ocrInfo.documentType ? ` · ${documentTypeLabels[ocrInfo.documentType] || '证件资料'}` : ''}</div>{ocrInfo.missingFields?.length ? <div className="mt-1 text-amber-800">缺失：{ocrInfo.missingFields.map(ocrFieldName).join('、')}</div> : null}{ocrInfo.lowConfidenceFields?.length ? <div className="mt-1 text-amber-800">低信心：{ocrInfo.lowConfidenceFields.map(ocrFieldName).join('、')}</div> : null}{ocrInfo.confidence ? <div className="mt-1 text-stone-600">信心度：{Object.entries(ocrInfo.confidence).filter(([, value]) => Number(value) > 0).slice(0, 6).map(([field, value]) => `${ocrFieldName(field)} ${Math.round(Number(value) * 100)}%`).join('、')}</div> : null}{ocrInfo.warnings?.length ? <div className="mt-1 text-amber-800">{ocrInfo.warnings[0]}</div> : null}{ocrInfo.skippedFields?.length ? <div className="mt-1 text-stone-600">未覆盖已手动修改：{ocrInfo.skippedFields.map(ocrFieldName).join('、')}</div> : null}<button type="button" disabled={!lastLicenseFile || uploading} className="mt-2 rounded border border-teal-700 bg-white px-3 py-1 text-xs font-black text-teal-800 disabled:opacity-40" onClick={() => { if (lastLicenseFile) void uploadDocuments('license', [lastLicenseFile], true); }}>重新辨识</button></div> : null}
            </div>;
          })}
        </div>
      </section>
      <div><label className="label">品牌招商推荐码（选填）</label><input className="input-field uppercase" value={form.referrerBrandCode} onChange={(e) => { updateField('referrerBrandCode', e.target.value.toUpperCase()); setForm((current) => ({ ...current, referrerBrandId: '' })); }} placeholder="例如 BKF-CN-001" /></div>
      <div><label className="label">招商推荐商毛利分润</label><div className={`flex items-center rounded-lg border bg-white pr-3 ${errors.referrerRewardRate ? 'border-red-400' : 'border-stone-300'}`}><input ref={setFieldRef('referrerRewardRate') as React.Ref<HTMLInputElement>} type="number" min="0" max="100" step="0.1" className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none" value={form.referrerRewardRate} disabled={!form.referrerBrandCode && !form.referrerBrandId} onChange={(e) => updateField('referrerRewardRate', e.target.value)} /><span className="font-bold text-stone-500">%</span></div>{errors.referrerRewardRate ? <p className="mt-1 text-sm font-bold text-red-600">{errors.referrerRewardRate}</p> : null}</div>
      <div className="md:col-span-2"><button disabled={submitting || uploading} className="btn-primary">{uploading ? '文件上传中...' : submitting ? '提交中...' : latest?.status === 'rejected' ? '补充后重新提交' : '提交平台审核'}</button></div>
    </form> : null}
  </div></main>;
}

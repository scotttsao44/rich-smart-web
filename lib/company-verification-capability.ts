import type { EvidenceSubject } from './brand-document-evidence-verification';
import type { ReviewApplication, BrandDocumentReviewRecord } from './brand-document-review';

export type CompanyVerificationSourceState =
  | 'not_configured' | 'not_approved' | 'not_found' | 'multiple_results'
  | 'permission_denied' | 'rate_limited' | 'unavailable' | 'stale_snapshot'
  | 'name_change_reported' | 'observation_provided';

export type CompanyVerificationTarget = {
  application: Pick<ReviewApplication, 'id' | 'companyName' | 'registrationNo'>;
  snapshotId: string;
  subject: Pick<EvidenceSubject, 'role' | 'subjectKey'>;
};

export type CompanyObservedFields = Pick<BrandDocumentReviewRecord, 'checkedCompanyName' | 'checkedRegistrationNo'>;
export type CompanyVerificationObservation = {
  observationId: string;
  applicationId: ReviewApplication['id'];
  snapshotId: string;
  subject: Pick<EvidenceSubject, 'role' | 'subjectKey'>;
  method: BrandDocumentReviewRecord['method'] | 'synthetic';
  sourceState: CompanyVerificationSourceState;
  records: readonly CompanyObservedFields[];
  manualOutcome?: BrandDocumentReviewRecord['outcome'];
  reportedHttpStatus?: number;
};

export function companyVerificationCapability() {
  return {
    scope: 'company' as const,
    networkAdapter: 'disabled' as const,
    configured: false as const,
    approved: false as const,
    trustedOfficialEvidenceAvailable: false as const,
  };
}

const unavailableStates: Record<Exclude<CompanyVerificationSourceState, 'name_change_reported' | 'observation_provided'>, string> = {
  not_configured: '官方来源尚未配置；没有发起官方查询。',
  not_approved: '尚未取得官方接入批准；不能进行自动官方查验。',
  not_found: '提供的观察声称未查得结果；不等于公司不存在或资料为假。',
  multiple_results: '提供的观察有多个结果，尚不能确定主体。',
  permission_denied: '来源访问权限不足，不能据此判断资料真伪。',
  rate_limited: '来源观察报告限流（429），不能据此判断资料真伪。',
  unavailable: '来源观察暂不可用，不能据此判断资料真伪。',
  stale_snapshot: '观察对应旧申请快照，拒绝套用到当前资料。',
};
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const snapshot = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Offline comparison only: no path in this module can create official evidence.
export function assessCompanyVerificationObservation(target: CompanyVerificationTarget, observation?: CompanyVerificationObservation | null) {
  const declared = { companyName: target.application.companyName, registrationNo: target.application.registrationNo };
  const observed = (observation?.records || []).map(row => ({ checkedCompanyName: row.checkedCompanyName, checkedRegistrationNo: row.checkedRegistrationNo }));
  const result = (code: string, reason: string, disposition: 'unverified' | 'needs_review' = 'unverified', comparison: { companyName: 'exact' | 'different'; registrationNo: 'exact' | 'different' } | null = null) => ({
    capability: companyVerificationCapability(),
    authenticity: 'unverified' as const,
    disposition, code, reason,
    evidenceUse: comparison ? 'offline_comparison_only' as const : 'not_usable' as const,
    trustedOfficialEvidence: false as const,
    canApproveApplication: false as const,
    declared, observed, comparison,
    observationId: observation?.observationId || null,
    method: observation?.method === 'platform_manual' ? 'platform_manual' as const : observation?.method === 'synthetic' ? 'synthetic' as const : null,
    manualOutcome: observation?.method === 'platform_manual' && ['manual_match', 'manual_mismatch', 'unverified'].includes(observation.manualOutcome || '') ? observation.manualOutcome : null,
  });
  if (!Number.isSafeInteger(target.application.id) || target.application.id <= 0 || !snapshot(target.snapshotId) || target.subject.role !== 'company' || !nonempty(target.subject.subjectKey)) return result('invalid_target', '缺少可用公司主体、申请编号或快照，不能绑定观察。');
  if (!observation) return result('not_configured', unavailableStates.not_configured);
  if (!nonempty(observation.observationId) || !['platform_manual', 'synthetic'].includes(observation.method)) return result('unsupported_observation', '仅接受标明来源的人工或合成离线观察，不接受自称官方已核实的通道。');
  if (observation.applicationId !== target.application.id || observation.subject.role !== 'company' || observation.subject.role !== target.subject.role || observation.subject.subjectKey !== target.subject.subjectKey) return result('binding_mismatch', '观察与当前申请、公司角色或 subjectKey 不对应，拒绝套用；这不是造假结论。');
  if (!snapshot(observation.snapshotId) || observation.snapshotId !== target.snapshotId || observation.sourceState === 'stale_snapshot') return result('stale_snapshot', unavailableStates.stale_snapshot);
  if (observation.reportedHttpStatus === 429) return result('rate_limited', unavailableStates.rate_limited);
  if (observation.reportedHttpStatus === 401 || observation.reportedHttpStatus === 403) return result('permission_denied', unavailableStates.permission_denied);
  if (observation.reportedHttpStatus !== undefined && observation.reportedHttpStatus !== 200) return result('unavailable', unavailableStates.unavailable);
  if (Object.hasOwn(unavailableStates, observation.sourceState)) return result(observation.sourceState, unavailableStates[observation.sourceState as keyof typeof unavailableStates]);
  if (!['name_change_reported', 'observation_provided'].includes(observation.sourceState)) return result('unsupported_observation', '未识别的来源状态，保持尚未核实。');
  if (!observed.length) return result('not_found', unavailableStates.not_found);
  if (observed.length !== 1) return result('multiple_results', unavailableStates.multiple_results);
  const row = observed[0];
  if (!nonempty(declared.companyName) || !nonempty(declared.registrationNo) || !nonempty(row.checkedCompanyName) || !nonempty(row.checkedRegistrationNo)) return result('missing_fields', '公司名称或完整证号缺失，不能推定法定主体一致。');
  const comparison = {
    companyName: declared.companyName === row.checkedCompanyName ? 'exact' as const : 'different' as const,
    registrationNo: declared.registrationNo === row.checkedRegistrationNo ? 'exact' as const : 'different' as const,
  };
  if (comparison.registrationNo === 'different') return result('company_id_difference', '完整证号与提供的离线观察不一致，需复核来源、证号类型及主体；不得自动判假。', 'needs_review', comparison);
  if (comparison.companyName === 'different' || observation.sourceState === 'name_change_reported') return result('company_name_review', '名称差异或声称改名需要复核，保留原始名称；不以简繁、去引号或模糊匹配判定法定相等。', 'needs_review', comparison);
  if (observation.method === 'platform_manual' && observation.manualOutcome === 'manual_mismatch') return result('manual_review_difference', '既有人工观察记录了差异；即使提供的两个字段相同，也不能消除该人工待复核事项。', 'needs_review', comparison);
  return result('offline_fields_equal', '离线提供的公司名称与完整证号逐字一致；来源真实性、官方接入和主体授权仍未核实。', 'unverified', comparison);
}

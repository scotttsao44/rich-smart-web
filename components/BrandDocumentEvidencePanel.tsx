import React from 'react';
import { AlertTriangle, Clock3, FileText, HelpCircle } from 'lucide-react';
import type { assessBrandDocumentEvidence, EvidenceStatus } from '../lib/brand-document-evidence-verification';

export type BrandDocumentEvidencePanelProps = {
  assessment?: ReturnType<typeof assessBrandDocumentEvidence> | null;
};

const statuses = {
  mismatch: { label: '资料矛盾', icon: FileText },
  expired: { label: '过期', icon: Clock3 },
  suspicious: { label: '疑点', icon: AlertTriangle },
  unverified: { label: '尚未核实', icon: HelpCircle },
};
const reasons: Record<string, string> = {
  AUTHENTICITY_NOT_ESTABLISHED: '尚无可信官方查验结果；资料一致或自行标记已核实，均不能证明文件真实。',
  ISSUER_OR_CERTIFICATE_MISSING: '缺少签发方或证书编号，尚不能进行证书层级比对；缺值不等于假资料。',
  DATE_INVALID_OR_UNCERTAIN: '日期格式无效或日期尚不确定，不能据此判断过期或造假。',
  DATE_MISSING: '缺少日期，尚不能据此判断过期或造假。',
  EXPIRY_BEFORE_AS_OF: '提供的有效期限早于本次比对日期；此结果不判断法律或医疗效力。',
  DATE_ORDER_CONFLICT: '提供的签发日期晚于到期日期，需核对原有结构化记录。',
  SUBJECTS_MISSING: '未提供分角色主体，不能自动绑定公司、商品或其他关系。',
  ROLE_OR_SUBJECT_KEY_MISSING: '缺少可用角色或主体比对标识，不能推定主体相同。',
  SUBJECT_FIELD_MISSING_OR_UNCERTAIN: '主体字段缺失或不确定，需要核对，不能据此认定造假。',
  MODEL_MISSING_OR_UNCERTAIN: '型号缺失或不确定，尚不能判断型号是否一致。',
  NO_AUTHORITY_COMPARISON: '此角色和主体尚无独立权威比对参考。',
  AUTHORITY_REFERENCES_CONFLICT: '同一角色及主体的权威比对参考互相矛盾，不能择取方便的参考消除疑点。',
  AUTHORITY_ID_MISMATCH: '提供的主体 ID 与独立比对参考不同；同名不能覆盖 ID 矛盾。',
  NAME_ALIAS_UNRESOLVED: '名称尚未对应到已提供的名义别名；简繁、改名或别名差异仍需核对。',
  SCOPE_NOT_ESTABLISHED: '用途或独立核实范围缺失、不确定，尚不能确认用途范围。',
  SCOPE_REFERENCES_CONFLICT: '已提供的用途比对参考互相矛盾，不能选择性采信。',
  CLAIM_OUTSIDE_CHECKED_SCOPE: '声称用途不在已提供的核实范围中；此结果不判断许可或功效。',
  DUPLICATE_RECORD_ID: '来源记录标识重复，需按来源索引区分；重复本身不等于造假。',
  CERTIFICATE_DATE_CONFLICT: '同一签发方和证书编号存在日期矛盾，需核对版本、续期或冒用疑点。',
  CROSS_RECORD_NAME_CONFLICT_UNRESOLVED: '跨记录的同角色名称尚未可靠对应；ID 不确定或参考冲突时，不以别名消除疑点。',
  CROSS_RECORD_FIELD_CONFLICT: '同角色及主体的跨记录 ID 或型号不一致。',
  CERTIFICATE_REUSE_CONFLICT: '同一签发方及证书编号存在同角色 ID 或型号矛盾，需调查冒用或复用可能，不能直接判假。',
};
const display = (value?: string) => value?.trim() ? value : '未提供';
const statusKey = (value: EvidenceStatus): EvidenceStatus => Object.hasOwn(statuses, value) ? value : 'unverified';

const css = `
.brand-evidence-panel{font-family:inherit;color:#20252a;min-width:0;width:100%;box-sizing:border-box;line-height:1.6;letter-spacing:0}
.brand-evidence-panel *{box-sizing:border-box;min-width:0;overflow-wrap:anywhere}
.brand-evidence-panel h2{font-size:20px;line-height:1.4;margin:0;font-weight:700}
.brand-evidence-panel p{margin:8px 0}
.brand-evidence-panel .evidence-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.brand-evidence-panel .evidence-warning{color:#49545b;font-size:14px;border-bottom:1px solid #dce2e5;padding-bottom:16px}
.brand-evidence-panel .evidence-counts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}
.brand-evidence-panel .evidence-count{border-left:3px solid currentColor;padding-left:10px;font-size:14px}
.brand-evidence-panel .evidence-count strong{display:block;font-size:20px;font-variant-numeric:tabular-nums}
.brand-evidence-panel .evidence-list{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.brand-evidence-panel .evidence-finding{border:1px solid #dce2e5;border-radius:6px;padding:16px;background:#fff}
.brand-evidence-panel .evidence-label{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
.brand-evidence-panel .evidence-mismatch{color:#b42335}.brand-evidence-panel .evidence-expired{color:#8a6100}
.brand-evidence-panel .evidence-suspicious{color:#a24c0c}.brand-evidence-panel .evidence-unverified{color:#49545b}
.brand-evidence-panel .evidence-code{color:#56616a;font-size:12px;white-space:normal}
.brand-evidence-panel .evidence-sources{list-style:none;padding:0;margin:12px 0 0;border-top:1px solid #e7ebee}
.brand-evidence-panel .evidence-source{padding:10px 0;border-bottom:1px solid #e7ebee}
.brand-evidence-panel dl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:4px 12px;margin:0;font-size:13px}
.brand-evidence-panel dt{color:#56616a}.brand-evidence-panel dd{margin:0;white-space:pre-wrap}
.brand-evidence-panel .evidence-reference{font-size:13px;color:#49545b;white-space:pre-wrap}
.brand-evidence-panel .evidence-original{font-size:13px;color:#56616a;white-space:pre-wrap}
.brand-evidence-panel .evidence-empty{padding:20px 0;color:#49545b}
@media(max-width:600px){.brand-evidence-panel .evidence-counts{grid-template-columns:repeat(2,minmax(0,1fr))}.brand-evidence-panel dl{grid-template-columns:1fr;gap:2px}.brand-evidence-panel dd{margin-bottom:8px}.brand-evidence-panel .evidence-finding{padding:12px}}
`;

export default function BrandDocumentEvidencePanel({ assessment }: BrandDocumentEvidencePanelProps) {
  const findings = assessment?.findings || [];
  const entries = Object.entries(statuses) as Array<[EvidenceStatus, typeof statuses[EvidenceStatus]]>;
  return (
    <section className="brand-evidence-panel" aria-label="结构化资料核对结果">
      <style>{css}</style>
      <header className="evidence-heading">
        <h2>结构化资料核对</h2>
        <span className="evidence-label evidence-unverified"><HelpCircle size={18} aria-hidden="true" />真实性：尚未核实</span>
      </header>
      <p className="evidence-warning">比对一致不等于文件真实。比对参考尚未核实，未接官方查验来源；本结果不判断法律或医疗效力。</p>
      {!assessment ? <p className="evidence-empty">尚未提供核对结果。</p> : <>
        <p>来源记录：{assessment.records.length} 份 · 核对事项：{findings.length} 项</p>
        <div className="evidence-counts" aria-label="核对事项分类计数">
          {entries.map(([key, meta]) => <div key={key} className={`evidence-count evidence-${key}`}><span>{meta.label}</span><strong>{findings.filter(finding => statusKey(finding.status) === key).length}</strong></div>)}
        </div>
        {!findings.length ? <p className="evidence-empty">{assessment.records.length ? '未列出矛盾或疑点；文件真实性仍尚未核实。' : '尚无结构化来源记录，无法核实。'}</p> : <ol className="evidence-list">
          {findings.map((finding, index) => {
            const key = statusKey(finding.status);
            const meta = statuses[key];
            const Icon = meta.icon;
            return <li key={index} className="evidence-finding">
              <div className={`evidence-label evidence-${key}`}><Icon size={18} style={{ flexShrink: 0 }} aria-hidden="true" />{meta.label}</div>
              <p>{Object.hasOwn(reasons, finding.code) ? reasons[finding.code] : '已提供一项核对事项，请核对下列具体来源；不能据此直接判断真伪。'}</p>
              <code className="evidence-code">{display(finding.code)}</code>
              <p className="evidence-original">原始理由：{display(finding.reason)}</p>
              <ul className="evidence-sources" aria-label="具体字段与来源">
                {(finding.sources || []).map((item, sourceIndex) => <li key={sourceIndex} className="evidence-source"><dl>
                  <dt>来源记录 recordId</dt><dd>{display(item.recordId)}</dd>
                  <dt>来源索引（从 0 起）</dt><dd>{Number.isInteger(item.recordIndex) && item.recordIndex >= 0 ? item.recordIndex : '未提供'}</dd>
                  <dt>字段</dt><dd>{display(item.field)}</dd>
                  <dt>提供值</dt><dd>{display(item.value)}</dd>
                </dl></li>)}
              </ul>
              {!finding.sources?.length ? <p className="evidence-original">字段与来源：未提供，需核对来源。</p> : null}
              {(finding.referenceIds || []).length ? finding.referenceIds.map((referenceId, referenceIndex) => <p key={referenceIndex} className="evidence-reference">未核实比对参考：{display(referenceId)}</p>) : <p className="evidence-reference">未核实比对参考：未提供</p>}
            </li>;
          })}
        </ol>}
      </>}
    </section>
  );
}

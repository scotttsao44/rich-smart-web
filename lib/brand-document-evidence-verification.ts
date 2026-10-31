export type EvidenceRole = 'company' | 'product' | 'insured' | 'policyholder' | 'applicant' | 'patentowner';
export type EvidenceStatus = 'mismatch' | 'expired' | 'suspicious' | 'unverified';
export type EvidenceSubject = {
  role: EvidenceRole;
  subjectKey: string;
  authorityId?: string;
  name?: string;
  model?: string;
  uncertainFields?: Array<'authorityId' | 'name' | 'model'>;
};
export type StructuredDocumentEvidence = {
  recordId: string;
  issuerId?: string;
  certificateNo?: string;
  subjects?: EvidenceSubject[];
  issuedOn?: string;
  expiresOn?: string;
  claimedPurposes?: string[];
  uncertainFields?: Array<'issuedOn' | 'expiresOn' | 'claimedPurposes'>;
  official?: boolean;
  verified?: boolean;
};

// Out-of-band comparison references, never extracted from record flags or aliases.
// The caller must establish provenance; this module cannot authenticate that caller.
export type AuthorityComparisonReference = {
  referenceId: string;
  role: EvidenceRole;
  subjectKey: string;
  authorityId: string;
  canonicalName?: string;
  aliases?: string[];
};
export type ScopeComparisonReference = {
  referenceId: string;
  issuerId: string;
  certificateNo: string;
  checkedScopeIds: string[];
};
export type EvidenceFieldSource = {
  recordId: string;
  recordIndex: number;
  field: string;
  value: string;
};
export type EvidenceFinding = {
  status: EvidenceStatus;
  code: string;
  reason: string;
  sources: EvidenceFieldSource[];
  referenceIds: string[];
};

const roles: EvidenceRole[] = ['company', 'product', 'insured', 'policyholder', 'applicant', 'patentowner'];
const text = (value: string | undefined) => (value || '').trim();
const nameKey = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');

function validDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

export function assessBrandDocumentEvidence(
  records: readonly StructuredDocumentEvidence[],
  options: {
    asOfDate: string;
    authorityReferences?: readonly AuthorityComparisonReference[];
    scopeReferences?: readonly ScopeComparisonReference[];
  },
) {
  if (!validDate(options.asOfDate)) throw new Error('asOfDate must be an explicit valid YYYY-MM-DD date');
  if (records.some(record => !text(record.recordId))) throw new Error('Every evidence record requires a recordId');
  const findings: EvidenceFinding[] = [];
  const add = (status: EvidenceStatus, code: string, reason: string, sources: EvidenceFieldSource[], referenceIds: string[] = []) => {
    findings.push({ status, code, reason, sources, referenceIds });
  };
  const source = (recordIndex: number, field: string, value: string): EvidenceFieldSource => ({ recordId: records[recordIndex].recordId, recordIndex, field, value });
  const subjects: Array<{ recordIndex: number; subjectIndex: number; subject: EvidenceSubject }> = [];
  const subjectSource = (entry: typeof subjects[number], field: 'authorityId' | 'name' | 'model') => source(entry.recordIndex, `subjects[${entry.subjectIndex}].${field}`, text(entry.subject[field]));

  records.forEach((record, recordIndex) => {
    add('unverified', 'AUTHENTICITY_NOT_ESTABLISHED', 'Structured agreement and client official/verified flags do not establish document authenticity; no authenticated official lookup is performed.', [source(recordIndex, 'recordId', record.recordId)]);
    for (const field of ['issuerId', 'certificateNo'] as const) {
      if (!text(record[field])) add('unverified', 'ISSUER_OR_CERTIFICATE_MISSING', 'Missing issuer or certificate number prevents certificate-level comparison; absence is not forgery evidence.', [source(recordIndex, field, '')]);
    }
    for (const field of ['issuedOn', 'expiresOn'] as const) {
      const value = record[field];
      if (!value || record.uncertainFields?.includes(field) || !validDate(value)) {
        add('unverified', value ? 'DATE_INVALID_OR_UNCERTAIN' : 'DATE_MISSING', 'Missing, uncertain or invalid date is not proof of expiry or forgery.', [source(recordIndex, field, value || '')]);
      } else if (field === 'expiresOn' && value < options.asOfDate) {
        add('expired', 'EXPIRY_BEFORE_AS_OF', `Supplied calendar expiry ${value} precedes explicit comparison date ${options.asOfDate}; this is not a legal-effect determination.`, [source(recordIndex, field, value)]);
      }
    }
    if (validDate(record.issuedOn) && validDate(record.expiresOn) && !record.uncertainFields?.includes('issuedOn') && !record.uncertainFields?.includes('expiresOn') && record.issuedOn! > record.expiresOn!) {
      add('mismatch', 'DATE_ORDER_CONFLICT', 'Supplied issue date is after supplied expiry date.', [source(recordIndex, 'issuedOn', record.issuedOn!), source(recordIndex, 'expiresOn', record.expiresOn!)]);
    }
    if (!record.subjects?.length) add('unverified', 'SUBJECTS_MISSING', 'No role-separated subjects were supplied; do not infer a company or product binding.', [source(recordIndex, 'subjects', '')]);
    (record.subjects || []).forEach((subject, subjectIndex) => {
      const entry = { recordIndex, subjectIndex, subject };
      if (!roles.includes(subject.role) || !text(subject.subjectKey)) {
        add('unverified', 'ROLE_OR_SUBJECT_KEY_MISSING', 'A known role and explicit comparison subjectKey are required; no cross-role binding is inferred.', [source(recordIndex, `subjects[${subjectIndex}].role`, subject.role), source(recordIndex, `subjects[${subjectIndex}].subjectKey`, text(subject.subjectKey))]);
        return;
      }
      subjects.push(entry);
      for (const field of ['authorityId', 'name'] as const) {
        if (!text(subject[field]) || subject.uncertainFields?.includes(field)) add('unverified', 'SUBJECT_FIELD_MISSING_OR_UNCERTAIN', 'Missing or uncertain subject fields require review, not a forgery conclusion.', [subjectSource(entry, field)]);
      }
      if (subject.uncertainFields?.includes('model') || (subject.role === 'product' && !text(subject.model))) add('unverified', 'MODEL_MISSING_OR_UNCERTAIN', 'Missing or uncertain product model does not establish a mismatch or forgery.', [subjectSource(entry, 'model')]);
      const refs = (options.authorityReferences || []).filter(ref => ref.role === subject.role && ref.subjectKey === subject.subjectKey && text(ref.authorityId));
      if (!refs.length) add('unverified', 'NO_AUTHORITY_COMPARISON', 'No separate authority comparison reference exists for this exact role and subjectKey.', [subjectSource(entry, 'authorityId')]);
      if (new Set(refs.map(ref => text(ref.authorityId))).size > 1) {
        add('unverified', 'AUTHORITY_REFERENCES_CONFLICT', 'Comparison references themselves disagree; do not choose one as proof.', [subjectSource(entry, 'authorityId')], refs.map(ref => ref.referenceId));
        return;
      }
      for (const ref of refs) {
        if (text(subject.authorityId) && !subject.uncertainFields?.includes('authorityId') && text(subject.authorityId) !== text(ref.authorityId)) {
          add('mismatch', 'AUTHORITY_ID_MISMATCH', `Supplied ${subject.role} identifier differs from separate comparison identifier ${ref.authorityId}; a shared name cannot override IDs.`, [subjectSource(entry, 'authorityId')], [ref.referenceId]);
        }
        const names = [ref.canonicalName || '', ...(ref.aliases || [])].filter(Boolean).map(nameKey);
        if (text(subject.name) && !subject.uncertainFields?.includes('name') && names.length && !names.includes(nameKey(subject.name!))) {
          add('unverified', 'NAME_ALIAS_UNRESOLVED', 'Name is outside provided canonical/alias comparison names; script variants, renaming and aliases need review, not a forgery conclusion.', [subjectSource(entry, 'name')], [ref.referenceId]);
        }
      }
    });
    const purposes = (record.claimedPurposes || []).map(value => text(value)).filter(Boolean);
    const scopeRefs = (options.scopeReferences || []).filter(ref => text(record.issuerId) && text(record.certificateNo) && text(ref.issuerId) === text(record.issuerId) && text(ref.certificateNo) === text(record.certificateNo));
    if (!purposes.length || record.uncertainFields?.includes('claimedPurposes') || !scopeRefs.length) {
      add('unverified', 'SCOPE_NOT_ESTABLISHED', 'Missing/uncertain purpose or missing separate checked scope cannot establish permitted use.', [source(recordIndex, 'claimedPurposes', (record.claimedPurposes || []).join(', '))]);
    } else {
      const sets = scopeRefs.map(ref => JSON.stringify(Array.from(new Set(ref.checkedScopeIds)).sort()));
      if (new Set(sets).size > 1) {
        add('unverified', 'SCOPE_REFERENCES_CONFLICT', 'Separate scope references disagree; no permitted use is inferred.', [source(recordIndex, 'claimedPurposes', purposes.join(', '))], scopeRefs.map(ref => ref.referenceId));
      } else {
        for (const purpose of purposes) {
          if (!scopeRefs[0].checkedScopeIds.includes(purpose)) add('mismatch', 'CLAIM_OUTSIDE_CHECKED_SCOPE', 'Claimed purpose is not in the separately provided checked scope; this is not a legal/medical efficacy judgment.', [source(recordIndex, 'claimedPurposes', purpose)], scopeRefs.map(ref => ref.referenceId));
        }
      }
    }
  });

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (records[i].recordId === records[j].recordId) add('unverified', 'DUPLICATE_RECORD_ID', 'Duplicate source identifiers make provenance ambiguous; duplication alone is not evidence of forgery.', [source(i, 'recordId', records[i].recordId), source(j, 'recordId', records[j].recordId)]);
      if (text(records[i].issuerId) && text(records[i].certificateNo) && text(records[i].issuerId) === text(records[j].issuerId) && text(records[i].certificateNo) === text(records[j].certificateNo)) {
        for (const field of ['issuedOn', 'expiresOn'] as const) {
          if (validDate(records[i][field]) && validDate(records[j][field]) && !records[i].uncertainFields?.includes(field) && !records[j].uncertainFields?.includes(field) && records[i][field] !== records[j][field]) add('suspicious', 'CERTIFICATE_DATE_CONFLICT', 'Same issuer/certificate has conflicting supplied dates; version/renewal or misuse needs investigation, not a forgery verdict.', [source(i, field, records[i][field]!), source(j, field, records[j][field]!), source(i, 'certificateNo', records[i].certificateNo!), source(j, 'certificateNo', records[j].certificateNo!)]);
        }
      }
    }
  }
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const left = subjects[i];
      const right = subjects[j];
      if (left.subject.role !== right.subject.role || left.recordIndex === right.recordIndex) continue;
      const lRecord = records[left.recordIndex];
      const rRecord = records[right.recordIndex];
      const sameSubject = left.subject.subjectKey === right.subject.subjectKey;
      const sameCertificate = Boolean(text(lRecord.issuerId) && text(lRecord.certificateNo) && text(lRecord.issuerId) === text(rRecord.issuerId) && text(lRecord.certificateNo) === text(rRecord.certificateNo));
      if (!sameSubject && !sameCertificate) continue;
      for (const field of ['authorityId', 'name', 'model'] as const) {
        const lValue = text(left.subject[field]);
        const rValue = text(right.subject[field]);
        if (!lValue || !rValue || left.subject.uncertainFields?.includes(field) || right.subject.uncertainFields?.includes(field)) continue;
        if ((field === 'name' ? nameKey(lValue) === nameKey(rValue) : lValue === rValue)) continue;
        const sources = [subjectSource(left, field), subjectSource(right, field)];
        if (field === 'name') {
          const refs = (options.authorityReferences || []).filter(ref => ref.role === left.subject.role && ref.subjectKey === left.subject.subjectKey && text(ref.authorityId));
          const referenceIds = new Set(refs.map(ref => text(ref.authorityId)));
          // Check the complete reference set before using any convenient alias subset.
          const aliasEligible = sameSubject
            && !left.subject.uncertainFields?.includes('authorityId')
            && !right.subject.uncertainFields?.includes('authorityId')
            && Boolean(text(left.subject.authorityId))
            && text(left.subject.authorityId) === text(right.subject.authorityId)
            && referenceIds.size === 1
            && referenceIds.has(text(left.subject.authorityId));
          const aliasMatched = aliasEligible && refs.some(ref => {
            const names = [ref.canonicalName || '', ...(ref.aliases || [])].filter(Boolean).map(nameKey);
            return names.includes(nameKey(lValue)) && names.includes(nameKey(rValue));
          });
          if (!aliasMatched) add('unverified', 'CROSS_RECORD_NAME_CONFLICT_UNRESOLVED', 'Same-role names differ without an established shared alias mapping; name/script differences alone are not forgery evidence.', sources);
        } else {
          if (sameSubject) add('mismatch', 'CROSS_RECORD_FIELD_CONFLICT', `Same-role, same-subject ${field} values disagree.`, sources);
          if (sameCertificate) add('suspicious', 'CERTIFICATE_REUSE_CONFLICT', `Same issuer and certificate number has contradictory same-role ${field} values; possible reuse/impersonation requires investigation, not a fake verdict.`, [...sources, source(left.recordIndex, 'issuerId', text(lRecord.issuerId)), source(left.recordIndex, 'certificateNo', text(lRecord.certificateNo)), source(right.recordIndex, 'issuerId', text(rRecord.issuerId)), source(right.recordIndex, 'certificateNo', text(rRecord.certificateNo))]);
        }
      }
    }
  }
  return {
    authenticity: 'unverified' as const,
    officialLookupPerformed: false as const,
    findings,
    records: records.map((record, recordIndex) => ({
      recordId: record.recordId, recordIndex,
      statuses: Array.from(new Set(findings.filter(finding => finding.sources.some(item => item.recordIndex === recordIndex)).map(finding => finding.status))),
    })),
  };
}

import type { DocumentFieldCandidate, DocumentTextPage, IntakeDocumentKind } from './cn-brand-document-identification';
import { candidateFromMatch, compactDocumentText, documentDate, documentMarkerText, extractLabelledDocumentField } from './cn-document-field-layout';

type Spec = { key: string; labels: string };
const reports: Spec[] = [
  { key: 'productionMonth', labels: '生产日期|生產日期' },
  { key: 'inspectionCategory', labels: '检验类别|檢驗類別' },
  { key: 'testSupply', labels: 'Ratings|测试电源|測試電源' },
  { key: 'factoryName', labels: 'Factory(?:\\s+Name)?|工厂名称|工廠名稱' },
  { key: 'seriesModels', labels: 'Series\\s+Models?|系列型号|系列型號' },
  { key: 'declaredPower', labels: '标称功率|標稱功率' },
  { key: 'laboratoryRegistrationNo', labels: '实验室注册号|實驗室註冊號' },
  { key: 'calibrationExpiryDate', labels: '校准有效期|校準有效期|Calibration\\s+Expiry' },
];
const patents: Spec[] = [
  { key: 'certificateNo', labels: '证书号(?:第)?|證書號(?:第)?' },
  { key: 'publicationNo', labels: '授权公告号|授權公告號' },
  { key: 'applicantAtApplicationName', labels: '申请日时申请人|申請日時申請人' },
  { key: 'statedPatentPeriod', labels: '专利权期间|專利權期間|專利権期間' },
];
const insurance: Spec[] = [
  { key: 'retroactiveDate', labels: '追溯日|追溯日期' },
  { key: 'printDate', labels: '列印日期|打印日期' },
  { key: 'estimatedSales', labels: '预计销售额|預計銷售額|保險期間內預估銷售總金額|保險期間内預估銷售總金額' },
  { key: 'premium', labels: '預收保險費|预收保险费|保險費|保险费' },
  { key: 'deductible', labels: '每一意外事故自負額|每次事故免赔额|每次事故免賠額' },
  { key: 'coverageBasisAsWritten', labels: '承保基础|承保基礎' },
  { key: 'bodilyInjuryPerPersonLimit', labels: '每一個人身體傷害|每次事故人身伤亡责任限额' },
  { key: 'bodilyInjuryPerOccurrenceLimit', labels: '每一意外事故身體傷害|每次事故人身傷害責任限額' },
  { key: 'propertyDamagePerOccurrenceLimit', labels: '每一意外事故財物損失|每次事故财产损失责任限额|每次事故財產損失責任限額' },
  { key: 'combinedPerOccurrenceLimit', labels: '每一意外事故體傷及財損|每次事故责任限额|每次事故責任限額' },
  { key: 'aggregateLimit', labels: '保險期間内之累計保險金額|保險期間內之累計保險金額|累计责任限额|累計責任限額' },
];

export function supplementalDocumentFields(kind: IntakeDocumentKind, pages: DocumentTextPage[]) {
  const specs = ['inspection_report', 'wavelength_test_report', 'emc_test_report', 'conformity_certificate'].includes(kind) ? reports
    : kind === 'patent_document' ? patents : kind === 'insurance_document' ? insurance : [];
  const fields: Record<string, DocumentFieldCandidate> = {};
  const labels = specs.map(spec => spec.labels).join('|');
  const add = (key: string, candidate?: DocumentFieldCandidate) => { if (candidate) fields[key] = candidate; };
  for (const spec of specs) add(spec.key, extractLabelledDocumentField(pages, { ...spec, role: 'document' }, labels));
  if (fields.seriesModels) {
    const source = fields.seriesModels.sources[0];
    const page = pages.find(page => page.page === source.page);
    const lines = page?.lines?.length ? page.lines : page?.text.split('\n').map(text => ({ text, confidence: page.extractor === 'deterministic' ? 0.72 : 0 }));
    if (lines && !page?.lines?.some(line => Number.isFinite(line.x))) {
      const index = lines.findIndex(line => /^Series\s+Models?\b/i.test(line.text.trim()));
      const fragments = [];
      for (let offset = index + 1; index >= 0 && offset < lines.length && offset <= index + 4; offset++) {
        const line = lines[offset];
        if (/^(?:Main\s+Model|Applicant|Manufacturer|Factory|Name|Address|Standard|Test\s+Report|Related|Ratings)\b/i.test(line.text.trim())) break;
        if (line.text.trim()) fragments.push(line);
      }
      const anchor = lines[index];
      if (anchor && fragments.length) {
        const inline = anchor.text.replace(/^Series\s+Models?\s*[:：]?\s*/i, '');
        fields.seriesModels.value = [inline, ...fragments.map(line => compactDocumentText(line.text))].filter(Boolean).join(' ');
        fields.seriesModels.sources = [{ ...source, rawText: [anchor.text, ...fragments.map(line => line.text)].join('\n'), confidence: Math.min(Number(anchor.confidence) || 0, ...fragments.map(line => Number(line.confidence) || 0)) }];
      }
    }
  }
  if (fields.productionMonth) {
    const match = fields.productionMonth.value.match(/^(\d{4})[-年]?(\d{2})(?:月)?$/);
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) fields.productionMonth.value = `${match[1]}-${match[2]}`;
  }
  const roc = pages.some(page => /民國|民国|中華民國|中华民国/.test(page.text));
  for (const key of ['retroactiveDate', 'printDate', 'calibrationExpiryDate']) if (fields[key]) {
    const date = documentDate(fields[key].value, roc);
    if (date) fields[key].value = date;
  }
  if (kind === 'patent_document') {
    const period = fields.statedPatentPeriod;
    if (period) {
      const dates = period.value.match(/\d{3,4}\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}\s*日?/g) || [];
      const normalized = dates.map(date => documentDate(date, roc)).filter(Boolean);
      if (normalized.length === 2) period.value = normalized.join(' 至 ');
    }
    if (fields.certificateNo) fields.certificateNo.value = fields.certificateNo.value.replace(/[号號]$/, '').trim();
    add('documentJurisdiction', candidateFromMatch(pages, /(中華民國|中华人民共和国|中華人民共和國)/, 'document'));
    add('documentCaution', candidateFromMatch(pages, /^(.*(?:不得进行警告|不得進行警告|年费|年費)[^\n]*)$/, 'document'));
  }
  if (kind === 'insurance_document') {
    add('priorPolicyNo', candidateFromMatch(pages, /本保[单單]係?\s*([^\n]{5,40}?[号號])保[单單]续?續?保/, 'document'));
    add('documentSerialNo', candidateFromMatch(pages, /^No\.\s*(\d{8,30})$/, 'document'));
    if (!fields.deductible) add('deductible', candidateFromMatch(pages, /((?:每次事故免[赔賠][额額])[^。\n]{1,80})/, 'document'));
    if (!fields.estimatedSales) add('estimatedSales', candidateFromMatch(pages, /(?:銷售總金額|销售总金额)\s*(NT\$[\d,]+(?:\.\d+)?)/, 'document'));
  }
  if (['inspection_report', 'wavelength_test_report', 'emc_test_report', 'conformity_certificate'].includes(kind)) {
    if (!fields.laboratoryRegistrationNo) add('laboratoryRegistrationNo', candidateFromMatch(
      pages.filter(page => /Test\s+(?:Location|Site)\b/i.test(page.text)),
      /^Registration\s*(?:No\.?|Number)\s*[:：]\s*(L\d{3,8})\b/i, 'document'));
    if (!fields.calibrationExpiryDate) {
      for (const page of pages) {
        if (page.sensitive) continue;
        const lines = page.lines?.length ? page.lines : page.text.split('\n').map(text => ({ text, confidence: page.extractor === 'deterministic' ? 0.72 : 0 }));
        for (let index = 0; index < lines.length; index++) {
          const anchor = lines[index];
          const label = documentMarkerText(anchor.text).match(/校准有效期\s*(?:至|[:：])?\s*(\d{3,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)?\s*$/);
          if (!label) continue;
          // A wrapped expiry must immediately continue its label on the same page.
          const next = lines[index + 1];
          const continuation = !label[1] && next ? documentMarkerText(next.text).match(/^\s*至\s*(\d{3,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s*$/) : null;
          const date = documentDate(label[1] || continuation?.[1] || '', roc);
          if (!date) continue;
          const evidence = continuation ? [anchor, next] : [anchor];
          add('calibrationExpiryDate', { value: date, role: 'document', needsReview: true, sources: [{ page: page.page, extractor: page.extractor,
            rawText: evidence.map(line => line.text).join('\n'), confidence: Math.min(...evidence.map(line => Number.isFinite(line.confidence) ? Math.min(Math.max(Number(line.confidence), 0), 1) : 0)) }] });
          break;
        }
        if (fields.calibrationExpiryDate) break;
      }
    }
    if (!fields.testSupply) add('testSupply', candidateFromMatch(pages, /\b(\d{2,3}\s*V\s*\/\s*\d{2,3}\s*Hz)\b/i, 'document'));
    add('referencedDirective', candidateFromMatch(pages, /(2014\s*\/\s*30\s*\/\s*EU)/i, 'document', value => value.replace(/\s/g, '')));
    add('resultScope', candidateFromMatch(pages, /^(.*(?:结果仅适用于|結果僅適用於|only\s+applicable\s+to|applies\s+to\s+the\s+tested\s+sample)[^\n]*)$/i, 'document'));
    add('photoScope', candidateFromMatch(pages, /^(.*(?:检验检测报告照片页|檢驗檢測報告照片頁)[^\n]*)$/, 'document'));
    add('crossReferencedNo', candidateFromMatch(pages, /(?:报告编号|報告編號)[为為]\s*([A-Z0-9]{8,40})/, 'document'));
    add('overlapAsWritten', candidateFromMatch(pages.filter(page => /檢測結果|检测结果/.test(page.text)), /(\d{1,3}\s*%[（(]按\s*ASTM[^\n]{0,40})/, 'document'));
  }
  if (kind === 'agency_classification_letter') {
    const labelledProduct = extractLabelledDocumentField(pages, { key: 'productName', role: 'subject', labels: '產品名稱|产品名称|器材名稱|器材名称' }, '產品名稱|产品名称|器材名稱|器材名称');
    if (!labelledProduct) add('productName', candidateFromMatch(pages, /本案[產产]品\s*「([^「」\n]{1,120})」/, 'subject'));
    add('statedValidityDuration', candidateFromMatch(pages, /(有效期限[叁三]年)/, 'document'));
    add('documentCaution', candidateFromMatch(pages, /^(.*(?:不得为医疗效能|不得為醫療效能|不得標示或宣傳醫療效能|不得标示或宣传医疗效能)[^\n]*)$/, 'document'));
  }
  // These are literal document statements, not efficacy, validity or ownership findings.
  for (const key of Object.keys(fields)) if (!documentMarkerText(fields[key].value)) delete fields[key];
  return fields;
}

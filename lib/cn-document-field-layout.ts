import type { DocumentFieldCandidate, DocumentSubjectRole, DocumentTextPage } from './cn-brand-document-identification';

const variantPairs = '檢检驗验測测試试報报證证書书稱称樣样號号規规格格單单位位廠厂製制體体險险幣币區区臺台灣湾發发專专權权設设計计實实準准譜谱長长療疗醫医備备註注認认構构術术營营業业廣广東东國国華华轉转讓让資资產产責责任任約约期期間间後后復复時时從从'.match(/../g) || [];
const variantMap = Object.fromEntries(variantPairs.map(pair => [pair[0], pair[1]]));
const hanSpacing = new RegExp('(\\p{Script=Han})[ \\t\\u00a0\\u3000]+(?=\\p{Script=Han})', 'gu');
export function compactDocumentText(value: string) { return value.replace(hanSpacing, '$1').replace(/\r/g, '\n').trim(); }
export function documentMarkerText(value: string) { return Array.from(compactDocumentText(value)).map(char => variantMap[char] || char).join(''); }
const score = (value: unknown) => Number.isFinite(Number(value)) ? Math.min(Math.max(Number(value), 0), 1) : 0;
export type DocumentFieldRule = { key: string; role: DocumentSubjectRole; labels: string };

export function extractLabelledDocumentField(pages: DocumentTextPage[], rule: DocumentFieldRule, allLabels: string): DocumentFieldCandidate | undefined {
  const values: string[] = [];
  const sources: DocumentFieldCandidate['sources'] = [];
  const label = documentMarkerText(rule.labels);
  const prefix = new RegExp(`^(?:${label})(?![A-Za-z\\p{Script=Han}])[ \\t]*[:：]?[ \\t]*`, 'iu');
  const exactLabel = new RegExp(`^(?:${label})[ \\t]*[:：]?$`, 'i');
  const anyLabel = new RegExp(`^(?:${documentMarkerText(allLabels)})[ \\t]*(?:[:：]|$)`, 'i');
  const nextLabel = new RegExp(`(?:${documentMarkerText(allLabels)})[ \\t]*(?:[:：]|(?=\\d))`, 'i');
  for (const page of pages) {
    if (page.sensitive) continue;
    let lines: NonNullable<DocumentTextPage['lines']> = page.lines?.length ? page.lines : page.text.split(/\r?\n/).map(text => ({ text, confidence: page.extractor === 'deterministic' ? 0.72 : 0 }));
    const longLines = lines.filter(line => line.text.length >= 5 && Number.isFinite(line.width) && Number.isFinite(line.height));
    // Vision can return sideways page coordinates even though the text is upright.
    if (longLines.length && longLines.filter(line => Number(line.height) > Number(line.width) * 2).length > longLines.length * 0.6) {
      lines = lines.map(line => ({ ...line, x: Number(line.y), y: 1 - Number(line.x) - Number(line.width), width: line.height, height: line.width }));
    }
    for (let index = 0; index < lines.length; index += 1) {
      const anchor = lines[index];
      let raw = compactDocumentText(anchor.text), normalized = documentMarkerText(raw);
      if (!prefix.test(normalized) && ['receiptDate', 'testDate', 'issueDate'].includes(rule.key)) {
        const inline = normalized.match(new RegExp(`(?:^|\\s)(?:${label})[ \\t]*[:：]?[ \\t]*(?=\\d{4}[./-])`, 'i'));
        if (inline?.index != null) { raw = raw.slice(inline.index).trim(); normalized = documentMarkerText(raw); }
      }
      const match = normalized.match(prefix);
      if (!match) continue;
      let value = raw.slice(match[0].length).trim();
      const evidence = [anchor];
      if (!value || exactLabel.test(normalized)) {
        if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
          const center = Number(anchor.y) + Number(anchor.height || 0) / 2;
          const sameRow = lines.filter(line => line !== anchor && Number.isFinite(line.x) && Number.isFinite(line.y)
            && Math.abs(Number(line.y) + Number(line.height || 0) / 2 - center) < Math.max(Number(anchor.height || 0) * 0.65, 0.011));
          const labelRows = sameRow.filter(line => anyLabel.test(documentMarkerText(line.text)));
          const leftLimit = Math.max(...labelRows.filter(line => Number(line.x) < Number(anchor.x)).map(line => Number(line.x) + Number(line.width || 0)), 0);
          const rightLimit = Math.min(...labelRows.filter(line => Number(line.x) > Number(anchor.x)).map(line => Number(line.x)), 1);
          const numericPower = ['ratedPower', 'measuredPower'].includes(rule.key);
          const candidates = sameRow.filter(line => !anyLabel.test(documentMarkerText(line.text)))
            .filter(line => !numericPower || /^\d+(?:\.\d+)?\s*(?:W)?$/.test(line.text.trim()))
            .filter(line => Number(line.x) >= leftLimit && Number(line.x) + Number(line.width || 0) <= rightLimit + 0.005)
            .sort((a, b) => Math.min(Math.abs(Number(a.x) - (Number(anchor.x) + Number(anchor.width || 0))), Math.abs(Number(a.x) + Number(a.width || 0) - Number(anchor.x)))
              - Math.min(Math.abs(Number(b.x) - (Number(anchor.x) + Number(anchor.width || 0))), Math.abs(Number(b.x) + Number(b.width || 0) - Number(anchor.x))));
          if (!candidates.length && numericPower) {
            const columnValues = lines.filter(line => /^\d+(?:\.\d+)?\s*(?:W)?$/.test(line.text.trim())
              && Number(line.x) >= Number(anchor.x) - 0.005 && Number(line.x) + Number(line.width || 0) <= Number(anchor.x) + Number(anchor.width || 0) + 0.005
              && Number(line.y) < Number(anchor.y) && Number(anchor.y) - Number(line.y) < 0.09)
              .sort((a, b) => Number(b.y) - Number(a.y));
            if (columnValues.length) candidates.push(columnValues[0]);
          }
          if (candidates.length) {
            const chosen = candidates[0];
            const fragments = [chosen];
            if (['testDate', 'standards', 'documentConclusion'].includes(rule.key)) {
              const left = Number(chosen.x);
              const belowLimit = Math.max(...lines.filter(line => anyLabel.test(documentMarkerText(line.text)) && Number(line.y) < Number(anchor.y) - Number(anchor.height || 0)).map(line => Number(line.y) + Number(line.height || 0)), 0);
              fragments.push(...lines.filter(line => line !== chosen && line !== anchor && !anyLabel.test(documentMarkerText(line.text))
                && Number(line.x) >= left - 0.025 && Number(line.x) + Number(line.width || 0) <= rightLimit + 0.005
                && Number(line.y) < Number(chosen.y) && Number(line.y) >= belowLimit
                && Number(chosen.y) - Number(line.y) <= Math.max(Number(chosen.height || 0) * 4, 0.045)
                && (rule.key === 'testDate' ? /\d{3,4}\s*(?:年|[-/])/.test(line.text) : rule.key === 'standards' ? /^(?:GB|EN|ASTM|IEC|ISO)\b/.test(line.text) : true)));
              if (rule.key === 'standards') fragments.push(...lines.filter(line => line !== chosen && Number(line.y) > Number(chosen.y)
                && Number(line.y) - Number(chosen.y) < 0.035 && Number(line.x) >= left - 0.025 && /^(?:GB|EN|ASTM|IEC|ISO)\b/.test(line.text)));
            }
            fragments.sort((a, b) => Number(b.y) - Number(a.y) || Number(a.x) - Number(b.x));
            value = fragments.map(line => compactDocumentText(line.text)).join(' ');
            evidence.push(...fragments);
          }
        } else {
          const next = lines[index + 1];
          if (next && !anyLabel.test(documentMarkerText(next.text))) { value = compactDocumentText(next.text); evidence.push(next); }
        }
      }
      if (rule.key === 'standards' && !Number.isFinite(anchor.x)) {
        for (let forward = index + 1; forward < lines.length && forward <= index + 6; forward += 1) {
          const continuation = lines[forward];
          if (!/^(?:GB|EN|ASTM|IEC|ISO)\b/.test(continuation.text.trim())) break;
          if (!evidence.includes(continuation)) { value += ` ${compactDocumentText(continuation.text)}`; evidence.push(continuation); }
        }
      }
      if (!value) continue;
      const boundary = documentMarkerText(value).match(nextLabel);
      if (boundary?.index && boundary.index > 0) value = value.slice(0, boundary.index).trim();
      if (!value || anyLabel.test(documentMarkerText(value))) continue;
      values.push(value.slice(0, 1000));
      sources.push({ page: page.page, rawText: evidence.map(line => line.text).join('\n').slice(0, 1500), confidence: Math.min(...evidence.map(line => score(line.confidence))), extractor: page.extractor });
    }
  }
  if (!values.length) return;
  const stableValues = values.map(value => documentMarkerText(value).replace(/\s/g, '').toLowerCase());
  return { value: values[0], role: rule.role, sources, needsReview: true, ...(new Set(stableValues).size > 1 ? { conflict: true } : {}) };
}

const englishMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// Only standard month tokens qualify; a month prefix in a word is not a date.
const englishMonthDate = new RegExp('(?:^|[^\\p{L}\\p{M}\\p{N}_.])(January|February|March|April|May|June|July|August|September|October|November|December|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?)\\s+(\\d{1,2}),?\\s+(\\d{4})(?![\\p{L}\\p{M}\\p{N}_])', 'iu');

export function documentDate(value: string, rocContext = false) {
  let normalized = documentMarkerText(value).replace(/二十四时/g, '24时').replace(/零时/g, '0时').replace(/中午\s*/g, '');
  const namedMonth = normalized.match(englishMonthDate);
  if (namedMonth) {
    const token = namedMonth[1].toLowerCase().replace(/\.$/, '');
    const month = englishMonths.findIndex(name => name === token || name.slice(0, 3) === token || name === 'september' && token === 'sept') + 1;
    normalized = `${namedMonth[3]}-${month}-${namedMonth[2]}`;
  }
  const match = normalized.match(/(?:民国)?\s*(\d{3,4})\s*(?:年|[./-])\s*(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})\s*(?:时|:)(\d{1,2})?\s*分?)?/);
  if (!match) return '';
  let year = Number(match[1]);
  if (match[1].length === 3 && (rocContext || /民国/.test(normalized))) year += 1911;
  if (year < 1900 || year > 2200) return '';
  const month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  const base = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (match[4] == null) return base;
  const hour = Number(match[4]), minute = Number(match[5] || 0);
  if (hour > 24 || minute > 59 || hour === 24 && minute !== 0) return '';
  return `${base} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function candidateFromMatch(pages: DocumentTextPage[], expression: RegExp, role: DocumentSubjectRole, transform: (value: string, text: string) => string = value => value): DocumentFieldCandidate | undefined {
  for (const page of pages) {
    if (page.sensitive) continue;
    const lines = page.lines?.length ? page.lines : page.text.split(/\r?\n/).map(text => ({ text, confidence: page.extractor === 'deterministic' ? 0.72 : 0 }));
    for (const line of lines) {
      const working = compactDocumentText(line.text);
      const match = working.match(expression);
      if (!match) continue;
      const value = transform(match[1] || match[0], page.text);
      if (!value) continue;
      return { value, role, sources: [{ page: page.page, rawText: line.text.slice(0, 1500), confidence: score(line.confidence), extractor: page.extractor }], needsReview: true };
    }
  }
}

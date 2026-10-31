export type StoreDocumentDraft = {
  name?: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  depositAmount?: string;
};

function cleanLine(value: string) {
  return value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function labelledValue(lines: string[], labels: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = line.match(new RegExp(`^${escaped}\\s*[:：]?\\s*(.*)$`, 'i'));
      if (!match) continue;
      if (match[1]) return cleanLine(match[1]);
      return cleanLine(lines[index + 1] || '');
    }
  }
  return '';
}

export function storeDraftFromDocumentText(source: string) {
  const lines = source.split(/\r?\n/).map(cleanLine).filter(Boolean);
  const amount = labelledValue(lines, ['设备预付金', '预付金']).replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || '';
  const draft: StoreDocumentDraft = {
    name: labelledValue(lines, ['门店名称', '点位名称']),
    address: labelledValue(lines, ['门店地址', '点位地址', '营业地址']),
    contactName: labelledValue(lines, ['联系人', '负责人']),
    contactPhone: labelledValue(lines, ['联系电话', '联系人电话', '手机']),
    depositAmount: amount,
  };
  return Object.fromEntries(Object.entries(draft).filter(([, value]) => Boolean(value)));
}

import { execFile } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { promisify } from 'util';
import type { SessionUser } from './auth';
import { getBrandIntakeDocument, getBrandIntakeState, storeIntakeCompanyAttachment, type IntakeFileRecord } from './cn-brand-intake-brain';
import { brandDocumentDirectory } from './brand-document-ownership.server';

const exec = promisify(execFile);
const sha = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

export async function attachConfirmedIntakeCompanyDocument(user: SessionUser, fileId: string, brandId?: number | null) {
  const stored = getBrandIntakeDocument(user, fileId, brandId);
  if (!stored || !stored.file.companyContentMatched || stored.file.manualKind === 'sensitive_document') throw new Error('公司原件不存在或不可用');
  const state = getBrandIntakeState(user, brandId);
  if (state.company.registrationNo?.userConfirmedValue !== stored.file.companyDraft?.registrationNo?.value
    || state.company.companyName?.userConfirmedValue !== stored.file.companyDraft?.companyName?.value) throw new Error('公司原件与已确认主体不一致');
  if (sha(stored.bytes) !== stored.file.sha256) throw new Error('公司原件校验失败');
  const old = stored.file.applicationAttachment;
  if (old && existsSync(path.join(brandDocumentDirectory(), old.token))) return storeIntakeCompanyAttachment(user, fileId, old, brandId);
  const namePages = stored.file.companyDraft?.companyName?.sources.filter(source => source.extractor !== 'user').map(source => source.page) || [];
  const codePages = stored.file.companyDraft?.registrationNo?.sources.filter(source => source.extractor !== 'user').map(source => source.page) || [];
  const page = namePages.find(page => page && codePages.includes(page));
  if (!page) throw new Error('公司名称与代码缺少同页证据');
  let bytes = stored.bytes;
  let mime = stored.file.detectedMime;
  let mode: 'copy' | 'legal-page-render' = 'copy';
  const directory = mkdtempSync(path.join(os.tmpdir(), 'richsmart-intake-company-attachment-'));
  try {
    if (mime === 'application/pdf' && (Number(stored.file.pageCount || 1) > 1 || stored.file.identification?.sensitivePages.length)) {
      const original = path.join(directory, 'original.pdf');
      writeFileSync(original, stored.bytes);
      const prefix = path.join(directory, 'legal-company-page');
      await exec('pdftoppm', ['-f', String(page), '-singlefile', '-png', '-r', '300', original, prefix], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      bytes = readFileSync(`${prefix}.png`);
      mime = 'image/png';
      mode = 'legal-page-render';
    }
    if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(mime) || !bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('公司附件超过允许范围');
    const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const token = `license-${user.id}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${extension}`;
    const name = mode === 'copy' ? stored.file.originalName : `${stored.file.originalName.replace(/\.[^.]+$/, '')}_公司主体第${page}页.${extension}`;
    const attachment: NonNullable<IntakeFileRecord['applicationAttachment']> = { token, name, kind: 'license', size: bytes.length, verificationStatus: 'manual_review', sourceFileId: fileId, sourceSha256: stored.file.sha256, sourcePage: page, sourceMode: mode };
    const target = brandDocumentDirectory();
    mkdirSync(path.join(target, '.metadata'), { recursive: true });
    writeFileSync(path.join(target, token), bytes);
    writeFileSync(path.join(target, '.metadata', `${token}.json`), JSON.stringify({ token, userId: user.id, kind: 'license', originalName: name, mimeType: mime, size: bytes.length, sha256: sha(bytes), verificationStatus: 'manual_review', source: attachment, extractedTextPreview: '', createdAt: new Date().toISOString() }, null, 2));
    return storeIntakeCompanyAttachment(user, fileId, attachment, brandId);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { getApprovedBrandForUser } from '@/lib/local-cn-brand-marketplace';
import { quoteBrandAiService } from '@/lib/local-cn-brand-ai-credits';
import { hasUsableDocumentText, type DocumentTextPage } from '@/lib/cn-brand-document-identification';
import { planLocalOcrDocumentPages as planLocalOcrPages, recognizeLocalIntakeDocumentPages as recognizeLocalIntakePages } from '@/lib/cn-document-local-ocr';
import { attachConfirmedIntakeCompanyDocument } from '@/lib/cn-intake-company-attachment';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { assertUploadBytesIntact, copyPdfParserBytes, publicUploadError } from '@/lib/pdf-upload-bytes';
import {
  confirmBrandIntakeField,
  confirmIntakeCompanyDocument,
  confirmIntakeDocumentCandidate,
  getBrandIntakeDocument,
  storeIntakeCompanyAttachment,
  getBrandIntakeState,
  publicBrandIntakeState,
  saveBrandIntakeUpload,
  validateIntakeFileEnvelope,
} from '@/lib/cn-brand-intake-brain';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function number(value: unknown) {
  const resolved = Number(value || 0);
  return Number.isFinite(resolved) && resolved > 0 ? resolved : null;
}

function currentBrandId(userId: number, requested: unknown) {
  const approved = getApprovedBrandForUser(userId);
  const requestedId = number(requested);
  if (approved) return approved.id;
  return requestedId;
}

async function extractDeterministicText(bytes: Uint8Array, detectedMime: string) {
  if (detectedMime === 'application/pdf') {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'richsmart-pdf-det-'));
    try {
      const pdfFile = path.join(tempDir, 'input.pdf');
      writeFileSync(pdfFile, Buffer.from(bytes));
      const { execFileSync } = await import('child_process');
      let rawAll = '';
      try {
        rawAll = execFileSync('pdftotext', ['-enc', 'UTF-8', pdfFile, '-'], { timeout: 15_000, maxBuffer: 12 * 1024 * 1024 }).toString('utf8');
      } catch {
        rawAll = '';
      }
      const rawPages = rawAll.split('\f');
      if (rawPages.length > 1 && !rawPages[rawPages.length - 1].trim()) rawPages.pop();
      const pageCount = Math.max(1, rawPages.length);
      validateIntakeFileEnvelope({ bytes, declaredMime: detectedMime, pageCount });
      let remaining = 250_000;
      const pages: DocumentTextPage[] = rawPages.slice(0, pageCount).map((text, index) => {
        const bounded = text.slice(0, Math.max(remaining, 0));
        remaining -= bounded.length;
        return { page: index + 1, text: bounded, extractor: 'deterministic' };
      });
      return { text: pages.map(page => page.text).join('\n'), pages, pageCount, truncated: rawAll.length > 250_000 };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
  if (detectedMime === 'text/csv' || detectedMime === 'text/plain') {
    const text = Buffer.from(bytes).toString('utf8').slice(0, 250_000);
    return { text, pages: [{ page: 1, text, extractor: 'deterministic' as const }], pageCount: undefined, truncated: false };
  }
  return { text: '', pages: [] as DocumentTextPage[], pageCount: undefined, truncated: false };
}

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const brandId = currentBrandId(user.id, request.nextUrl.searchParams.get('brandId'));
  const fileId = request.nextUrl.searchParams.get('fileId');
  if (fileId) {
    const stored = getBrandIntakeDocument(user, fileId, brandId);
    if (!stored) return NextResponse.json({ error: '文件不存在或无权查看' }, { status: 404 });
    const name = stored.file.originalName.replace(/[\r\n"\\/]/g, '-').slice(0, 180);
    return new NextResponse(stored.bytes, { headers: { 'Content-Type': stored.file.detectedMime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  const state = getBrandIntakeState(user, brandId, {
    categoryMajorId: request.nextUrl.searchParams.get('categoryMajorId'),
    categoryMinorId: request.nextUrl.searchParams.get('categoryMinorId'),
  });
  return NextResponse.json({ intake: publicBrandIntakeState(state), quote: quoteBrandAiService(brandId || user.id, 'ai_copy_regenerate', 1000) });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择文件' }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const probe = validateIntakeFileEnvelope({ bytes, declaredMime: file.type, fileName: file.name });
    assertUploadBytesIntact(bytes, file.size);
    const extracted = await extractDeterministicText(bytes, probe.detectedMime);
    const strictEnvelope = validateIntakeFileEnvelope({ bytes, declaredMime: file.type, fileName: file.name, pageCount: extracted.pageCount });
    const documentType = String(form.get('documentType') || '');
    const missingPages = strictEnvelope.detectedMime === 'application/pdf'
      ? extracted.pages.filter(page => !hasUsableDocumentText(page.text)).map(page => page.page)
      : strictEnvelope.detectedMime.startsWith('image/') ? [1] : [];
    let pages = extracted.pages;
    let ocrAttemptedPages: number[] = [];
    const processingWarnings: string[] = extracted.truncated ? ['文字提取超过本次长度预算，剩余内容保留原件待确认。'] : [];
    if (missingPages.length) {
      const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'richsmart-intake-'));
      try {
        const temporary = path.join(temporaryDirectory, 'original');
        assertUploadBytesIntact(bytes, file.size);
        writeFileSync(temporary, Buffer.from(bytes));
        const selected = planLocalOcrPages(extracted.pageCount || 1, missingPages);
        const recognized = await recognizeLocalIntakePages(temporary, strictEnvelope.detectedMime, selected);
        ocrAttemptedPages = recognized.attemptedPages;
        processingWarnings.push(...recognized.warnings);
        if (selected.length < missingPages.length) processingWarnings.push(`本次按首页、身份/细节与报告尾部规划 OCR ${selected.length} 页，另 ${missingPages.length - selected.length} 页保留原件待确认；不代表整份报告完整读懂。`);
        const byPage = new Map(pages.map(page => [page.page, page]));
        for (const page of recognized.pages) byPage.set(page.page, page);
        pages = Array.from(byPage.values()).sort((left, right) => left.page - right.page);
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
    const brandId = currentBrandId(user.id, form.get('brandId'));
    const quote = quoteBrandAiService(brandId || user.id, 'ai_copy_regenerate', 1000);
    assertUploadBytesIntact(bytes, file.size);
    const result = saveBrandIntakeUpload({
      user,
      brandId,
      fileName: file.name,
      declaredMime: file.type,
      documentType,
      bytes,
      extractedText: pages.map(page => page.text).join('\n'),
      pages,
      pageCount: extracted.pageCount,
      processingWarnings,
      coverage: { textPages: extracted.pages.filter(page => hasUsableDocumentText(page.text)).map(page => page.page), ocrAttemptedPages, unreadPages: missingPages.filter(number => !pages.some(page => page.page === number && hasUsableDocumentText(page.text))) },
      aiQuote: quote,
    }, {
      categoryMajorId: form.get('categoryMajorId'),
      categoryMinorId: form.get('categoryMinorId'),
    });
    return NextResponse.json({
      file: result.file,
      duplicate: result.duplicate,
      intake: publicBrandIntakeState(result.state),
      warnings: [
        ...result.file.warnings,
      ],
      quote,
    }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    console.error('Brand intake upload failed:', error);
    return NextResponse.json({ error: publicUploadError(error, '资料处理暂时失败，请稍后重试；若持续失败，请联系平台协助。') }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const brandId = currentBrandId(user.id, body.brandId);
    if (body.action === 'confirm_company_document') {
      const fileId = String(body.fileId || '');
      let state = confirmIntakeCompanyDocument(user, { brandId, fileId, companyName: body.companyName, registrationNo: body.registrationNo });
      try { state = await attachConfirmedIntakeCompanyDocument(user, fileId, brandId); }
      catch { state = storeIntakeCompanyAttachment(user, fileId, null, brandId); }
      return NextResponse.json({ intake: publicBrandIntakeState(state) });
    }
    if (['confirm_document_field', 'set_document_kind', 'confirm_company_field', 'confirm_document_section_field'].includes(body.action)) {
      const state = confirmIntakeDocumentCandidate(user, { brandId, fileId: String(body.fileId || ''), action: body.action, field: body.field, value: body.value, kind: body.kind, sectionIndex: body.sectionIndex });
      return NextResponse.json({ intake: publicBrandIntakeState(state) });
    }
    const state = confirmBrandIntakeField(user, {
      brandId,
      entity: body.entity,
      productDraftId: body.productDraftId,
      field: String(body.field || ''),
      value: body.value == null ? undefined : String(body.value),
    });
    return NextResponse.json({ intake: publicBrandIntakeState(state) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '确认失败' }, { status: 400 });
  }
}

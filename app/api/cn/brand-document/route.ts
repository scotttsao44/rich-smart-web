import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { brandDraftFromDocumentText } from '@/lib/cn-brand-document';
import { businessLicenseAutofillDraft, isBusinessLicenseOcrConfigured, parseBusinessLicenseText, recognizeBusinessLicense, type BusinessLicenseOcrResult } from '@/lib/cn-business-license-ocr';
import { listBrandApplications } from '@/lib/local-cn-brand-marketplace';
import { brandPilotDbEnabled, listDbBrandApplications } from '@/lib/brand-pilot-db';
import { BRAND_APPLICATION_DOCUMENT_KINDS, normalizeBrandApplicationDocuments } from '@/lib/brand-application-documents';
import { brandDocumentDirectory as documentDirectory, readBrandDocumentOwnership } from '@/lib/brand-document-ownership.server';
import { suggestBrandCategoriesFromBusinessScope } from '@/lib/cn-brand-taxonomy';
import { findActivePdfMarker } from '@/lib/pdf-safety';
import { assertUploadBytesIntact, copyPdfParserBytes, publicUploadError, UploadValidationError } from '@/lib/pdf-upload-bytes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const allowedUploadKinds = new Set<string>([...BRAND_APPLICATION_DOCUMENT_KINDS, 'profile', 'trademark', 'document']);
const maxFileSize = 25 * 1024 * 1024;
const maxPdfPages = 10;
const minImagePixels = 90_000;
const maxImagePixels = 40_000_000;
const activePdfMarkers = [
  '/JavaScript',
  '/JS',
  '/OpenAction',
  '/AA',
  '/Launch',
  '/EmbeddedFile',
  '/RichMedia',
  '/XFA',
];

const documentTypes = {
  cn_business_license: {
    label: '中国大陆营业执照',
    requiredTitleSignals: ['营业执照'],
    requiredFields: ['companyName', 'registrationNo', 'legalRepresentative', 'companyAddress', 'establishmentDate'] as const,
  },
  cn_company_registration: {
    label: '中国大陆公司设立登记文件',
    requiredTitleSignals: ['主体登记', '公司设立登记', '设立登记', '企业登记'],
    requiredFields: ['companyName', 'registrationNo', 'legalRepresentative', 'companyAddress'] as const,
  },
} as const;

type DocumentType = keyof typeof documentTypes;
type VerificationStatus = 'verified' | 'manual_review';

function metadataDirectory() {
  return path.join(documentDirectory(), '.metadata');
}

function contentType(token: string) {
  if (token.endsWith('.pdf')) return 'application/pdf';
  if (token.endsWith('.png')) return 'image/png';
  if (token.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function safeHeaderFileName(name: string, fallback: string) {
  const cleaned = String(name || fallback)
    .replace(/[\r\n"]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

function detectMime(bytes: Uint8Array) {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 12 && Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

function readUInt32BE(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readUInt24LE(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function imageDimensions(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/png' && bytes.length >= 24) {
    return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) };
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if (length < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: (bytes[offset + 7] << 8) + bytes[offset + 8], height: (bytes[offset + 5] << 8) + bytes[offset + 6] };
      }
      offset += 2 + length;
    }
  }
  if (mimeType === 'image/webp' && bytes.length >= 30) {
    const variant = Buffer.from(bytes.slice(12, 16)).toString('ascii');
    if (variant === 'VP8X') return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 };
    if (variant === 'VP8 ' && bytes.length >= 30) return { width: bytes[26] | ((bytes[27] & 0x3f) << 8), height: bytes[28] | ((bytes[29] & 0x3f) << 8) };
    if (variant === 'VP8L' && bytes.length >= 25) {
      const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
  }
  return null;
}

function validateFileEnvelope(file: File, bytes: Uint8Array) {
  if (!allowedTypes.has(file.type)) throw new UploadValidationError('仅支持 PDF、JPG、PNG 或 WebP');
  if (!bytes.length) throw new UploadValidationError('文件为空，请上传清晰的主体登记文件');
  if (file.size > maxFileSize) throw new UploadValidationError('文件不可超过 25 MB');
  const detected = detectMime(bytes);
  if (detected !== file.type) throw new UploadValidationError('文件内容与副档名或 MIME 不一致，请上传原始 PDF/JPG/PNG/WebP');
  if (detected.startsWith('image/')) {
    const dimensions = imageDimensions(bytes, detected);
    if (!dimensions?.width || !dimensions.height) throw new UploadValidationError('图片无法解码，请上传清晰原图');
    const pixels = dimensions.width * dimensions.height;
    if (pixels < minImagePixels) throw new UploadValidationError('图片解析度过低，请上传清晰原图');
    if (pixels > maxImagePixels) throw new UploadValidationError('图片像素过大，请压缩后重新上传');
  }
  if (detected === 'application/pdf') {
    const source = Buffer.from(bytes).toString('latin1');
    const marker = findActivePdfMarker(source, activePdfMarkers);
    if (marker) throw new UploadValidationError(`PDF 含有不允许的主动内容（${marker}），请上传静态扫描件或正式电子文件`);
  }
  return detected;
}

function documentType(value: FormDataEntryValue | null): DocumentType {
  const key = String(value || 'cn_business_license') as DocumentType;
  return key in documentTypes ? key : 'cn_business_license';
}

function validateRecognizedContent(ocr: BusinessLicenseOcrResult, type: DocumentType) {
  const rule = documentTypes[type];
  const missingRequired = rule.requiredFields.filter((field) => !ocr.draft[field]);
  const titleMatched = rule.requiredTitleSignals.some((signal) => ocr.titleSignals?.includes(signal));
  const hasRegistration = Boolean(ocr.draft.registrationNo);
  const validRegistrationNo = type === 'cn_business_license' ? ocr.validRegistrationNo : hasRegistration;
  const confidenceProblems = ocr.lowConfidenceFields;
  const score = Number(ocr.contentScore || 0);
  const warnings: string[] = [];
  if (!titleMatched && score < 4 && missingRequired.length >= 4) {
    warnings.push(`文件自动识别字段较少，已保存原件进入人工复核，请手动核对补充主体信息`);
  }
  if (!validRegistrationNo) {
    warnings.push('统一社会信用代码待人工复核，请核对表单中的信用代码');
  }
  warnings.push(
    ...missingRequired.map((field) => `待补充或核对 ${field}`),
    ...confidenceProblems.map((field) => `${field} 建议人工复核`),
  );
  const status: VerificationStatus = (!validRegistrationNo || missingRequired.length || confidenceProblems.length) ? 'manual_review' : 'verified';
  return { status, warnings };
}

function metadataToken(token: string) {
  return path.join(metadataDirectory(), `${token}.json`);
}

function contentDisposition(name: string, fallback: string) {
  const safeName = safeHeaderFileName(name, fallback);
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_');
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

type DocumentApplication = {
  applicantUserId?: number | null;
  accountUserId?: number | null;
  businessLicenseDocument?: string;
  businessLicenseName?: string;
  profileDocument?: string;
  profileDocumentName?: string;
  trademarkDocument?: string;
  trademarkName?: string;
  brandDocuments?: unknown;
};

function documentTokens(application: DocumentApplication) {
  return [
    application.businessLicenseDocument,
    application.profileDocument,
    application.trademarkDocument,
    ...normalizeBrandApplicationDocuments(application.brandDocuments).map((document) => document.token),
  ].filter(Boolean);
}

function documentName(applications: DocumentApplication[], token: string) {
  const row = applications.find((application) => documentTokens(application).includes(token));
  if (!row) return token;
  const listed = normalizeBrandApplicationDocuments(row.brandDocuments).find((document) => document.token === token);
  if (listed) return listed.name;
  if (row.businessLicenseDocument === token) return row.businessLicenseName || token;
  if (row.profileDocument === token) return row.profileDocumentName || token;
  if (row.trademarkDocument === token) return row.trademarkName || token;
  return token;
}

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const token = String(request.nextUrl.searchParams.get('token') || '');
  if (!token || path.basename(token) !== token) return NextResponse.json({ error: '文件编号不正确' }, { status: 400 });
  const ownership = readBrandDocumentOwnership(token);
  if (!hasPlatformAdminAccess(user) && (ownership.source === 'invalid' || (ownership.source === 'metadata' && ownership.ownerId !== user.id))) {
    return NextResponse.json({ error: '无权查看该品牌文件' }, { status: 403 });
  }
  const applications = brandPilotDbEnabled()
    ? await listDbBrandApplications(user, hasPlatformAdminAccess(user) ? 'all' : 'self')
    : listBrandApplications(user);
  const canRead = hasPlatformAdminAccess(user) || (ownership.source === 'metadata'
    ? ownership.ownerId === user.id
    : ownership.source === 'legacy' && applications.some((row) => documentTokens(row).includes(token)
      && (row.applicantUserId === ownership.ownerId || row.accountUserId === ownership.ownerId)));
  if (!canRead) return NextResponse.json({ error: '无权查看该品牌文件' }, { status: 403 });
  const target = path.join(documentDirectory(), token);
  if (!existsSync(target)) return NextResponse.json({ error: '文件不存在或已清理' }, { status: 404 });
  const originalName = documentName(applications, token);
  return new NextResponse(readFileSync(target), {
    headers: {
      'Content-Type': contentType(token),
      'Content-Disposition': contentDisposition(originalName, token),
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get('file');
    const kind = String(form.get('kind') || 'document');
    if (!allowedUploadKinds.has(kind)) throw new UploadValidationError('文件分类不正确，请选择有效的品牌资料类别');
    const selectedDocumentType = documentType(form.get('documentType'));
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择文件' }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedType = validateFileEnvelope(file, bytes);
    assertUploadBytesIntact(bytes, file.size);
    const extension = detectedType === 'application/pdf' ? 'pdf' : detectedType === 'image/png' ? 'png' : detectedType === 'image/webp' ? 'webp' : 'jpg';
    const token = `${kind}-${user.id}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${extension}`;
    const directory = documentDirectory();
    mkdirSync(directory, { recursive: true });
    mkdirSync(metadataDirectory(), { recursive: true });
    const target = path.join(directory, token);
    let draft = {};
    let ocr: BusinessLicenseOcrResult | null = null;
    const warnings: string[] = [];
    let verificationStatus: VerificationStatus = kind === 'license' ? 'manual_review' : 'verified';
    let extractedText = '';
    if (detectedType === 'application/pdf') {
      try {
        writeFileSync(target, Buffer.from(bytes));
        const { execFileSync } = await import('child_process');
        try {
          extractedText = execFileSync('pdftotext', ['-enc', 'UTF-8', target, '-'], { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }).toString('utf8').trim();
        } catch {
          extractedText = '';
        }
        const result = { text: extractedText };
        if (result.text.trim().length >= 12) {
          draft = brandDraftFromDocumentText(result.text, kind);
          if (kind === 'license') {
            ocr = parseBusinessLicenseText(result.text, 'pdf-text');
            const content = validateRecognizedContent(ocr, selectedDocumentType);
            verificationStatus = content.status;
            warnings.push(...content.warnings);
          }
        } else if (kind === 'license') {
          if (!isBusinessLicenseOcrConfigured()) {
            warnings.push('这份 PDF 没有文字层，且正式 OCR provider 未配置；文件会进入人工核验，不会自动通过。');
            verificationStatus = 'manual_review';
          } else {
            assertUploadBytesIntact(bytes, file.size);
            writeFileSync(target, Buffer.from(bytes));
            ocr = await recognizeBusinessLicense(target, detectedType);
            if (!ocr) {
              verificationStatus = 'manual_review';
              warnings.push('扫描 PDF 未返回 OCR 结果；文件进入人工核验，不会自动通过。');
            } else {
              draft = ocr.draft;
              const content = validateRecognizedContent(ocr, selectedDocumentType);
              verificationStatus = content.status;
              warnings.push('扫描 PDF 已完成影像 OCR，请逐项核对。', ...content.warnings);
            }
          }
        } else warnings.push('这份 PDF 为扫描图片，已保存，请确认系统未读到的字段。');
      } catch (error) {
        if (existsSync(target)) unlinkSync(target);
        throw error;
      }
    } else if (kind === 'license') {
      try {
        if (!isBusinessLicenseOcrConfigured()) {
          warnings.push('正式 OCR provider 未配置；图片已进入人工核验，不会自动通过。需要设置 CN_BUSINESS_LICENSE_OCR_PROVIDER=aliyun、CN_ALIYUN_OCR_BUSINESS_LICENSE_URL 与 CN_ALIYUN_OCR_APPCODE。');
          verificationStatus = 'manual_review';
        } else {
          assertUploadBytesIntact(bytes, file.size);
          writeFileSync(target, Buffer.from(bytes));
          ocr = await recognizeBusinessLicense(target, detectedType);
          if (!ocr) {
            verificationStatus = 'manual_review';
            warnings.push('OCR provider 未返回结果；文件进入人工核验，不会自动通过。');
          } else {
            draft = ocr.draft;
            const content = validateRecognizedContent(ocr, selectedDocumentType);
            verificationStatus = content.status;
            warnings.push(...content.warnings);
          }
        }
      } catch (error) {
        if (existsSync(target)) unlinkSync(target);
        throw error;
      }
    }
    if (kind === 'license' && ocr) draft = businessLicenseAutofillDraft(ocr);
    assertUploadBytesIntact(bytes, file.size);
    writeFileSync(target, Buffer.from(bytes));
    const metadata = {
      token,
      userId: user.id,
      kind,
      documentType: selectedDocumentType,
      documentTypeLabel: documentTypes[selectedDocumentType].label,
      originalName: file.name,
      size: file.size,
      mimeType: detectedType,
      sha256: crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
      verificationStatus,
      draft,
      ocr,
      warnings,
      extractedTextPreview: extractedText.slice(0, 1200),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(metadataToken(token), JSON.stringify(metadata, null, 2));
    const categorySuggestions = kind === 'license'
      ? suggestBrandCategoriesFromBusinessScope({
        businessScope: (draft as Record<string, unknown>).businessScope,
        companyName: (draft as Record<string, unknown>).companyName,
      })
      : [];
    return NextResponse.json({ token, name: file.name, kind, documentType: selectedDocumentType, verificationStatus, size: file.size, draft, ocr, categorySuggestions, warnings });
  } catch (error) {
    console.error('Brand document upload failed:', error);
    return NextResponse.json({ error: publicUploadError(error, '文件处理暂时失败，请稍后重试；若持续失败，请联系平台协助。') }, { status: 400 });
  }
}

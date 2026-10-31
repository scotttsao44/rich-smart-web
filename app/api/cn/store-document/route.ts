import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { extractText, getDocumentProxy } from 'unpdf';
import { storeDraftFromDocumentText } from '@/lib/cn-store-document';
import { listStoreApplications } from '@/lib/local-cn-store-applications';
import { assertUploadBytesIntact, copyPdfParserBytes, publicUploadError, UploadValidationError } from '@/lib/pdf-upload-bytes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function documentDirectory() {
  return path.join(process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data'), 'store-documents');
}

function contentType(token: string) {
  if (token.endsWith('.pdf')) return 'application/pdf';
  if (token.endsWith('.png')) return 'image/png';
  if (token.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const token = String(request.nextUrl.searchParams.get('token') || '');
  if (!token || path.basename(token) !== token) return NextResponse.json({ error: '文件编号不正确' }, { status: 400 });
  const canRead = hasPlatformAdminAccess(user) || listStoreApplications(user).some((row) => row.applicationDocument === token);
  if (!canRead) return NextResponse.json({ error: '无权查看该门店文件' }, { status: 403 });
  const target = path.join(documentDirectory(), token);
  if (!existsSync(target)) return NextResponse.json({ error: '文件不存在或已清理' }, { status: 404 });
  return new NextResponse(readFileSync(target), {
    headers: {
      'Content-Type': contentType(token),
      'Content-Disposition': `inline; filename="${token}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  let target: string | null = null;
  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择文件' }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: '仅支持 PDF、JPG、PNG 或 WebP' }, { status: 400 });
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: '文件不可超过 8 MB' }, { status: 400 });
    const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const token = `store-${user.id}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${extension}`;
    const directory = documentDirectory();
    mkdirSync(directory, { recursive: true });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length) throw new UploadValidationError('文件为空，请上传原始文件');
    assertUploadBytesIntact(bytes, file.size);
    target = path.join(directory, token);
    writeFileSync(target, Buffer.from(bytes));
    let draft = {};
    const warnings: string[] = [];
    if (file.type === 'application/pdf') {
      const pdf = await getDocumentProxy(copyPdfParserBytes(bytes));
      try {
        if (pdf.numPages > 30) warnings.push('文件超过 30 页，已保存但未自动读取。');
        else {
          const result = await extractText(pdf, { mergePages: true });
          if (result.text.trim().length >= 12) draft = storeDraftFromDocumentText(result.text);
          else warnings.push('这份 PDF 为扫描图片，已保存，请手动填写资料。');
        }
      } finally {
        await pdf.destroy();
      }
    } else warnings.push('图片已保存；请手动填写门店资料。');
    return NextResponse.json({ token, name: file.name, size: file.size, draft, warnings });
  } catch (error) {
    if (target && existsSync(target)) unlinkSync(target);
    console.error('Store document upload failed:', error);
    return NextResponse.json({ error: publicUploadError(error, '文件处理暂时失败，请稍后重试；若持续失败，请联系平台协助。') }, { status: 400 });
  }
}

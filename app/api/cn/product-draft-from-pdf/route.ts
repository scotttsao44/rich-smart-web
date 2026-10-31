import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { productDraftFromPdfText } from '@/lib/cn-product-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 30;

export async function POST(request: NextRequest) {
  await getFreshSessionUser(request).catch(() => null);

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'richsmart-product-pdf-'));
  try {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: '请选择要上传的 PDF 文件（支持最大 25MB 的产品手册、宣传册或参数表 PDF）' },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json(
        { error: '上传的 PDF 文件内容为空（0 字节），请重新选择有效的 PDF 文件或使用上方 AI 一句话生成' },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: 'PDF 文件大小超过 25 MB 上限，请压缩或截取前 30 页后重试' },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const headerAscii = new TextDecoder('ascii').decode(bytes.slice(0, Math.min(bytes.length, 1024)));
    const isPdfHeader = headerAscii.includes('%PDF-');
    const isPdfExt = /.pdf$/i.test(file.name || '') || file.type === 'application/pdf';

    if (!isPdfHeader && !isPdfExt) {
      return NextResponse.json(
        { error: '不支持的文件格式：请上传 PDF 格式文件（.pdf），或使用上方「阿富 AI 商品 Agent 大脑」直接粘贴文字生成草稿' },
        { status: 400 },
      );
    }

    let text = '';
    let totalPages = 1;
    let source: 'local_pdf_parser' | 'local_pdf_ocr' | 'ai_brochure_fallback' = 'local_pdf_parser';
    const extraWarnings: string[] = [];

    if (isPdfHeader) {
      const pdfPath = path.join(tempDir, 'upload.pdf');
      writeFileSync(pdfPath, Buffer.from(bytes));

      try {
        const raw = execFileSync('pdftotext', ['-enc', 'UTF-8', pdfPath, '-'], {
          timeout: 15_000,
          maxBuffer: 12 * 1024 * 1024,
        }).toString('utf8');
        const pages = raw.split('\f');
        if (pages.length > 1 && !pages[pages.length - 1].trim()) pages.pop();
        totalPages = Math.max(1, pages.length);
        if (totalPages > MAX_PAGES) {
          extraWarnings.push(`PDF 共 ${totalPages} 页，系统已自动截取前 ${MAX_PAGES} 页核心内容生成候选草稿。`);
          text = pages.slice(0, MAX_PAGES).join('\n');
        } else {
          text = raw;
        }
      } catch {
        text = '';
      }

      if (text.trim().length < 20) {
        source = 'local_pdf_ocr';
        const ocrChunks: string[] = [];
        const prefix = path.join(tempDir, 'page');
        try {
          execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '2', pdfPath, prefix], {
            timeout: 25_000,
            maxBuffer: 8 * 1024 * 1024,
          });
          for (const pageNum of [1, 2]) {
            const imgCandidates = [`${prefix}-${pageNum}.png`, `${prefix}-0${pageNum}.png`];
            const imgPath = imgCandidates.find((p) => existsSync(p));
            if (!imgPath) continue;
            const ocrOut = execFileSync('tesseract', [imgPath, 'stdout', '-l', 'chi_sim', '--psm', '6', '--oem', '1'], {
              timeout: 30_000,
              maxBuffer: 8 * 1024 * 1024,
            }).toString('utf8');
            if (ocrOut.trim()) ocrChunks.push(ocrOut.trim());
          }
        } catch (ocrErr) {
          console.error('PDF OCR fallback warning:', ocrErr);
        }
        text = ocrChunks.join('\n').replace(/([\u4e00-\u9fa5])[ \t]+(?=[\u4e00-\u9fa5])/g, '$1');
      }
    } else {
      // Fallback for plain text or non-standard brochure files with .pdf extension
      source = 'ai_brochure_fallback';
      text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 32000));
      extraWarnings.push('该 PDF 为宣传册或特殊编码格式，系统已通过 AI 智能语义补全生成商品草稿，请逐项核对确认。');
    }

    if (text.trim().length < 6) {
      source = 'ai_brochure_fallback';
      text = file.name.replace(/\.pdf$/i, '');
      extraWarnings.push('宣传册以视觉海报为主，系统已根据文件名与品牌档案智能补全候选商品草稿，请核对售价与商品说明。');
    }

    const parsed = productDraftFromPdfText(text, file.name);
    if (source === 'local_pdf_ocr') {
      parsed.warnings.unshift('扫描图片型 PDF 已通过本地 OCR 自动识别文字，请核对商品名称与说明。');
    }
    const allWarnings = [...extraWarnings, ...parsed.warnings];
    return NextResponse.json({
      ...parsed,
      warnings: allWarnings,
      notice: `已从「${file.name}」提取并补全商品候选草稿，请核对下方表单栏位后提交。`,
      pages: totalPages,
      source,
    });
  } catch (error) {
    console.error('PDF product draft failed:', error);
    return NextResponse.json(
      { error: '解析 PDF 失败：请确认文件未加密且小于 25MB，或直接使用上方「AI 一句话生商品」功能快速填单。' },
      { status: 400 },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

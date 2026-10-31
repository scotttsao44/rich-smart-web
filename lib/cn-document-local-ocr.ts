import { execFile } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { parseTesseractTsv } from './cn-business-license-ocr';
import type { DocumentTextPage } from './cn-brand-document-identification';

const exec = promisify(execFile);
let macRunner: Promise<string> | null = null;
let macRunnerDirectory: string | null = null;
export const LOCAL_INTAKE_OCR_LIMITS = { startupMs: 45_000, pageMs: 60_000, maxPages: 8, pdfDpi: 300 } as const;
export const LOCAL_INTAKE_DOCUMENT_OCR_LIMITS = { maxPages: 12 } as const;

export function cleanupLocalOcrRuntime() {
  const directory = macRunnerDirectory;
  macRunnerDirectory = null;
  macRunner = null;
  if (directory) {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
    catch { console.error('Local OCR runtime cleanup failed; cache discarded.'); }
  }
}

async function localMacRunner(startupTimeout = 45_000) {
  const cached = macRunner;
  if (cached) {
    const binary = await cached;
    if (existsSync(binary)) return binary;
    // A temporary runner may have been removed between requests; rebuild it once.
    if (macRunner === cached) cleanupLocalOcrRuntime();
  }
  if (!macRunner) {
    macRunnerDirectory = mkdtempSync(path.join(os.tmpdir(), 'richsmart-vision-runtime-'));
    const directory = macRunnerDirectory;
    macRunner = (async () => {
      const binary = path.join(directory, 'vision-ocr');
      await exec('swiftc', ['-module-cache-path', path.join(directory, 'swift-cache'), path.join(process.cwd(), 'scripts/local-macos-vision-ocr.swift'), '-o', binary], { timeout: Math.max(Math.min(startupTimeout, 45_000), 1), maxBuffer: 4 * 1024 * 1024 });
      return binary;
    })().catch(error => { cleanupLocalOcrRuntime(); throw error; });
    if (typeof process.once === 'function') process.once('exit', cleanupLocalOcrRuntime);
  }
  return macRunner;
}

export function planLocalOcrPages(pageCount: number, missingPages: number[]) {
  const available = Array.from(new Set(missingPages.filter(page => Number.isSafeInteger(page) && page > 0 && page <= pageCount)));
  if (available.length <= LOCAL_INTAKE_OCR_LIMITS.maxPages) return available;
  // Include declarations/specifications as well as identity and result/photo pages.
  const preferred = [1, 2, 3, 4, 5, 6, Math.max(pageCount - 1, 1), pageCount];
  const selected = preferred.filter(page => available.includes(page));
  for (const page of available) if (selected.length < LOCAL_INTAKE_OCR_LIMITS.maxPages && !selected.includes(page)) selected.push(page);
  return Array.from(new Set(selected)).slice(0, LOCAL_INTAKE_OCR_LIMITS.maxPages);
}

export function planLocalOcrDocumentPages(pageCount: number, missingPages: number[]) {
  const available = Array.from(new Set(missingPages.filter(page => Number.isSafeInteger(page) && page > 0 && page <= pageCount))).sort((a, b) => a - b);
  const maximum = LOCAL_INTAKE_DOCUMENT_OCR_LIMITS.maxPages;
  if (available.length <= maximum) return available;
  const selected = available.slice(0, 3);
  // Spread remaining probes across the physical file, retaining both tail pages.
  for (let index = 1; index <= maximum - 5; index += 1) selected.push(available[Math.round(index * (available.length - 1) / (maximum - 4))]);
  selected.push(...available.slice(-2));
  for (const page of available) if (new Set(selected).size < maximum && !selected.includes(page)) selected.push(page);
  return Array.from(new Set(selected)).sort((a, b) => a - b).slice(0, maximum);
}

export async function recognizeLocalIntakeDocumentPages(filePath: string, mime: string, requestedPages: number[]) {
  const selected = Array.from(new Set(requestedPages.filter(page => Number.isSafeInteger(page) && page >= 1))).slice(0, LOCAL_INTAKE_DOCUMENT_OCR_LIMITS.maxPages);
  const pages: DocumentTextPage[] = [], warnings: string[] = [], attemptedPages: number[] = [];
  const timings: Array<{ page: number; elapsedMs: number; status: 'read' | 'failed'; provider: 'local-macos-vision' | 'local-tesseract' }> = [];
  let startupMs = 0, startupFailed = false;
  for (let offset = 0; offset < selected.length; offset += LOCAL_INTAKE_OCR_LIMITS.maxPages) {
    const result = await recognizeLocalIntakePages(filePath, mime, selected.slice(offset, offset + LOCAL_INTAKE_OCR_LIMITS.maxPages));
    pages.push(...result.pages); warnings.push(...result.warnings); attemptedPages.push(...result.attemptedPages);
    timings.push(...(result.timings || [])); startupMs += result.startupMs || 0;
    if (result.startupFailed) { startupFailed = true; break; }
  }
  if (requestedPages.length > selected.length) warnings.push(`本次文件最多识别 ${selected.length} 页，其余页面仍未读取，不能自动补齐字段。`);
  return { pages, warnings, attemptedPages, timings, startupMs, startupFailed };
}

// This intake path is local-only even when legacy cloud OCR credentials exist.
export async function recognizeLocalIntakePages(filePath: string, mime: string, requestedPages: number[]) {
  const pages: DocumentTextPage[] = [];
  const warnings: string[] = [];
  const provider = String(process.env.CN_BUSINESS_LICENSE_OCR_PROVIDER || 'auto').toLowerCase();
  const selected = Array.from(new Set(requestedPages.filter(page => Number.isSafeInteger(page) && page >= 1))).slice(0, LOCAL_INTAKE_OCR_LIMITS.maxPages);
  if (provider === 'none' || provider === 'disabled') return { pages, warnings: ['本地 OCR 已关闭，缺文字页面保留待人工确认。'], attemptedPages: [] as number[] };
  if (!['darwin', 'linux'].includes(process.platform)) return { pages, warnings: ['此环境没有可用的本地 OCR，原件保留待人工确认。'], attemptedPages: [] as number[] };
  const directory = mkdtempSync(path.join(os.tmpdir(), 'richsmart-intake-local-ocr-'));
  let deadline = 0;
  let pageDeadline = 0;
  let binary: string | undefined;
  let startupMs = 0;
  const attemptedPages: number[] = [];
  const timings: Array<{ page: number; elapsedMs: number; status: 'read' | 'failed'; provider: 'local-macos-vision' | 'local-tesseract' }> = [];
  const timeout = () => Math.max(Math.min(deadline - Date.now(), pageDeadline - Date.now()), 1);
  try {
    if (process.platform === 'darwin' && selected.length) {
      const startupStarted = Date.now();
      try { binary = await localMacRunner(LOCAL_INTAKE_OCR_LIMITS.startupMs); }
      catch (error) {
        console.error('Local intake OCR startup failed:', { code: (error as NodeJS.ErrnoException)?.code || 'OCR_STARTUP_FAILED' });
        warnings.push('本地 OCR 启动失败，未尝试读取页面；原件保留待人工确认。');
        return { pages, warnings, attemptedPages, timings, startupMs: Date.now() - startupStarted, startupFailed: true };
      }
      startupMs = Date.now() - startupStarted;
    }
    // Startup never spends page time; each selected page gets its own bounded share.
    deadline = Date.now() + selected.length * LOCAL_INTAKE_OCR_LIMITS.pageMs;
    for (const page of selected) {
      if (Date.now() >= deadline) { warnings.push('本次本地 OCR 时间预算已用完，其余页面待确认。'); break; }
      attemptedPages.push(page);
      const started = Date.now();
      pageDeadline = started + LOCAL_INTAKE_OCR_LIMITS.pageMs;
      try {
        let imagePath = filePath;
        if (mime === 'application/pdf') {
          const prefix = path.join(directory, `page-${page}`);
          await exec('pdftoppm', ['-f', String(page), '-singlefile', '-png', '-r', '180', filePath, prefix], { timeout: timeout(), maxBuffer: 2 * 1024 * 1024 });
          imagePath = `${prefix}.png`;
          if (!existsSync(imagePath)) throw new Error('Missing rendered page');
        }
        let output: { text?: string; lines?: DocumentTextPage['lines'] };
        if (process.platform === 'linux') {
          const result = await exec('tesseract', [imagePath, 'stdout', '-l', 'chi_sim', '--psm', '6', '--oem', '1', 'tsv'], { timeout: timeout(), maxBuffer: 12 * 1024 * 1024 });
          output = parseTesseractTsv(result.stdout);
        } else {
          const result = await exec(binary!, [imagePath], { timeout: timeout(), maxBuffer: 8 * 1024 * 1024 });
          output = JSON.parse(result.stdout);
        }
        pages.push({ page, text: output.text || '', lines: output.lines || [], extractor: 'ocr' });
        timings.push({ page, elapsedMs: Date.now() - started, status: 'read', provider: process.platform === 'linux' ? 'local-tesseract' : 'local-macos-vision' });
      } catch (error) {
        console.error('Local intake OCR page failed:', { page, code: (error as NodeJS.ErrnoException)?.code || 'OCR_FAILED' });
        warnings.push(`第 ${page} 页本地 OCR 未成功，原页保留待人工确认。`);
        timings.push({ page, elapsedMs: Date.now() - started, status: 'failed', provider: process.platform === 'linux' ? 'local-tesseract' : 'local-macos-vision' });
      }
    }
    if (requestedPages.length > selected.length) warnings.push(`本次最多 OCR ${LOCAL_INTAKE_OCR_LIMITS.maxPages} 页，其余 ${requestedPages.length - selected.length} 页未识别，不能视为完整文件验证。`);
    return { pages, warnings, attemptedPages, timings, startupMs, startupFailed: false };
  } finally {
    try { rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
    catch (error) {
      console.error('Local intake OCR temporary cleanup failed:', { code: (error as NodeJS.ErrnoException)?.code || 'CLEANUP_FAILED' });
      warnings.push('临时识别文件未完全清理，需平台处理；已读候选仍待人工确认。');
    }
  }
}

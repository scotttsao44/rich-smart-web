import * as fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import {
  BrandDocumentReviewError, reviewApplicationId, serializeReviewApplicationSnapshot,
  validateBrandDocumentReviewInput, validateReviewSourceUrl,
  type ReviewApplication, type BrandDocumentReviewInput, type StoredBrandDocumentReview,
} from './brand-document-review';

export function brandDocumentReviewSnapshotId(application: ReviewApplication) {
  return createHash('sha256').update(serializeReviewApplicationSnapshot(application)).digest('hex');
}

function safeDirectory(directory: string, create: boolean, privateMode = false) {
  const resolved = path.resolve(directory);
  const parent = path.dirname(resolved);
  if (parent !== resolved) safeDirectory(parent, false);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(resolved); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error;
    try { fs.mkdirSync(resolved, { mode: 0o700 }); } catch (mkdirError) {
      if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
    }
    stat = fs.lstatSync(resolved);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (privateMode && ((stat.mode & 0o022) !== 0 || (process.getuid && stat.uid !== process.getuid())))) throw new BrandDocumentReviewError(503, '人工查证存储路径不安全');
  return resolved;
}

function directoryFor(applicationId: number, create: boolean) {
  reviewApplicationId(applicationId);
  const base = path.resolve(process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data'));
  safeDirectory(base, create);
  const root = path.join(base, 'brand-document-manual-reviews-v1');
  safeDirectory(root, create, true);
  const directory = path.join(root, String(applicationId));
  return safeDirectory(directory, create, true);
}

async function withLock<T>(directory: string, action: () => Promise<T> | T) {
  const lock = path.join(directory, '.lock');
  const deadline = Date.now() + 3000;
  while (true) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try { safeDirectory(lock, false, true); } catch (lockError) {
        if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw lockError;
      }
      if (Date.now() >= deadline) throw new BrandDocumentReviewError(503, '人工查证记录忙碌，请稍后重试');
      await new Promise(resolve => setTimeout(resolve, 15));
    }
  }
  try {
    safeDirectory(directory, false, true);
    return await action();
  } finally {
    fs.rmdirSync(lock);
  }
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function readHistory(directory: string, applicationId: number) {
  const records: StoredBrandDocumentReview[] = [];
  for (const filename of fs.readdirSync(directory)) {
    if (filename === '.lock') continue;
    // Interrupted temporary files are not silently discarded or repaired.
    if (!filename.endsWith('.json') || !uuid.test(filename.slice(0, -5))) throw new BrandDocumentReviewError(503, '人工查证历史含异常文件，请联系平台');
    const file = path.join(directory, filename);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 20000 || (stat.mode & 0o022) !== 0) throw new Error('Unsafe history file');
      const envelope = JSON.parse(fs.readFileSync(fd, 'utf8'));
      const record = envelope.record as StoredBrandDocumentReview;
      if (envelope.version !== 1 || envelope.digest !== digest(JSON.stringify(record)) || !record || `${record.id}.json` !== filename || record.applicationId !== applicationId
        || !/^[a-f0-9]{64}$/.test(record.snapshotId) || record.method !== 'platform_manual' || !Number.isSafeInteger(record.checkedBy) || record.checkedBy <= 0
        || typeof record.checkedAt !== 'string' || new Date(record.checkedAt).toISOString() !== record.checkedAt) throw new Error('Corrupt history');
      const { id, checkedAt, checkedBy, method, ...input } = record;
      validateBrandDocumentReviewInput(input, { id: applicationId, companyName: record.checkedCompanyName, registrationNo: record.checkedRegistrationNo });
      validateReviewSourceUrl(record.sourceUrl);
      records.push(record);
    } finally { fs.closeSync(fd); }
  }
  return records.sort((left, right) => left.checkedAt.localeCompare(right.checkedAt) || left.id.localeCompare(right.id));
}

function unavailable(error: unknown): never {
  if (error instanceof BrandDocumentReviewError && error.status === 503) throw error;
  throw new BrandDocumentReviewError(503, '人工查证历史不可用，请联系平台；未更改旧记录');
}

export async function listBrandDocumentReviews(applicationId: number, snapshotId: string) {
  try {
    let directory: string;
    try { directory = directoryFor(applicationId, false); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return await withLock(directory, () => readHistory(directory, applicationId).map(record => ({ ...record, stale: record.snapshotId !== snapshotId })));
  } catch (error) { return unavailable(error); }
}

export async function appendBrandDocumentReview(
  input: BrandDocumentReviewInput,
  checkedBy: number,
  readCurrentApplication: () => Promise<ReviewApplication>,
) {
  try {
    if (!Number.isSafeInteger(checkedBy) || checkedBy <= 0) throw new BrandDocumentReviewError(400, '查证人须为正整数帐号编号');
    const directory = directoryFor(input.applicationId, true);
    return await withLock(directory, async () => {
      try { readHistory(directory, input.applicationId); } catch (error) { return unavailable(error); }
      const application = await readCurrentApplication();
      const snapshotId = brandDocumentReviewSnapshotId(application);
      if (snapshotId !== input.snapshotId) throw new BrandDocumentReviewError(409, '申请资料已改变，请重新读取后查证');
      const validated = validateBrandDocumentReviewInput(input, application);
      const record: StoredBrandDocumentReview = { ...validated, id: randomUUID(), checkedAt: new Date().toISOString(), checkedBy, method: 'platform_manual' };
      const body = JSON.stringify({ version: 1, record, digest: digest(JSON.stringify(record)) });
      const temporary = path.join(directory, `.pending-${randomUUID()}`);
      const target = path.join(directory, `${record.id}.json`);
      let temporaryCreated = false;
      try {
        const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        temporaryCreated = true;
        try { fs.writeFileSync(fd, body, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        // Atomic no-replace publish: unlike rename, link refuses an existing target.
        fs.linkSync(temporary, target);
        fs.unlinkSync(temporary);
        temporaryCreated = false;
        const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
      } finally {
        if (temporaryCreated) fs.unlinkSync(temporary);
      }
      return { ...record, stale: false };
    });
  } catch (error) {
    if (error instanceof BrandDocumentReviewError) throw error;
    return unavailable(error);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { listBrandApplications } from '@/lib/local-cn-brand-marketplace';
import { brandPilotDbEnabled, listDbBrandApplications } from '@/lib/brand-pilot-db';
import { BRAND_DOCUMENT_REVIEW_OFFICIAL_SOURCES, BrandDocumentReviewError, reviewApplicationId, validateBrandDocumentReviewInput } from '@/lib/brand-document-review';
import { appendBrandDocumentReview, brandDocumentReviewSnapshotId, listBrandDocumentReviews } from '@/lib/brand-document-review-store.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const limit = 16384;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function fail(error: unknown) {
  return error instanceof BrandDocumentReviewError ? json({ error: error.message }, error.status) : json({ error: '人工查证记录暂不可用' }, 503);
}

async function accessibleApplication(user: NonNullable<ReturnType<typeof getRequestSession>>, id: number) {
  const applications = brandPilotDbEnabled() ? await listDbBrandApplications(user, 'all') : listBrandApplications(user);
  const application = applications.find(row => row.id === id);
  if (!application) throw new BrandDocumentReviewError(404, '申请不存在或无权读取');
  return application;
}

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const site = request.headers.get('sec-fetch-site');
  try {
    if (!origin || !host || (site !== null && site !== 'same-origin')) return false;
    const url = new URL(origin);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && origin === url.origin
      && url.host === host;
  } catch { return false; }
}

async function readBody(request: NextRequest) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new BrandDocumentReviewError(415, '请使用 JSON 查证内容');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new BrandDocumentReviewError(413, '查证内容过大');
  if (!request.body) throw new BrandDocumentReviewError(400, '缺少查证内容');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new BrandDocumentReviewError(413, '查证内容过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new BrandDocumentReviewError(400, 'JSON 查证内容不正确'); }
}

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return json({ error: '请先登录' }, 401);
  try {
    const applicationId = reviewApplicationId(request.nextUrl.searchParams.get('applicationId'));
    const application = await accessibleApplication(user, applicationId);
    const snapshotId = brandDocumentReviewSnapshotId(application);
    const records = await listBrandDocumentReviews(applicationId, snapshotId);
    return json({ applicationId, snapshotId, records, officialSources: BRAND_DOCUMENT_REVIEW_OFFICIAL_SOURCES });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return json({ error: '请先登录' }, 401);
  if (!hasPlatformAdminAccess(user)) return json({ error: '仅平台管理员可记录人工查证' }, 403);
  if (!sameOrigin(request)) return json({ error: '人工查证请求来源不正确' }, 403);
  try {
    const body = await readBody(request);
    const applicationId = reviewApplicationId(body?.applicationId);
    const application = await accessibleApplication(user, applicationId);
    if (typeof body.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(body.snapshotId)) throw new BrandDocumentReviewError(400, '快照编号不正确');
    if (body.snapshotId !== brandDocumentReviewSnapshotId(application)) throw new BrandDocumentReviewError(409, '申请资料已改变，请重新读取后查证');
    const input = validateBrandDocumentReviewInput(body, application);
    const record = await appendBrandDocumentReview(input, user.id, () => accessibleApplication(user, applicationId));
    return json({ record }, 201);
  } catch (error) { return fail(error); }
}

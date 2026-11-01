import { serializeBrandAssetUploadResponse } from '@/lib/brand-asset-upload-core';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { objectStorageObjects } from '@/lib/schema';
import { brandPilotDbEnabled, getDbApprovedBrandById, getDbApprovedBrandForUser, getDbBrandPageRecord } from '@/lib/brand-pilot-db';
import { getApprovedBrandById, getApprovedBrandForUser, getBrandPageRecord, getOwnBrandApplicationForUser, listPublicBrandProducts } from '@/lib/local-cn-brand-marketplace';
import { getLocalBrandAssetMetadata, persistBrandAssetBuffer, type StoredBrandAsset } from '@/lib/object-storage';

export const dynamic = 'force-dynamic';

function dataDir() {
  return process.env.LOCAL_CN_DATA_DIR || path.join(process.cwd(), '.data');
}

function mediaRoot() {
  return process.env.CN_PILOT_MEDIA_DIR || path.join(dataDir(), 'object-storage');
}

function contentTypeForKey(key: string) {
  if (/\.jpe?g$/i.test(key)) return 'image/jpeg';
  if (/\.webp$/i.test(key)) return 'image/webp';
  return 'image/png';
}

function publicUrlForKey(key: string) {
  return `/api/cn/brand-assets?key=${encodeURIComponent(key)}`;
}

function documentContainsAsset(document: unknown, key: string) {
  if (!document) return false;
  const text = JSON.stringify(document);
  return text.includes(publicUrlForKey(key)) || text.includes(key);
}

async function dbAssetMetadata(key: string): Promise<StoredBrandAsset | null> {
  if (!process.env.DATABASE_URL) return null;
  const row = (await db.select().from(objectStorageObjects).where(eq(objectStorageObjects.objectKey, key)).limit(1))[0];
  if (!row || !row.brandId || !row.ownerMemberId) return null;
  return {
    provider: row.provider,
    objectKey: row.objectKey,
    publicUrl: row.publicUrl,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    ownerMemberId: row.ownerMemberId,
    brandId: row.brandId,
    purpose: 'brand-page',
    width: 0,
    height: 0,
    createdAt: row.createdAt?.toISOString?.() || new Date().toISOString(),
  };
}

// 'public' = 已公开（已发布品牌馆 / 已上架商品引用）；'private' = 仅上传者、所属品牌或平台管理员可见（审核中的图片）
async function canReadAsset(request: NextRequest, key: string): Promise<'public' | 'private' | false> {
  const meta = process.env.DATABASE_URL ? await dbAssetMetadata(key) : getLocalBrandAssetMetadata(key);
  if (!meta) return false;

  if (brandPilotDbEnabled()) {
    const brand = await getDbApprovedBrandById(meta.brandId);
    if (brand) {
      const page = await getDbBrandPageRecord(brand);
      if (page.status === 'published' && documentContainsAsset(page.published, key)) return 'public';
    }
  } else {
    const brand = getApprovedBrandById(meta.brandId);
    if (brand) {
      const page = getBrandPageRecord(brand);
      if (page.status === 'published' && documentContainsAsset(page.published, key)) return 'public';
    }
    if (listPublicBrandProducts().some((product) => (product.brandId === meta.brandId || meta.brandId === 0) && documentContainsAsset({ imageUrl: product.imageUrl, images: product.images }, key))) return 'public';
  }

  const user = getRequestSession(request);
  if (user) {
    if (meta.ownerMemberId === user.id || hasPlatformAdminAccess(user)) return 'private';
    const brand = brandPilotDbEnabled() ? await getDbApprovedBrandForUser(user.id) : getApprovedBrandForUser(user.id);
    if (brand?.id === meta.brandId) return 'private';
    if (!brandPilotDbEnabled() && getOwnBrandApplicationForUser(user.id)?.id === meta.brandId) return 'private';
  }
  return false;
}

function validObjectKey(key: string) {
  return Boolean(key && !key.includes('..') && !key.startsWith('/') && !key.includes('\\') && !/^[a-z]:/i.test(key));
}

export async function GET(request: NextRequest) {
  const key = String(request.nextUrl.searchParams.get('key') || '').trim();
  if (!validObjectKey(key)) return NextResponse.json({ error: '图片路径不正确' }, { status: 400 });
  const root = path.resolve(mediaRoot());
  const target = path.resolve(path.join(root, key));
  if ((target !== root && !target.startsWith(`${root}${path.sep}`)) || !existsSync(target)) return NextResponse.json({ error: '图片不存在' }, { status: 404 });
  const access = await canReadAsset(request, key);
  if (!access) return NextResponse.json({ error: '无权读取这张图片' }, { status: 403 });
  return new NextResponse(readFileSync(target), {
    headers: {
      'Content-Type': contentTypeForKey(key),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': access === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    // 审核需要图片：已核准品牌、审核中/被退回的品牌申请人、平台管理员均可上传；图片在商品/品牌馆公开前仅本人、所属品牌与管理员可见
    const approved = brandPilotDbEnabled() ? await getDbApprovedBrandForUser(user.id) : getApprovedBrandForUser(user.id);
    const application = (approved || brandPilotDbEnabled()) ? null : getOwnBrandApplicationForUser(user.id);
    const brandId = approved?.id ?? application?.id ?? (hasPlatformAdminAccess(user) ? 0 : null);
    if (brandId == null) return NextResponse.json({ error: '请先提交品牌入驻申请后再上传图片' }, { status: 403 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择图片文件' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const saved = await persistBrandAssetBuffer({
      bytes,
      declaredType: file.type,
      ownerMemberId: user.id,
      brandId,
      purpose: String(form.get('purpose') || 'brand-page') === 'product' ? 'product' : 'brand-page',
    });
    return NextResponse.json(serializeBrandAssetUploadResponse(saved), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '图片上传失败' }, { status: 400 });
  }
}

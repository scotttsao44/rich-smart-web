import { serializeBrandAssetUploadResponse } from '@/lib/brand-asset-upload-core';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { objectStorageObjects } from '@/lib/schema';
import { brandPilotDbEnabled, getDbApprovedBrandById, getDbApprovedBrandForUser, getDbBrandPageRecord } from '@/lib/brand-pilot-db';
import { getApprovedBrandById, getApprovedBrandForUser, getBrandPageRecord } from '@/lib/local-cn-brand-marketplace';
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

async function canReadAsset(request: NextRequest, key: string) {
  const meta = process.env.DATABASE_URL ? await dbAssetMetadata(key) : getLocalBrandAssetMetadata(key);
  if (!meta) return false;

  const user = getRequestSession(request);
  if (user) {
    const brand = brandPilotDbEnabled() ? await getDbApprovedBrandForUser(user.id) : getApprovedBrandForUser(user.id);
    if (brand?.id === meta.brandId) return true;
  }

  if (brandPilotDbEnabled()) {
    const brand = await getDbApprovedBrandById(meta.brandId);
    if (!brand) return false;
    const page = await getDbBrandPageRecord(brand);
    return page.status === 'published' && documentContainsAsset(page.published, key);
  }

  const brand = getApprovedBrandById(meta.brandId);
  if (!brand) return false;
  const page = getBrandPageRecord(brand);
  return page.status === 'published' && documentContainsAsset(page.published, key);
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
  if (!(await canReadAsset(request, key))) return NextResponse.json({ error: '无权读取这张图片' }, { status: 403 });
  return new NextResponse(readFileSync(target), {
    headers: {
      'Content-Type': contentTypeForKey(key),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const brand = brandPilotDbEnabled() ? await getDbApprovedBrandForUser(user.id) : getApprovedBrandForUser(user.id);
    if (!brand) return NextResponse.json({ error: '品牌审核通过后才能上传图片' }, { status: 403 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择图片文件' }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const saved = await persistBrandAssetBuffer({
      bytes,
      declaredType: file.type,
      ownerMemberId: user.id,
      brandId: brand.id,
      purpose: String(form.get('purpose') || 'brand-page') === 'product' ? 'product' : 'brand-page',
    });
    return NextResponse.json(serializeBrandAssetUploadResponse(saved), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '图片上传失败' }, { status: 400 });
  }
}

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { getStoreProfile, isPhotoPublic, profilePhotoDir } from '@/lib/local-cn-experience-points';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// 店主照片：已批准公开的照片任何人可看；未批准的只给后台与本人
export async function GET(request: NextRequest) {
  const p = String(request.nextUrl.searchParams.get('p') || '').replace(/[^a-z0-9_-]/gi, '');
  const f = String(request.nextUrl.searchParams.get('f') || '').replace(/[^a-z0-9_-]/gi, '');
  const profile = p ? getStoreProfile(p) : null;
  const photo = profile?.photos.find((x) => x.id === f && x.status === 'ok' && x.file);
  if (!profile || !photo) return new NextResponse('Not found', { status: 404 });
  const isPublic = isPhotoPublic(p, f);
  if (!isPublic) {
    const user = await getFreshSessionUser(request);
    if (!hasPlatformAdminAccess(user) && !(user && profile.memberId === user.id)) return new NextResponse('Not found', { status: 404 });
  }
  const file = path.join(profilePhotoDir(p), path.basename(photo.file));
  if (!existsSync(file)) return new NextResponse('Not found', { status: 404 });
  const ext = path.extname(file).slice(1).toLowerCase();
  return new NextResponse(readFileSync(file), {
    headers: {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': isPublic ? 'public, max-age=3600' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

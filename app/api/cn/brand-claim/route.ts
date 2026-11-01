import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import {
  claimBrandWithToken,
  createBrandClaimLink,
  describeClaimant,
  inspectBrandClaim,
  listBrandClaimLinks,
  revokeBrandClaimLink,
} from '@/lib/local-cn-brand-claim';

export const dynamic = 'force-dynamic';

function appOrigin(request: NextRequest) {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (/^https:\/\/[^/]+$/.test(configured)) return configured;
  return 'https://rich-smart.com.cn';
}

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (request.nextUrl.searchParams.get('scope') === 'admin') {
    if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台管理员可查看' }, { status: 403 });
    return NextResponse.json({ claims: listBrandClaimLinks(user) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const token = String(request.nextUrl.searchParams.get('t') || '');
  const claim = token ? inspectBrandClaim(token) : null;
  return NextResponse.json({ claim, viewer: describeClaimant(user) }, { status: claim ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');
  try {
    if (action === 'create') {
      if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台管理员可建立认领链接' }, { status: 403 });
      const result = createBrandClaimLink(user, Number(body.brandId));
      return NextResponse.json({ claim: result.claim, url: `${appOrigin(request)}/cn/brand/claim?t=${result.token}` }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'revoke') {
      if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台管理员可撤销认领链接' }, { status: 403 });
      return NextResponse.json({ claim: revokeBrandClaimLink(user, String(body.claimId || '')) });
    }
    if (action === 'claim') {
      if (!user) return NextResponse.json({ error: '请先用微信登录后再认领' }, { status: 401 });
      return NextResponse.json({ ok: true, ...claimBrandWithToken(user, String(body.token || '')) });
    }
    return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400 });
  }
}

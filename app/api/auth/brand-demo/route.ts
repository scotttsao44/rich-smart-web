import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function legacyBrandDemoDisabled() {
  return NextResponse.json({
    error: '旧品牌 Demo 已停用，请使用正常登录页的品牌受邀测试登入。',
    next: '/cn/login?next=%2Fcn%2Fshop',
    replacement: '/api/auth/brand-pilot-login',
  }, { status: 410 });
}

export function GET() {
  return legacyBrandDemoDisabled();
}

export function POST() {
  return legacyBrandDemoDisabled();
}

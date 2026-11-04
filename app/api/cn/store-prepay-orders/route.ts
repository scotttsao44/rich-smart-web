import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { listAllStorePrepayOrderViews, listStorePrepayOrderViewsForUser } from '@/lib/cn-store-prepay';

// 门店预购次数（次卡）订单列表
// GET            → 本人的次卡订单（「我的订单」用；只看自己）
// GET ?scope=all → 全部次卡订单（仅平台管理员；后台订单 / 对账用）
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (request.nextUrl.searchParams.get('scope') === 'all') {
    if (!hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅平台管理员可查看' }, { status: 403 });
    return NextResponse.json({ orders: listAllStorePrepayOrderViews() });
  }
  return NextResponse.json({ orders: listStorePrepayOrderViewsForUser(user.id) });
}

import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { brandPilotDbEnabled, getDbBrandCommissionDefaults, updateDbBrandCommissionDefaults } from '@/lib/brand-pilot-db';
import { getBrandCommissionDefaults, updateBrandCommissionDefaults } from '@/lib/local-cn-brand-marketplace';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: '请先登录品牌工作台' }, { status: 401 });
  try {
    const settings = brandPilotDbEnabled()
      ? await getDbBrandCommissionDefaults(user)
      : getBrandCommissionDefaults(user);
    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取分润设置失败';
    return NextResponse.json({ error: message }, { status: message.includes('审核通过') ? 403 : 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: '请先登录品牌工作台' }, { status: 401 });
  try {
    const input = await request.json();
    const settings = brandPilotDbEnabled()
      ? await updateDbBrandCommissionDefaults(user, input)
      : updateBrandCommissionDefaults(user, input);
    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存分润设置失败';
    return NextResponse.json({ error: message }, { status: message.includes('无权') || message.includes('审核通过') ? 403 : 400 });
  }
}

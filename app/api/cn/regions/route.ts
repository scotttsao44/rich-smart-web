import { NextRequest, NextResponse } from 'next/server';
import { listChinaCities, listChinaDistricts, listChinaProvinces } from '@/lib/china-regions';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const level = request.nextUrl.searchParams.get('level') || 'province';
  const parent = request.nextUrl.searchParams.get('parent') || '';
  if (level === 'province') return NextResponse.json({ version: '8.5.8', regions: listChinaProvinces() });
  if (level === 'city' && /^\d{6}$/.test(parent)) return NextResponse.json({ version: '8.5.8', regions: listChinaCities(parent) });
  if (level === 'district' && /^\d{6}$/.test(parent)) return NextResponse.json({ version: '8.5.8', regions: listChinaDistricts(parent) });
  return NextResponse.json({ error: '地区查询参数不正确' }, { status: 400 });
}

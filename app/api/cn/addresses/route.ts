import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import {
  deleteLocalCnAddress,
  listLocalCnAddresses,
  saveLocalCnAddress,
  setDefaultLocalCnAddress,
} from '@/lib/local-cn-addresses';
import { listChinaCities, listChinaDistricts, listChinaProvinces } from '@/lib/china-regions';
import { normalizeContactPhone } from '@/lib/international-phone';

export const dynamic = 'force-dynamic';

function sessionOrError(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return { user: null, response: NextResponse.json({ error: '请先登录' }, { status: 401 }) };
  return { user, response: null };
}

function validate(body: Record<string, unknown>) {
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const region = String(body.region || '').trim();
  const provinceCode = String(body.provinceCode || '').trim();
  const cityCode = String(body.cityCode || '').trim();
  const districtCode = String(body.districtCode || '').trim();
  const address = String(body.address || '').trim();
  const hasStructuredRegion = /^\d{6}$/.test(provinceCode) && /^\d{6}$/.test(cityCode) && /^\d{6}$/.test(districtCode);
  if (!name || !phone || (!hasStructuredRegion && !region) || !address) return '请完整填写收件人、手机、省市区县和详细地址';
  try { normalizeContactPhone(phone); } catch { return '请输入有效的中国大陆或国际手机号'; }
  if (name.length > 50 || region.length > 100 || address.length > 300) return '收货信息过长，请检查后重试';
  return null;
}

function normalizeStructuredRegion(body: Record<string, unknown>) {
  const provinceCode = String(body.provinceCode || '').trim();
  const cityCode = String(body.cityCode || '').trim();
  const districtCode = String(body.districtCode || '').trim();
  if (!provinceCode && !cityCode && !districtCode) return { body, error: '' };
  const province = listChinaProvinces().find((item) => item.code === provinceCode);
  const city = province ? listChinaCities(provinceCode).find((item) => item.code === cityCode) : null;
  const district = city ? listChinaDistricts(cityCode).find((item) => item.code === districtCode) : null;
  if (!province || !city || !district) return { body, error: '省、市、区县资料不匹配，请重新选择' };
  const region = [province.name, city.name === province.name ? '' : city.name, district.name].filter(Boolean).join('');
  return { body: { ...body, province: province.name, city: city.name, district: district.name, region }, error: '' };
}

export async function GET(request: NextRequest) {
  const { user, response } = sessionOrError(request);
  if (response || !user) return response;
  return NextResponse.json({ addresses: listLocalCnAddresses(user.id) });
}

export async function POST(request: NextRequest) {
  const { user, response } = sessionOrError(request);
  if (response || !user) return response;
  const input = await request.json();
  const normalized = normalizeStructuredRegion(input);
  if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 });
  const body = normalized.body;
  const error = validate(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const address = saveLocalCnAddress(user.id, { ...body, phone: normalizeContactPhone(body.phone) });
  return NextResponse.json({ address }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const { user, response } = sessionOrError(request);
  if (response || !user) return response;
  const input = await request.json();
  if (!input.id) return NextResponse.json({ error: '缺少地址编号' }, { status: 400 });
  if (input.action === 'set_default') {
    const address = setDefaultLocalCnAddress(user.id, String(input.id));
    return address ? NextResponse.json({ address }) : NextResponse.json({ error: '找不到地址' }, { status: 404 });
  }
  const normalized = normalizeStructuredRegion(input);
  if (normalized.error) return NextResponse.json({ error: normalized.error }, { status: 400 });
  const body = normalized.body;
  const error = validate(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const address = saveLocalCnAddress(user.id, { ...body, phone: normalizeContactPhone(body.phone) });
  return NextResponse.json({ address });
}

export async function DELETE(request: NextRequest) {
  const { user, response } = sessionOrError(request);
  if (response || !user) return response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少地址编号' }, { status: 400 });
  return deleteLocalCnAddress(user.id, id)
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: '找不到地址' }, { status: 404 });
}

import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { createBrandProduct, listBrandProducts, reviewBrandProduct, updateBrandProduct } from '@/lib/local-cn-brand-marketplace';
import { brandPilotDbEnabled, createDbBrandProduct, listDbBrandProducts, reviewDbBrandProduct, updateDbBrandProduct } from '@/lib/brand-pilot-db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  const scope = String(request.nextUrl.searchParams.get('scope') || 'mine') as 'mine' | 'review' | 'public';
  if (scope !== 'public' && !user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const fallbackUser = user || { id: 0, name: '', email: '', role: 'member', region: 'CN', agentLevel: 0 };
    const products = brandPilotDbEnabled()
      ? await listDbBrandProducts(fallbackUser, scope)
      : listBrandProducts(fallbackUser, scope);
    return NextResponse.json({ products });
  } catch (error) {
    const message = error instanceof Error ? error.message : '读取失败';
    return NextResponse.json({ error: message }, { status: message.includes('仅平台') ? 403 : 400 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const input = await request.json();
    const product = brandPilotDbEnabled()
      ? await createDbBrandProduct(user, input, false)
      : createBrandProduct(user, input);
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '提交失败';
    return NextResponse.json({ error: message }, { status: message.includes('重复') || message.includes('正在审核') ? 409 : 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getFreshSessionUser(request).catch(() => null);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const body = await request.json();
    const action = String(body.action || '');
    let product;
    if (action === 'review') {
      product = brandPilotDbEnabled()
        ? await reviewDbBrandProduct(user, Number(body.id), String(body.decision || '') as 'approved' | 'rejected', String(body.reviewNote || ''))
        : reviewBrandProduct(user, Number(body.id), String(body.decision || '') as 'approved' | 'rejected', String(body.reviewNote || ''));
    } else {
      if (!['toggle', 'commission', 'resubmit'].includes(action)) throw new Error('不支持的商品操作');
      product = brandPilotDbEnabled()
        ? await updateDbBrandProduct(user, Number(body.id), action as 'toggle' | 'commission' | 'resubmit', body)
        : updateBrandProduct(user, Number(body.id), action as 'toggle' | 'commission' | 'resubmit', body);
    }
    return NextResponse.json({ product });
  } catch (error) {
    const message = error instanceof Error ? error.message : '操作失败';
    return NextResponse.json({ error: message }, { status: message.includes('无权') || message.includes('仅平台') ? 403 : 400 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession } from '@/lib/auth';
import { getWallet, requestWithdrawal } from '@/lib/local-cn-commerce';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  return NextResponse.json(getWallet(user.id));
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const body = await request.json();
    const withdrawal = requestWithdrawal(user.id, { method: String(body.method || 'wechat_wallet'), realName: String(body.realName || ''), account: String(body.account || ''), amount: Number(body.amount) });
    const liveEnabled = process.env.WECHAT_MERCHANT_TRANSFER_ENABLED === 'true';
    const message = liveEnabled
      ? '申请已提交；审核通过后会在小程序内提示您确认收款。'
      : '申请已保存并进入审核；商户转账能力尚未开通，目前不会汇出真实款项。';
    return NextResponse.json({ withdrawal, message, transferReady: liveEnabled }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '提现申请失败' }, { status: 400 });
  }
}

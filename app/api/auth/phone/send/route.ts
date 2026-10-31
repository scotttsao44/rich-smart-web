import { NextRequest, NextResponse } from 'next/server';
import { issuePhoneCodeChallenge, normalizeCnOrTwPhone } from '@/lib/phone-sms/challenges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = normalizeCnOrTwPhone(body?.phone);
    if (!phone) {
      return NextResponse.json(
        { error: '请输入有效的 11 位中国大陆手机号（1 开头）或 10 位台湾手机号（09 开头）' },
        { status: 400 },
      );
    }

    const { code, expiresAt } = issuePhoneCodeChallenge(phone);
    const transitionalMode = process.env.CN_TRANSITIONAL_TEST_MODE !== 'false';

    return NextResponse.json({
      ok: true,
      phone,
      expiresAt,
      deliveryMode: transitionalMode ? 'pilot_instant' : 'sms',
      pilotCode: transitionalMode ? code : undefined,
      message: transitionalMode
        ? `测试期即时验证码已生成：${code}（已自动填入，10 分钟内有效）`
        : '验证码已发送，请查收短信',
    });
  } catch (error) {
    console.error('Phone send error:', error);
    return NextResponse.json({ error: '发送验证码失败，请稍后重试' }, { status: 500 });
  }
}

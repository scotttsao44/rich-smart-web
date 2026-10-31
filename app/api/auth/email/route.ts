import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, setSessionCookie } from '@/lib/auth';
import { clearPendingReferralAttributionCookie, readPendingReferralAttribution } from '@/lib/local-cn-referral-attribution';
import { EmailAuthError, emailAuthConfigured, isAllowedEmailAuthOrigin, loginEmailMember, requestEmailRegistration, verifyEmailRegistration } from '@/lib/email-auth/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const BROWSER_COOKIE = 'rs_email_browser';
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function GET() { return json({ registrationEnabled: emailAuthConfigured(), loginEnabled: process.env.EMAIL_AUTH_ENABLED === 'true' && !process.env.DATABASE_URL && Boolean(process.env.LOCAL_CN_DATA_DIR) && (process.env.EMAIL_AUTH_SECRET || '').length >= 32 }); }

export async function POST(request: NextRequest) {
  try {
    const requestOrigin = request.headers.get('origin');
    if (!isAllowedEmailAuthOrigin(requestOrigin, request.nextUrl.origin) || !request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '请求来源无效' }, 403);
    const origin = requestOrigin || request.nextUrl.origin;
    const reader = request.body?.getReader();
    if (!reader) return json({ error: '请求格式无效' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); return json({ error: '请求内容过长' }, 413); }
      chunks.push(part.value);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: '请求格式无效' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '请求格式无效' }, 400);
    // Direct account switch allowed: new login/registration overwrites current session cookie
    const existingBrowser = request.cookies.get(BROWSER_COOKIE)?.value || '';
    const browser = /^[a-f0-9]{48}$/.test(existingBrowser) ? existingBrowser : randomBytes(24).toString('hex');
    if (body.action === 'request' || body.action === 'reset') {
      const fallbackRef = typeof body.ref === 'string' && body.ref.trim() ? body.ref.trim() : typeof body.referrerCode === 'string' && body.referrerCode.trim() ? body.referrerCode.trim() : null;
      const challenge = await requestEmailRegistration({ ...body, confirmReferral: body.confirmReferral !== false, purpose: body.action === 'reset' ? 'reset' : 'register' }, browser, readPendingReferralAttribution(request, fallbackRef));
      const msg = challenge.pilotCode ? `过渡测试期验证码已生成（${challenge.pilotCode}），已为您自动填入` : '验证码已发送，请查收邮箱';
      const response = json({ ...challenge, message: msg });
      response.cookies.set(BROWSER_COOKIE, browser, { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https://'), path: '/api/auth/email', maxAge: 3600 });
      return response;
    }
    if (body.action === 'verify' || body.action === 'login') {
      const user = body.action === 'verify'
        ? verifyEmailRegistration(typeof body.challengeId === 'string' ? body.challengeId : '', typeof body.code === 'string' ? body.code : '', browser)
        : loginEmailMember(body.email, body.password);
      const response = json({ user, next: '/cn/member' });
      setSessionCookie(response, user);
      if (body.action === 'verify') {
        clearPendingReferralAttributionCookie(response, origin.startsWith('https://'));
        response.cookies.set(BROWSER_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: origin.startsWith('https://'), path: '/api/auth/email', maxAge: 0 });
      }
      return response;
    }
    return json({ error: '不支持的操作' }, 400);
  } catch (error) {
    if (error instanceof EmailAuthError) return json({ code: error.code, error: error.message }, error.status);
    // SMTP credentials, passwords and verification codes must never enter logs.
    return json({ error: '邮箱服务暂时不可用，请稍后重试' }, 503);
  }
}

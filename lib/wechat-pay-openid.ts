import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';

/** 支付专用的公众号 openid（snsapi_base 静默授权取得），以 HMAC 绑定会员 id 存于 httpOnly cookie，仅用于 JSAPI 下单。 */
export const WX_PAY_OPENID_COOKIE = 'rs_wx_pay_openid';
const STATE_COOKIE = 'rs_wx_pay_state';
const MAX_AGE = 60 * 60 * 24 * 30;

function secret() {
  const value = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || process.env.PAYMENT_CALLBACK_SECRET || '';
  if (!value) throw new Error('缺少签名密钥');
  return value;
}

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function readPayOpenId(request: NextRequest, userId: number) {
  const raw = request.cookies.get(WX_PAY_OPENID_COOKIE)?.value || '';
  const [encoded, uid, sig] = raw.split('.');
  if (!encoded || !uid || !sig) return '';
  if (Number(uid) !== Number(userId)) return '';
  if (!safeEqual(sign(`${encoded}.${uid}`), sig)) return '';
  try { return Buffer.from(encoded, 'base64url').toString('utf8'); } catch { return ''; }
}

export function setPayOpenIdCookie(response: NextResponse, userId: number, openId: string) {
  const encoded = Buffer.from(openId, 'utf8').toString('base64url');
  response.cookies.set(WX_PAY_OPENID_COOKIE, `${encoded}.${userId}.${sign(`${encoded}.${userId}`)}`, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: MAX_AGE,
  });
}

export function createPayState(userId: number, next: string) {
  const payload = Buffer.from(JSON.stringify({ u: userId, n: next, r: randomBytes(8).toString('hex'), e: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function setPayStateCookie(response: NextResponse, state: string) {
  response.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 600 });
}

export function verifyPayState(request: NextRequest, state: string | null) {
  const cookie = request.cookies.get(STATE_COOKIE)?.value || '';
  if (!state || !cookie || !safeEqual(state, cookie)) throw new Error('授权状态失效，请重新点击去付款');
  const [payload, sig] = state.split('.');
  if (!payload || !sig || !safeEqual(sign(payload), sig)) throw new Error('授权状态签名不正确');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: number; n: string; e: number };
  if (data.e < Date.now()) throw new Error('授权已过期，请重新点击去付款');
  return { userId: Number(data.u), next: sanitizeNext(data.n) };
}

export function clearPayStateCookie(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 0 });
}

export function sanitizeNext(value: string | null | undefined) {
  const v = String(value || '');
  if (!v.startsWith('/cn/') || v.startsWith('//')) return '/cn/orders';
  return v;
}

export function payOrigin() {
  const configured = process.env.WECHAT_WEB_AUTH_ORIGIN || process.env.WECHAT_WEB_AUTH_DOMAIN || process.env.PUBLIC_DOMAIN || 'rich-smart.com.cn';
  const first = configured.split(',')[0].trim().replace(/\/+$/, '');
  return first.startsWith('http') ? first : `https://${first}`;
}

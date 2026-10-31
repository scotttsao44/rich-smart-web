import { NextRequest, NextResponse } from 'next/server';

const CN_HOME = '/cn/shop';
const CN_LOGIN = '/cn/login';

const PROTECTED_CN_PREFIXES = [
  '/cn/cart',
  '/cn/member',
  '/cn/ops',
  '/cn/orders',
  '/cn/promoter',
  '/cn/store',
];

function hasSession(request: NextRequest) {
  return Boolean(
    request.cookies.get('session')?.value ||
    request.cookies.get('richsmart_session')?.value
  );
}

function isProtectedCnPath(pathname: string) {
  return PROTECTED_CN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function requestOrigin(request: NextRequest) {
  const forwardedHost = (request.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  const host = forwardedHost || (request.headers.get('host') || '').split(',')[0].trim();
  if (!host) return request.nextUrl.origin;

  const forwardedProtocol = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  const protocol = forwardedProtocol || request.nextUrl.protocol.replace(/:$/, '') || 'https';
  return `${protocol}://${host}`;
}

function redirectTo(request: NextRequest, targetPathAndSearch: string) {
  return NextResponse.redirect(new URL(targetPathAndSearch, requestOrigin(request)));
}

function safeCnReturnTo(value: string | null) {
  if (!value) return CN_HOME;
  if (!value.startsWith('/') || value.startsWith('//')) return CN_HOME;
  return value.startsWith('/cn') || value.startsWith('/vendor') ? value : CN_HOME;
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL(CN_LOGIN, requestOrigin(request));
  const returnTo = safeCnReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (returnTo !== CN_HOME) loginUrl.searchParams.set('returnTo', returnTo);
  const ref = request.nextUrl.searchParams.get('ref') || request.nextUrl.searchParams.get('r');
  if (ref) loginUrl.searchParams.set('ref', ref);
  return NextResponse.redirect(loginUrl);
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = hasSession(request);

  if (pathname === CN_LOGIN) {
    return NextResponse.next();
  }

  if (pathname === '/' || pathname === '/cn') {
    return redirectTo(request, `${CN_HOME}${search || ''}`);
  }

  if (pathname === '/vendor' || pathname.startsWith('/vendor/')) {
    if (!signedIn) return redirectToLogin(request);
    return NextResponse.next();
  }

  if (pathname.startsWith('/cn/') && isProtectedCnPath(pathname) && !signedIn) {
    return redirectToLogin(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/cn/:path*', '/vendor/:path*'],
};

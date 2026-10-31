import { createHmac, timingSafeEqual } from 'crypto';

const TOKEN_PREFIX = 'vendor-product-review';

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-change-before-production';
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createVendorProductToken(productId: number) {
  return createHmac('sha256', authSecret())
    .update(`${TOKEN_PREFIX}:${productId}`)
    .digest('base64url');
}

export function verifyVendorProductToken(productId: number, token: string | null | undefined) {
  if (!token) return false;
  return safeEqual(createVendorProductToken(productId), token);
}

export function getVendorProductEditUrl(productId: number, origin?: string | null) {
  const baseUrl = (origin || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  const path = `/vendor/products/${productId}/edit?token=${encodeURIComponent(createVendorProductToken(productId))}`;
  return baseUrl ? `${baseUrl}${path}` : path;
}

export function parseSupplierInfo(raw: string | null | undefined) {
  const text = String(raw || '').trim();
  const parts = text.split('/').map((part) => part.trim()).filter(Boolean);
  const result = {
    supplierName: parts[0] || text,
    supplierContact: '',
    supplierPhone: '',
    supplierLine: '',
    supplierServiceId: '',
    supplierWechat: '',
    supplierEmail: '',
  };

  for (const part of parts.slice(1)) {
    if (part.startsWith('联系人:')) result.supplierContact = part.replace('联系人:', '').trim();
    if (part.startsWith('电话:')) result.supplierPhone = part.replace('电话:', '').trim();
    if (part.startsWith('LINE:')) result.supplierLine = part.replace('LINE:', '').trim();
    if (part.startsWith('客服:')) result.supplierServiceId = part.replace('客服:', '').trim();
    if (part.startsWith('微信:')) result.supplierWechat = part.replace('微信:', '').trim();
    if (part.startsWith('Email:')) result.supplierEmail = part.replace('Email:', '').trim();
  }

  return result;
}

export function buildSupplierInfo(body: Record<string, unknown>) {
  const contacts = [
    body.supplierPhone ? `电话:${String(body.supplierPhone).trim()}` : '',
    body.supplierServiceId ? `客服:${String(body.supplierServiceId).trim()}` : '',
    body.supplierLine ? `客服:${String(body.supplierLine).trim()}` : '',
    body.supplierWechat ? `微信:${String(body.supplierWechat).trim()}` : '',
    body.supplierEmail ? `Email:${String(body.supplierEmail).trim()}` : '',
  ].filter(Boolean);

  return {
    contacts,
    supplierName: `${String(body.supplierName || '').trim()} / 联系人:${String(body.supplierContact || '').trim()} / ${contacts.join(' / ')}`,
  };
}

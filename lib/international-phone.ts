export function normalizeWechatVerifiedPhone(purePhoneNumber: unknown, countryCode: unknown) {
  const localDigits = String(purePhoneNumber || '').replace(/\D/g, '');
  const countryDigits = String(countryCode || '').replace(/\D/g, '');
  if (!localDigits || !countryDigits) throw new Error('微信返回的手机号资料不完整');

  if (countryDigits === '86' && /^1\d{10}$/.test(localDigits)) return localDigits;

  const subscriberDigits = localDigits.replace(/^0+/, '');
  const international = `+${countryDigits}${subscriberDigits}`;
  if (!/^\+[1-9]\d{6,14}$/.test(international)) throw new Error('微信返回的国际手机号格式不正确');
  return international;
}

export function normalizeContactPhone(phone: unknown) {
  const compact = String(phone || '')
    .trim()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[\s()（）-]/g, '');
  if (/^1\d{10}$/.test(compact)) return compact;
  if (/^09\d{8}$/.test(compact)) return `+886${compact.slice(1)}`;
  const taiwan = compact.match(/^(?:\+886|00886|886)0?(9\d{8})$/);
  if (taiwan) return `+886${taiwan[1]}`;
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return compact;
  throw new Error('请输入有效的中国大陆或国际手机号');
}

export const normalizeStoredVerifiedPhone = normalizeContactPhone;

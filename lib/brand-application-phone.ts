export function isValidBrandApplicationPhone(value: string) {
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) return false;
  const phone = value.trim();
  if (!/^\+?(?:[0-9]+|\([0-9]+\))(?:[ -]*(?:[0-9]+|\([0-9]+\)))*$/.test(phone)) return false;
  const digits = phone.replace(/[^0-9]/g, '');
  // Contact shape only, not country-specific eligibility or verified ownership.
  return digits.length >= 7 && digits.length <= 15;
}

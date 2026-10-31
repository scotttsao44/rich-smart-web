import { normalizeStoredVerifiedPhone } from './international-phone';

// Contact aliases are collision checks only, never evidence of member ownership.
export function phoneContactLookupValues(phone: string) {
  const normalized = normalizeStoredVerifiedPhone(phone);
  if (/^1\d{10}$/.test(normalized)) return [normalized, `+86${normalized}`];
  if (/^\+861\d{10}$/.test(normalized)) return [normalized.slice(3), normalized];
  if (/^\+8869\d{8}$/.test(normalized)) {
    const subscriber = normalized.slice(4);
    return [normalized, `0${subscriber}`, `886${subscriber}`, `00886${subscriber}`, `+8860${subscriber}`, `8860${subscriber}`, `008860${subscriber}`];
  }
  return [normalized];
}

export function samePhoneContact(stored: string, incoming: string) {
  try {
    return phoneContactLookupValues(incoming).includes(normalizeStoredVerifiedPhone(stored));
  } catch { return false; }
}

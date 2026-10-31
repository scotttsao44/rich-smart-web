import { normalizeStoredVerifiedPhone } from '../international-phone';

export type VerifiedPhoneBinding = { memberId: number; phone: string; verifiedAt: string };
export type PhoneMember = { id: number; role: string; platformAdmin?: boolean; status?: string };

function canonicalPhone(phone: string) {
  const normalized = normalizeStoredVerifiedPhone(phone);
  return /^1\d{10}$/.test(normalized) ? `+86${normalized}` : normalized;
}

// Caller supplies authoritative verified bindings, never a user contact field.
// No registration, account merging, referral mutation, or role escalation here.
export function resolveVerifiedPhoneMember<T extends PhoneMember>(
  phone: string, bindings: readonly VerifiedPhoneBinding[], members: readonly T[],
): T | null {
  const normalized = canonicalPhone(phone);
  const matching = bindings.filter((row) => {
    if (!row.verifiedAt || !Number.isFinite(Date.parse(row.verifiedAt))) return false;
    try { return canonicalPhone(row.phone) === normalized; } catch { return false; }
  });
  const ids = new Set(matching.map((row) => row.memberId));
  if (ids.size !== 1) return null;
  const id = matching[0].memberId;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const candidates = members.filter((row) => row.id === id);
  if (candidates.length !== 1) return null;
  const member = candidates[0];
  if (member.role !== 'member' || member.platformAdmin || (member.status && member.status !== 'active')) return null;
  return member;
}

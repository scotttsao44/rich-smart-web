import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { randomBytes } from 'crypto';

export function sanitizeReferralCode(value: string | null | undefined) {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.slice(0, 100);
}

export function createReferralCode(seed?: string | number | null) {
  const prefix = seed ? String(seed).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) : 'RS';
  return `${prefix || 'RS'}${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase().slice(0, 30);
}

export function referralCodeFromUserId(userId: number) {
  return `RS${userId}`;
}

export function buildReferralUrl(origin: string, code: string | number | null | undefined) {
  const normalized = sanitizeReferralCode(String(code || ''));
  return `${origin.replace(/\/$/, '')}/join?ref=${encodeURIComponent(normalized)}`;
}

export async function resolveReferrerId(referralCode: string | null | undefined, database: Pick<typeof db, 'select'> = db) {
  const normalized = sanitizeReferralCode(referralCode);
  if (!normalized) return null;

  const rawId = /^\d+$/.test(normalized) ? Number(normalized) : null;
  const rsId = /^RS\d+$/i.test(normalized) ? Number(normalized.slice(2)) : null;
  const candidateId = rawId || rsId;

  const rows = await database
    .select({ id: users.id })
    .from(users)
    .where(
      candidateId
        ? or(eq(users.referralCode, normalized), eq(users.id, candidateId))
        : eq(users.referralCode, normalized)
    )
    .limit(1);

  return rows[0]?.id || null;
}

export async function bindReferrerIfMissing(userId: number, referralCode: string | null | undefined) {
  const referrerId = await resolveReferrerId(referralCode);
  if (!referrerId || referrerId === userId) return false;

  const current = await db
    .select({ referrerId: users.referrerId, referredByMemberId: users.referredByMemberId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!current[0] || current[0].referrerId || current[0].referredByMemberId) return false;

  const updated = await db
    .update(users)
    .set({
      referrerId,
      referredByMemberId: referrerId,
      referralBoundAt: new Date(),
      referralSource: 'oauth_first_bind',
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, userId), isNull(users.referredByMemberId)))
    .returning({ id: users.id });

  return updated.length === 1;
}

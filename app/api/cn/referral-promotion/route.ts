import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { promotionQualificationAudit, users } from '@/lib/schema';
import {
  findLocalCnUserById,
  grantLocalCnPromotionQualification,
  localCnPromotionQualification,
  PROMOTION_QUALIFICATION_POLICY_VERSION,
} from '@/lib/local-cn-users';
import { ensureLocalCnReferralLink } from '@/lib/local-cn-referral-attribution';
import { getMemberWorkspace } from '@/lib/local-cn-member-workspace';

export const dynamic = 'force-dynamic';

function auditId(memberId: number) {
  return `PQA-${Date.now()}-${memberId}-${randomBytes(4).toString('base64url')}`;
}

function dbQualification(row: typeof users.$inferSelect | null | undefined) {
  if (!row) return { status: 'not_found' as const, canApply: false, reason: 'member_not_found' };
  if (row.promotionQualificationStatus === 'disabled') {
    return {
      status: 'disabled' as const,
      canApply: false,
      reason: row.promotionDisabledReason || 'promotion_disabled',
      appliedAt: row.promotionAppliedAt?.toISOString() || null,
      approvedAt: row.promotionApprovedAt?.toISOString() || null,
      policyVersion: row.promotionPolicyVersion || null,
    };
  }
  if (row.promotionQualificationStatus === 'granted') {
    return {
      status: 'granted' as const,
      canApply: false,
      reason: '',
      appliedAt: row.promotionAppliedAt?.toISOString() || null,
      approvedAt: row.promotionApprovedAt?.toISOString() || null,
      policyVersion: row.promotionPolicyVersion || PROMOTION_QUALIFICATION_POLICY_VERSION,
    };
  }
  return {
    status: 'not_applied' as const,
    canApply: true,
    reason: '',
    appliedAt: row.promotionAppliedAt?.toISOString() || null,
    approvedAt: row.promotionApprovedAt?.toISOString() || null,
    policyVersion: row.promotionPolicyVersion || null,
  };
}

export async function GET(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (user.role !== 'member') return NextResponse.json({ error: '仅会员可申请推广资格' }, { status: 403 });

  if (!process.env.DATABASE_URL && user.region === 'CN') {
    const localUser = findLocalCnUserById(user.id);
    const qualification = localCnPromotionQualification(localUser);
    const referralLink = qualification.status === 'granted' ? ensureLocalCnReferralLink(user.id) : null;
    return NextResponse.json({
      qualification,
      referralPath: referralLink?.path || '',
      workspace: getMemberWorkspace(user),
    });
  }

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  return NextResponse.json({ qualification: dbQualification(rows[0]), referralPath: '' });
}

export async function POST(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (user.role !== 'member') return NextResponse.json({ error: '仅会员可申请推广资格' }, { status: 403 });

  if (!process.env.DATABASE_URL && user.region === 'CN') {
    const result = grantLocalCnPromotionQualification(user.id, { actorId: user.id, source: 'self_apply_auto' });
    if (!result.ok) {
      return NextResponse.json({ error: '推广资格未开放', reason: result.reason, qualification: result.qualification }, { status: 403 });
    }
    const referralLink = ensureLocalCnReferralLink(user.id);
    return NextResponse.json({
      qualification: result.qualification,
      referralPath: referralLink?.path || '',
      idempotent: result.idempotent === true,
      workspace: getMemberWorkspace(user),
    }, { status: result.idempotent ? 200 : 201 });
  }

  const rows = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const row = rows[0];
  const current = dbQualification(row);
  const now = new Date();
  if (!row) return NextResponse.json({ error: '找不到会员' }, { status: 404 });
  if (current.status === 'disabled') {
    await db.insert(promotionQualificationAudit).values({
      auditId: auditId(user.id),
      memberId: user.id,
      actorId: user.id,
      action: 'grant_rejected',
      result: 'rejected',
      reason: current.reason || 'disabled',
      policyVersion: PROMOTION_QUALIFICATION_POLICY_VERSION,
      createdAt: now,
    });
    return NextResponse.json({ error: '推广资格未开放', reason: current.reason, qualification: current }, { status: 403 });
  }
  if (current.status === 'granted') {
    await db.insert(promotionQualificationAudit).values({
      auditId: auditId(user.id),
      memberId: user.id,
      actorId: user.id,
      action: 'grant_idempotent',
      result: 'ignored_existing',
      reason: 'already_granted',
      policyVersion: current.policyVersion || PROMOTION_QUALIFICATION_POLICY_VERSION,
      createdAt: now,
    });
    return NextResponse.json({ qualification: current, referralPath: '', idempotent: true });
  }

  const [updated] = await db.update(users)
    .set({
      promotionQualificationStatus: 'granted',
      promotionAppliedAt: row.promotionAppliedAt || now,
      promotionApprovedAt: row.promotionApprovedAt || now,
      promotionPolicyVersion: PROMOTION_QUALIFICATION_POLICY_VERSION,
      updatedAt: now,
    })
    .where(eq(users.id, user.id))
    .returning();

  await db.insert(promotionQualificationAudit).values({
    auditId: auditId(user.id),
    memberId: user.id,
    actorId: user.id,
    action: 'grant',
    result: 'granted',
    reason: 'self_apply_auto',
    policyVersion: PROMOTION_QUALIFICATION_POLICY_VERSION,
    appliedAt: updated.promotionAppliedAt,
    approvedAt: updated.promotionApprovedAt,
    createdAt: now,
  });

  return NextResponse.json({ qualification: dbQualification(updated), referralPath: '', idempotent: false }, { status: 201 });
}

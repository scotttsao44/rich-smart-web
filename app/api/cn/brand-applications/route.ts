import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { listApprovedBrands, listBrandApplications, listBrandMarketplaceAudits, reviewBrandApplication, submitBrandApplication } from '@/lib/local-cn-brand-marketplace';
import { getLocalBrandPilotIdentity } from '@/lib/local-cn-brand-demo-access';
import { createPartnership, listPartnerships } from '@/lib/local-cn-commerce';
import { CAOMI_TEST_ACCOUNT_USER_ID } from '@/lib/local-cn-users';
import { isCnTestAccountEnabled, resetLocalCnTestAccountData } from '@/lib/local-cn-test-account';
import {
  brandPilotDbEnabled,
  listDbApprovedBrands,
  listDbBrandApplications,
  getDbBrandPilotIdentity,
  reviewDbBrandApplication,
  submitDbBrandApplication,
} from '@/lib/brand-pilot-db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    if (brandPilotDbEnabled()) {
      const scope = request.nextUrl.searchParams.get('scope') === 'self' ? 'self' : 'all';
      return NextResponse.json({
        applications: await listDbBrandApplications(user, scope),
        brands: await listDbApprovedBrands(),
        audits: [],
        pilotIdentity: await getDbBrandPilotIdentity(user.id),
      });
    }
    const allApplications = listBrandApplications(user);
    const applications = request.nextUrl.searchParams.get('scope') === 'self'
      ? allApplications.filter((application) => application.applicantUserId === user.id || application.accountUserId === user.id)
      : allApplications;
    return NextResponse.json({
      applications,
      brands: listApprovedBrands(),
      audits: hasPlatformAdminAccess(user) ? listBrandMarketplaceAudits(user) : [],
      pilotIdentity: getLocalBrandPilotIdentity(user.id),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '读取失败' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    if (brandPilotDbEnabled()) {
      return NextResponse.json({ application: await submitDbBrandApplication(user, await request.json()) }, { status: 201 });
    }
    // 忽略客户端 autoApprove：仅平台管理员（伺服器端检查）可直接核准，其他账号一律待平台审核
    const { autoApprove: _clientAutoApprove, ...input } = ((await request.json().catch(() => ({}))) || {}) as Record<string, unknown>;
    return NextResponse.json({ application: submitBrandApplication(user, { ...input, autoApprove: hasPlatformAdminAccess(user) }) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '提交失败';
    return NextResponse.json({ error: message }, { status: message.includes('重复') || message.includes('已经') ? 409 : 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const body = await request.json();
    const action = String(body.action || '');
    if (action === 'reset_test_flow') {
      if (!isCnTestAccountEnabled()) return NextResponse.json({ error: '测试流程重置仅在本机测试环境开放' }, { status: 404 });
      if (user.id !== CAOMI_TEST_ACCOUNT_USER_ID && !hasPlatformAdminAccess(user)) return NextResponse.json({ error: '仅可重置测试帐号本人或平台管理员可以执行重置' }, { status: 403 });
      const reset = resetLocalCnTestAccountData();
      return NextResponse.json({ reset: reset.removed });
    }
    const decision = String(body.decision || '') as 'approved' | 'rejected';
    if (!['approved', 'rejected'].includes(decision)) throw new Error('审核动作不正确');
    if (brandPilotDbEnabled()) {
      const application = await reviewDbBrandApplication(user, Number(body.id), decision, String(body.reviewNote || ''));
      return NextResponse.json({ application });
    }
    const application = reviewBrandApplication(user, Number(body.id), decision, String(body.reviewNote || ''), body.referrerRewardRate == null ? undefined : Number(body.referrerRewardRate));
    if (decision === 'approved' && application.referrerBrandId && application.referrerBrandName) {
      const exists = listPartnerships().some((row) => row.referrerBrandId === application.referrerBrandId && row.ownerBrandId === application.id);
      if (!exists) {
        const now = new Date().toISOString();
        createPartnership({
          referrerBrandId: application.referrerBrandId,
          referrerBrandName: application.referrerBrandName,
          ownerBrandId: application.id,
          ownerBrandName: application.brandName,
          status: 'pending',
          terms: '品牌申请推荐关系：推荐分润按商品毛利计算；商品原品牌负责商品资料、库存、发货及售后。',
          rewardType: 'rate',
          rewardRate: Number(application.referrerRewardRate || 0),
          rewardFixedAmount: 0,
          startsAt: now,
          endsAt: null,
          referrerAcceptedAt: null,
          ownerAcceptedAt: now,
          platformReviewedAt: now,
        }, user.id);
      }
    }
    return NextResponse.json({ application });
  } catch (error) {
    const message = error instanceof Error ? error.message : '审核失败';
    return NextResponse.json({ error: message }, { status: message.includes('仅平台') ? 403 : 400 });
  }
}

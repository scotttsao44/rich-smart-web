import { NextRequest, NextResponse } from 'next/server';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { addWorkspaceItem, getWorkspace, isWorkspaceRole, updateWorkspace } from '@/lib/local-cn-workspaces';
import { getMemberWorkspace } from '@/lib/local-cn-member-workspace';
import { getReferralEngagement, touchMemberActivity, type ReferralRange } from '@/lib/local-cn-referral-engagement';
import { findLocalCnUserById } from '@/lib/local-cn-users';
import { getApprovedBrandForUser } from '@/lib/local-cn-brand-marketplace';
import { listStoreApplications } from '@/lib/local-cn-store-applications';
import { getOrganizationRole } from '@/lib/local-cn-organization-members';
import { getCnPaymentSettings } from '@/lib/cn-payment-settings';
import { notifyCustomerBookingSuccess } from '@/lib/wechat-booking-notify';

export const dynamic = 'force-dynamic';

const allowed: Record<string, string[]> = {
  vendor: ['brand'],
  store: ['store'],
  agent: ['agent'],
  member: ['member'],
  admin: ['brand', 'store', 'agent', 'member', 'admin'],
};

function canAccessWorkspace(user: NonNullable<ReturnType<typeof getRequestSession>>, role: string) {
  if (hasPlatformAdminAccess(user)) return true;
  if (allowed[user.role]?.includes(role)) return true;
  if (role === 'brand') return Boolean(getApprovedBrandForUser(user.id));
  if (role === 'store') return listStoreApplications(user).some((application) => application.status === 'active');
  return false;
}

function validationError(role: string, collection: string, updates: Record<string, unknown>) {
  if (role !== 'brand' || collection !== 'settlementRules') return '';
  const numericKeys = ['salePrice', 'brandSettlement', 'platformFeeRate', 'paymentFeeRate', 'riskReserveRate', 'otherCost', 'directRate', 'upperRate', 'activeRate'];
  if (numericKeys.some((key) => !Number.isFinite(Number(updates[key])) || Number(updates[key]) < 0)) return '金额与比例不可为负数';
  const splitTotal = Number(updates.directRate) + Number(updates.upperRate) + Number(updates.activeRate);
  if (Math.abs(splitTotal - 100) > 0.001) return '三段分润比例合计必须等于 100%';
  const salePrice = Number(updates.salePrice);
  const fixedCosts = Number(updates.brandSettlement) + Number(updates.otherCost);
  const variableCosts = salePrice * (Number(updates.platformFeeRate) + Number(updates.paymentFeeRate) + Number(updates.riskReserveRate)) / 100;
  if (salePrice - fixedCosts - variableCosts < 0) return '成本与费用不可超过商品售价';
  return '';
}

function brandWorkspaceWithPlatformFees() {
  const workspace = getWorkspace('brand');
  const settings = getCnPaymentSettings();
  return {
    ...workspace,
    settlementRules: (workspace.settlementRules || []).map((rule: Record<string, unknown>) => ({
      ...rule,
      platformFeeRate: settings.platformFeeRate,
      paymentFeeRate: settings.paymentChannelFeeRate,
      riskReserveRate: settings.riskReserveRate,
    })),
  };
}

function referralRange(value: string | null): ReferralRange {
  return value === '7d' || value === '90d' || value === 'month' ? value : '30d';
}

export async function GET(request: NextRequest, { params }: { params: { role: string } }) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!isWorkspaceRole(params.role) || !canAccessWorkspace(user, params.role)) return NextResponse.json({ error: '无权查看此工作台' }, { status: 403 });
  if (params.role !== 'member') {
    return NextResponse.json(params.role === 'brand' ? brandWorkspaceWithPlatformFees() : getWorkspace(params.role));
  }

  const requestedId = Number(request.nextUrl.searchParams.get('userId') || 0);
  if (hasPlatformAdminAccess(user) && requestedId) {
    const target = findLocalCnUserById(requestedId);
    if (!target) return NextResponse.json({ error: '找不到会员' }, { status: 404 });
    const targetUser = { id: target.id, name: target.name, email: target.email, agentLevel: target.agentLevel, role: target.role, region: 'CN', referralCode: target.referralCode, platformAdmin: target.platformAdmin === true, referralSharingEnabled: target.referralSharingEnabled !== false };
    return NextResponse.json({ ...getMemberWorkspace(targetUser), referralEngagement: getReferralEngagement(targetUser, referralRange(request.nextUrl.searchParams.get('range'))) });
  }
  touchMemberActivity(user);
  return NextResponse.json({ ...getMemberWorkspace(user), referralEngagement: getReferralEngagement(user, referralRange(request.nextUrl.searchParams.get('range'))) });
}

export async function PATCH(request: NextRequest, { params }: { params: { role: string } }) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!isWorkspaceRole(params.role) || !canAccessWorkspace(user, params.role)) return NextResponse.json({ error: '无权操作此工作台' }, { status: 403 });
  const body = await request.json();
  if (params.role === 'brand' && !hasPlatformAdminAccess(user)) {
    const brand = getApprovedBrandForUser(user.id);
    if (!brand) return NextResponse.json({ error: '品牌审核通过后才能修改品牌工作台' }, { status: 403 });
    const isOwner = brand && (brand.accountUserId === user.id || brand.applicantUserId === user.id);
    if (!isOwner && !['admin', 'finance'].includes(getOrganizationRole('brand', brand!.id, user.id) || '')) return NextResponse.json({ error: '当前职位无权修改分润规则' }, { status: 403 });
  }
  const collection = String(body.collection || '');
  const updates: Record<string, unknown> = body.updates && typeof body.updates === 'object' ? { ...body.updates } : {};
  if (params.role === 'brand' && collection === 'settlementRules') {
    const settings = getCnPaymentSettings();
    updates.platformFeeRate = settings.platformFeeRate;
    updates.paymentFeeRate = settings.paymentChannelFeeRate;
    updates.riskReserveRate = settings.riskReserveRate;
  }
  const error = validationError(params.role, collection, updates);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const updated = updateWorkspace(params.role, collection, String(body.id || ''), updates);
  if (updated && params.role === 'store' && collection === 'appointments' && updates.status === '已预约') void notifyCustomerBookingSuccess(user, updated as Record<string, unknown>);
  return updated ? NextResponse.json({ updated }) : NextResponse.json({ error: '找不到记录' }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: { params: { role: string } }) {
  const user = getRequestSession(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!isWorkspaceRole(params.role) || !canAccessWorkspace(user, params.role)) return NextResponse.json({ error: '无权操作此工作台' }, { status: 403 });
  const body = await request.json();
  const collection = String(body.collection || '');
  if (!collection || !body.item || typeof body.item !== 'object') return NextResponse.json({ error: '资料不完整' }, { status: 400 });
  const created = addWorkspaceItem(params.role, collection, body.item);
  if (params.role === 'store' && collection === 'appointments') void notifyCustomerBookingSuccess(user, (created || body.item) as Record<string, unknown>);
  return NextResponse.json({ created }, { status: 201 });
}

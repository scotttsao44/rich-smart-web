import { NextRequest, NextResponse } from 'next/server';
import { getFreshSessionUser, hasPlatformAdminAccess } from '@/lib/auth';
import { listBrandApplications, listBrandProducts } from '@/lib/local-cn-brand-marketplace';
import { listLocalBrandMembers } from '@/lib/local-cn-brand-members';
import { buildWechatReconciliationSummary, commerceSnapshot, listFinanceRecords, listLocalCnOrders } from '@/lib/local-cn-commerce';
import { listStoreApplications } from '@/lib/local-cn-store-applications';
import { listAllStorePrepayOrderViews } from '@/lib/cn-store-prepay';
import { CAOMI_ADMIN_TEST_ACCOUNT_USER_ID, CAOMI_SCOOT_ADMIN_USER_ID, CAOMI_TEST_ACCOUNT_USER_ID, listLocalCnUsers, setLocalCnPlatformAdmin } from '@/lib/local-cn-users';
import { BRAND_APPLICATION_DOCUMENT_LABELS, normalizeBrandApplicationDocuments } from '@/lib/brand-application-documents';
import { displayBrandCategory } from '@/lib/cn-brand-taxonomy';

export const dynamic = 'force-dynamic';

async function platformUser(request: NextRequest) {
  const user = await getFreshSessionUser(request);
  return hasPlatformAdminAccess(user) ? user : null;
}

function safeMembers() {
  const hidden = new Set([CAOMI_TEST_ACCOUNT_USER_ID, CAOMI_ADMIN_TEST_ACCOUNT_USER_ID, CAOMI_SCOOT_ADMIN_USER_ID]);
  const all = listLocalCnUsers();
  const byId = new Map(all.map((user) => [user.id, user]));
  return all.filter((user) => !hidden.has(user.id)).map((user) => {
    const referrer = user.referredByMemberId ? byId.get(Number(user.referredByMemberId)) : null;
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      referralCode: user.referralCode,
      referrerCode: user.referrerCode,
      referredByMemberId: user.referredByMemberId || null,
      referralSource: user.referralSource || null,
      referrerName: referrer?.name || null,
      wechatBound: Boolean(user.wechatMiniOpenId || user.wechatId),
      platformAdmin: user.platformAdmin === true,
      createdAt: user.createdAt,
    };
  });
}

function number(value: unknown) {
  const resolved = Number(value || 0);
  return Number.isFinite(resolved) ? resolved : 0;
}

function money(value: number) {
  return Number((value + Number.EPSILON).toFixed(2));
}

function fen(value: unknown) {
  return money(number(value) / 100);
}

function itemAmount(item: any) {
  const subtotal = number(item.subtotal);
  return subtotal || number(item.unitPrice) * Math.max(1, number(item.quantity));
}

function itemBrandId(item: any) {
  return number(item.ownerBrandId || item.brandId);
}

function pendingShipment(order: any) {
  if (order.paymentStatus !== 'paid') return false;
  if (order.trackingNumber) return false;
  return !['shipped', 'delivered', 'completed', 'refunded', 'cancelled'].includes(String(order.status || ''));
}

function periodRange(period: string, now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split('-').map(Number);
    return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
  }
  if (period === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  } else if (period === 'month') {
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);
  if (period === 'today') {
    end.setHours(24, 0, 0, 0);
  } else if (period === 'week') {
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 7);
  } else if (period === 'month') {
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 1);
    end.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

function inPeriod(order: any, period: string) {
  if (!period || period === 'all') return true;
  const { start, end } = periodRange(period);
  const time = new Date(order.paidAt || order.createdAt || 0).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time < end.getTime();
}

function documentRows(brand: any) {
  const listed = normalizeBrandApplicationDocuments(brand.brandDocuments);
  if (listed.length) return listed.map((document) => ({ label: BRAND_APPLICATION_DOCUMENT_LABELS[document.kind], token: document.token, filename: document.name }));
  return [
    { label: '营业执照 / 公司设立文件', token: brand.businessLicenseDocument || '', filename: brand.businessLicenseName || '' },
    { label: '公司资料', token: brand.profileDocument || '', filename: brand.profileDocumentName || '' },
    { label: '商标资料', token: brand.trademarkDocument || '', filename: brand.trademarkName || '' },
  ];
}

function buildBrandPerformance(brands: any[], products: any[], orders: any[], members: any[]) {
  const userById = new Map(members.map((member) => [number(member.id), member]));
  return brands.map((brand) => {
    const brandId = number(brand.id);
    const applicant = userById.get(number(brand.applicantUserId)) || null;
    const account = userById.get(number(brand.accountUserId)) || null;
    const brandProducts = products.filter((product) => number(product.brandId) === brandId);
    const brandOrders = orders.filter((order) => (order.items || []).some((item: any) => itemBrandId(item) === brandId));
    const brandPaidOrders = brandOrders.filter((order) => order.paymentStatus === 'paid');
    const brandMembers = brand.status === 'approved' ? listLocalBrandMembers(brandId) : [];
    const buyers = new Map<number, { userId: number; name: string; orderCount: number; paidOrderCount: number; totalSpent: number }>();
    let salesAmount = 0;
    let platformRevenue = 0;
    brandPaidOrders.forEach((order) => (order.items || []).forEach((item: any) => {
      if (itemBrandId(item) !== brandId) return;
      const quantity = Math.max(1, number(item.quantity));
      const snapshot = item.settlementSnapshot || {};
      const amount = itemAmount(item);
      salesAmount += amount;
      platformRevenue += number(snapshot.platformFee) * quantity;
      if (order.userId) {
        const buyer = buyers.get(order.userId) || { userId: order.userId, name: userById.get(order.userId)?.name || order.shippingName || `会员 ${order.userId}`, orderCount: 0, paidOrderCount: 0, totalSpent: 0 };
        buyer.totalSpent += amount;
        buyers.set(order.userId, buyer);
      }
    }));
    brandOrders.forEach((order) => {
      if (!order.userId) return;
      const buyer = buyers.get(order.userId) || { userId: order.userId, name: userById.get(order.userId)?.name || order.shippingName || `会员 ${order.userId}`, orderCount: 0, paidOrderCount: 0, totalSpent: 0 };
      buyer.orderCount += 1;
      if (order.paymentStatus === 'paid') buyer.paidOrderCount += 1;
      buyers.set(order.userId, buyer);
    });
    return {
      brandId,
      brandName: brand.brandName,
      companyName: brand.companyName,
      applicant: applicant ? { id: applicant.id, name: applicant.name, phone: applicant.phone, email: applicant.email } : null,
      account: account ? { id: account.id, name: account.name, phone: account.phone, email: account.email } : null,
      application: {
        category: displayBrandCategory(brand),
        categoryMajorId: brand.categoryMajorId || '',
        categoryMinorId: brand.categoryMinorId || '',
        categoryLabel: brand.categoryLabel || '',
        registrationNo: brand.registrationNo || '',
        contactName: brand.contactName || '',
        phone: brand.phone || '',
        wechat: brand.wechat || '',
        officialWebsite: brand.officialWebsite || '',
        socialLink: brand.socialLink || '',
        introduction: brand.introduction || '',
        submittedAt: brand.submittedAt,
        reviewedAt: brand.reviewedAt,
        reviewNote: brand.reviewNote || '',
        documents: documentRows(brand),
      },
      status: brand.status,
      productCount: brandProducts.filter((product) => product.status === 'approved').length,
      allProductCount: brandProducts.length,
      memberCount: brandMembers.length,
      orderCount: brandOrders.length,
      paidOrderCount: brandPaidOrders.length,
      pendingShipmentCount: brandPaidOrders.filter(pendingShipment).length,
      refundCount: brandOrders.filter((order) => ['refunded', 'partially_refunded'].includes(String(order.paymentStatus))).length,
      salesAmount: money(salesAmount),
      platformRevenue: money(platformRevenue),
      products: brandProducts.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        status: product.status,
        salesStatus: product.salesStatus || (product.isActive ? 'active' : 'draft'),
        priceCny: product.priceCny,
        stockQuantity: product.stockQuantity,
        submittedAt: product.submittedAt,
      })),
      orders: brandOrders.map((order) => ({
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        trackingNumber: order.trackingNumber,
        buyerName: order.userId ? userById.get(order.userId)?.name || order.shippingName : order.shippingName,
      })),
      brandMembers,
      buyers: Array.from(buyers.values()).map((buyer) => ({ ...buyer, totalSpent: money(buyer.totalSpent) })),
    };
  });
}

function buildStorePerformance(stores: any[]) {
  return stores.map((store) => {
    const transactions = store.transactions || [];
    const equipmentRevenue = transactions.reduce((total: number, transaction: any) => {
      return total + shareAmount(transaction, ['设备']);
    }, 0);
    return {
      storeId: store.id,
      storeName: store.name,
      status: store.status,
      applicationStatus: store.status,
      equipmentStatus: store.equipmentNo ? 'configured' : store.status === 'pending_equipment' ? 'pending_equipment' : 'not_configured',
      operationStatus: store.status === 'active' ? 'active' : 'not_active',
      equipmentNo: store.equipmentNo,
      participantCount: (store.participants || []).length,
      transactionCount: transactions.length,
      serviceRevenue: money(transactions.reduce((total: number, transaction: any) => total + number(transaction.amount), 0)),
      equipmentRevenue: money(equipmentRevenue),
      settlementStatus: transactions.length ? 'pending_settlement' : 'none',
    };
  });
}

function shareAmount(transaction: any, keywords: string[]) {
  return (transaction.shares || []).reduce((sum: number, share: any) => {
    const role = String(share.role || '');
    return keywords.some((keyword) => role.includes(keyword)) ? sum + number(share.amount) : sum;
  }, 0);
}

function buildRevenueSummary(orders: any[], stores: any[], commerceState: ReturnType<typeof commerceSnapshot>) {
  const commerce = {
    grossRevenue: 0,
    salesAmount: 0,
    totalRevenue: 0,
    platformIncome: 0,
    platformRevenue: 0,
    platformFee: 0,
    paymentChannelFee: 0,
    paymentFee: 0,
    riskReserve: 0,
    brandSettlement: 0,
    directReferral: 0,
    upperReferral: 0,
    activeRank: 0,
    brandReferral: 0,
    settlementStatus: 'none',
  };
  let itemBrandReferral = 0;
  orders.filter((order) => order.paymentStatus === 'paid').forEach((order) => {
    commerce.salesAmount += number(order.totalAmount);
    const hasPaymentSnapshot = Boolean(order.paymentSnapshot);
    if (hasPaymentSnapshot) {
      commerce.platformFee += fen(order.paymentSnapshot.platformFeeFen);
      commerce.paymentChannelFee += fen(order.paymentSnapshot.paymentChannelFeeFen);
      commerce.riskReserve += fen(order.paymentSnapshot.riskReserveFen);
    }
    (order.items || []).forEach((item: any) => {
      const quantity = Math.max(1, number(item.quantity));
      const snapshot = item.settlementSnapshot || {};
      commerce.brandSettlement += number(snapshot.brandSettlement) * quantity;
      if (!hasPaymentSnapshot) {
        commerce.platformFee += number(snapshot.platformFee) * quantity;
        commerce.paymentChannelFee += number(snapshot.paymentFee) * quantity;
        commerce.riskReserve += number(snapshot.riskReserve) * quantity;
      }
      itemBrandReferral += number(item.referralAmount);
    });
  });
  commerce.paymentFee = commerce.paymentChannelFee;
  let walletBrandReferral = 0;
  (commerceState.walletEntries || []).forEach((entry) => {
    const amount = number(entry.amount);
    if (entry.sourceType === 'referral' && number(entry.ruleSnapshot?.referralLevel) === 1) commerce.directReferral += amount;
    else if (entry.sourceType === 'referral' && number(entry.ruleSnapshot?.referralLevel) === 2) commerce.upperReferral += amount;
    else if (entry.sourceType === 'active_rank') commerce.activeRank += amount;
    else if (entry.sourceType === 'brand_referral') walletBrandReferral += amount;
  });
  commerce.brandReferral = walletBrandReferral || itemBrandReferral;
  commerce.grossRevenue = commerce.salesAmount;
  commerce.totalRevenue = commerce.salesAmount;
  commerce.platformIncome = commerce.platformFee;
  commerce.platformRevenue = commerce.platformFee;
  commerce.settlementStatus = commerce.salesAmount > 0 ? 'pending_settlement' : 'none';

  const device = {
    serviceRevenue: 0,
    totalRevenue: 0,
    platformIncome: 0,
    platformRevenue: 0,
    equipmentShare: 0,
    equipmentProvider: 0,
    venueShare: 0,
    venueProvider: 0,
    salesShare: 0,
    salesProvider: 0,
    promoterShare: 0,
    promoterProvider: 0,
    channelShare: 0,
    channelPartner: 0,
    settlementStatus: 'none',
  };
  stores.forEach((store) => (store.transactions || []).forEach((transaction: any) => {
    device.serviceRevenue += number(transaction.amount);
    device.equipmentShare += shareAmount(transaction, ['设备']);
    device.venueShare += shareAmount(transaction, ['场地', '门店负责人', '门店合伙人']);
    device.salesShare += shareAmount(transaction, ['销售']);
    device.promoterShare += shareAmount(transaction, ['业务', '推广']);
    device.channelShare += shareAmount(transaction, ['渠道', '区域']);
  }));
  device.totalRevenue = device.serviceRevenue;
  device.platformIncome = device.equipmentShare;
  device.platformRevenue = device.equipmentShare;
  device.equipmentProvider = device.equipmentShare;
  device.venueProvider = device.venueShare;
  device.salesProvider = device.salesShare;
  device.promoterProvider = device.promoterShare;
  device.channelPartner = device.channelShare;
  device.settlementStatus = device.serviceRevenue > 0 ? 'pending_settlement' : 'none';

  const roundObject = (source: Record<string, unknown>) => Object.fromEntries(Object.entries(source).map(([key, value]) => [
    key,
    typeof value === 'number' ? money(value) : value,
  ]));
  return { commerce: roundObject(commerce), device: roundObject(device) };
}

export async function GET(request: NextRequest) {
  const user = await platformUser(request);
  if (!user) return NextResponse.json({ error: '仅平台管理员可查看平台数据' }, { status: 403 });

  const members = safeMembers();
  const brands = listBrandApplications(user);
  const products = listBrandProducts(user, 'review');
  const stores = listStoreApplications(user);
  const period = request.nextUrl.searchParams.get('period') || 'today';
  const allOrders = listLocalCnOrders();
  const orders = allOrders.filter((order) => inPeriod(order, period));
  const reconciliation = buildWechatReconciliationSummary(allOrders);
  const finance = listFinanceRecords();
  const commerce = commerceSnapshot();
  const paidOrders = orders.filter((order) => order.paymentStatus === 'paid');
  const brandPerformance = buildBrandPerformance(brands, products, orders, members);
  const storePerformance = buildStorePerformance(stores);
  const revenueSummary = buildRevenueSummary(orders, stores, commerce);
  // 门店预购次数（次卡）：与商城订单并列；T 档付款测试另计，不计入正式营收
  const storePrepayAll = listAllStorePrepayOrderViews();
  const storePrepayOrders = storePrepayAll.filter((row) => inPeriod(row, period));
  const prepayPaid = storePrepayOrders.filter((row) => row.status === 'paid');
  const prepayFormal = prepayPaid.filter((row) => !row.isTest);
  const prepayTest = prepayPaid.filter((row) => row.isTest);
  const prepayRevenue = money(prepayFormal.reduce((sum, row) => sum + number(row.amountYuan), 0));
  const prepayTestRevenue = money(prepayTest.reduce((sum, row) => sum + number(row.amountYuan), 0));
  const gmv = Number(paidOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0).toFixed(2));
  const revenueWithPrepay = {
    ...revenueSummary,
    storePrepay: { paidOrders: prepayFormal.length, revenue: prepayRevenue, testPaidOrders: prepayTest.length, testRevenue: prepayTestRevenue },
  };

  return NextResponse.json({
    viewer: { id: user.id, name: user.name },
    period,
    summary: {
      members: members.length,
      platformAdmins: members.filter((member) => member.platformAdmin).length,
      brands: brands.filter((brand) => brand.status === 'approved').length,
      pendingBrands: brands.filter((brand) => brand.status === 'pending').length,
      products: products.filter((product) => (
        product.status === 'approved'
        && product.isActive !== false
        && product.salesStatus !== 'archived'
        && Number(product.stockQuantity ?? 0) > 0
      )).length,
      pendingProducts: products.filter((product) => product.status === 'pending').length,
      stores: stores.filter((store) => store.status === 'active').length,
      pendingStores: stores.filter((store) => store.status !== 'active' && store.status !== 'rejected').length,
      orders: orders.length,
      paidOrders: paidOrders.length,
      gmv,
      prepayOrders: storePrepayOrders.length,
      prepayPaidOrders: prepayFormal.length,
      prepayRevenue,
      prepayTestPaidOrders: prepayTest.length,
      prepayTestRevenue,
      gmvTotal: money(gmv + prepayRevenue),
      walletEntries: commerce.walletEntries.length,
      withdrawals: commerce.withdrawals.length,
    },
    members,
    brands,
    products,
    stores,
    orders,
    allOrders,
    reconciliation,
    finance,
    brandPerformance,
    storePerformance,
    revenueSummary: revenueWithPrepay,
    storePrepayOrders,
  });
}

export async function PATCH(request: NextRequest) {
  const actor = await platformUser(request);
  if (!actor) return NextResponse.json({ error: '仅平台管理员可调整平台权限' }, { status: 403 });
  try {
    const body = await request.json();
    if (body.action !== 'set_platform_admin') return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
    const targetUserId = Number(body.userId);
    const enabled = body.enabled === true;
    const members = safeMembers();
    if (!enabled && targetUserId === actor.id) {
      return NextResponse.json({ error: '不能在当前登录状态下取消自己的平台权限' }, { status: 400 });
    }
    if (!enabled && members.filter((member) => member.platformAdmin).length <= 1) {
      return NextResponse.json({ error: '平台至少需要保留一位管理员' }, { status: 400 });
    }
    const user = setLocalCnPlatformAdmin(targetUserId, enabled);
    return NextResponse.json({
      member: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        platformAdmin: user.platformAdmin === true,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '权限调整失败' }, { status: 400 });
  }
}

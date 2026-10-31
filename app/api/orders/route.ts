import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { commissions, orders, orderItems, products, users } from '@/lib/schema';
import { getCnyPrice } from '@/lib/cn-market';
import { and, eq, sql } from 'drizzle-orm';
import { createLocalCnOrder, listLocalCnOrders } from '@/lib/local-cn-commerce';
import { getRequestSession, hasPlatformAdminAccess } from '@/lib/auth';
import { getChinaPaymentProvider, isBrandPilotPaymentContext, normalizePaymentProvider, paymentCapabilities } from '@/lib/cn-payments';
import { normalizeContactPhone } from '@/lib/international-phone';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Cart items are required' },
        { status: 400 }
      );
    }

    const {
      userId,
      currency: requestedCurrency,
      marketRegion: requestedMarketRegion,
      paymentMethod,
      shippingName,
      shippingPhone,
      shippingAddress,
      shippingCity,
      shippingZip,
      sourceChannel,
    } = body;
    const currency = requestedCurrency === 'CNY' ? 'CNY' : 'TWD';
    const marketRegion = requestedMarketRegion === 'CN' ? 'CN' : 'TW';
    const session = getRequestSession(request);
    const numericUserId = marketRegion === 'CN' && session ? session.id : (userId ? Number(userId) : 0);

    if (marketRegion === 'CN') {
      if (!session) return NextResponse.json({ error: '请先登录后结账' }, { status: 401 });
      let contactPhone = '';
      try { contactPhone = normalizeContactPhone(shippingPhone); } catch {}
      if (!shippingName?.trim() || !contactPhone || !shippingCity?.trim() || !shippingAddress?.trim()) return NextResponse.json({ error: '请完整填写有效的收货信息' }, { status: 400 });
      body.shippingPhone = contactPhone;
      const pilotPaymentDisabled = await isBrandPilotPaymentContext({ user: session, orderUserId: numericUserId });
      const requestedPaymentMethod = normalizePaymentProvider(String(paymentMethod || 'bank_transfer'));
      const normalizedPaymentMethod = pilotPaymentDisabled && requestedPaymentMethod === 'bank_transfer' ? 'wechat_pay' : requestedPaymentMethod;
      const provider = pilotPaymentDisabled
        ? paymentCapabilities({ forceDisabled: true })[normalizedPaymentMethod]
        : getChinaPaymentProvider(normalizedPaymentMethod);
      if (pilotPaymentDisabled && body.simulate !== true) {
        return NextResponse.json({
          error: '品牌 Pilot 测试期间不能建立正式付款订单，请明确使用模拟流程。',
          paymentDisabled: true,
          provider,
        }, { status: 503 });
      }
      if (!provider || (!pilotPaymentDisabled && !provider.enabled)) return NextResponse.json({ error: '不支持的付款方式' }, { status: 400 });
      if (sourceChannel === 'wechat_mini' && normalizedPaymentMethod === 'alipay') {
        return NextResponse.json({ error: '微信小程序内不提供支付宝，请选择微信支付' }, { status: 400 });
      }
      body.paymentMethod = normalizedPaymentMethod;
      if (pilotPaymentDisabled) body.paymentDisabled = true;
    }

    if (!process.env.DATABASE_URL && marketRegion === 'CN') {
      const order = createLocalCnOrder({ ...body, userId: numericUserId });
      const pilotPaymentDisabled = await isBrandPilotPaymentContext({ user: session, orderUserId: numericUserId });
      const provider = pilotPaymentDisabled
        ? paymentCapabilities({ forceDisabled: true })[normalizePaymentProvider(order.paymentMethod)]
        : getChinaPaymentProvider(order.paymentMethod);
      return NextResponse.json({ orderId: order.id, order, payment: provider });
    }

    let totalAmount = 0;
    const enrichedItems = [];
    const buyer = numericUserId
      ? (
        await db
        .select({ referrerId: users.referrerId, referredByMemberId: users.referredByMemberId })
          .from(users)
          .where(eq(users.id, numericUserId))
          .limit(1)
      )[0]
      : null;

    for (const item of items) {
      const productResult = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);

      const product = productResult[0];
      if (!product) {
        return NextResponse.json(
          { error: `Product ${item.productId} not found` },
          { status: 400 }
        );
      }

      const productPrice =
        currency === 'CNY'
          ? getCnyPrice(product)
          : Number(product.priceTwd || 0);
      const unitPrice = Number(item.unitPrice || productPrice);
      const itemTotal = unitPrice * item.quantity;
      totalAmount += itemTotal;

      enrichedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: unitPrice.toString(),
        productName: product.name,
        commissionRate: Number(product.commissionRate || 0),
      });
    }

    const orderNo = `RS${Date.now()}`;
    const [order] = await db
      .insert(orders)
      .values({
        orderNo,
        userId: numericUserId || null,
        totalAmount: totalAmount.toString(),
        currency,
        marketRegion,
        sourceChannel: sourceChannel || (marketRegion === 'CN' ? 'wechat_h5' : 'web'),
        paymentMethod: body.paymentMethod || paymentMethod || (marketRegion === 'CN' ? 'bank_transfer' : null),
        status: marketRegion === 'CN' ? 'pending_payment' : 'pending',
        paymentStatus: 'pending',
        shippingName: shippingName || null,
        shippingPhone: shippingPhone || null,
        shippingAddress: shippingAddress || null,
        shippingCity: shippingCity || null,
        shippingZip: shippingZip || null,
      })
      .returning();

    let commissionTotal = 0;
    for (const item of enrichedItems) {
      const [orderItem] = await db.insert(orderItems).values({
        orderId: order.id,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        commissionRate: item.commissionRate.toString(),
        currency,
        subtotal: (Number(item.unitPrice) * item.quantity).toFixed(2),
      }).returning();

      const frozenReferrerId = buyer?.referredByMemberId || buyer?.referrerId;
      if (frozenReferrerId && item.commissionRate > 0) {
        const itemSubtotal = Number(item.unitPrice) * item.quantity;
        const commissionAmount = itemSubtotal * (item.commissionRate / 100);
        commissionTotal += commissionAmount;

        await db.insert(commissions).values({
          orderId: order.id,
          orderItemId: orderItem.id,
          productId: item.productId,
          userId: frozenReferrerId,
          commissionType: 'direct',
          amount: commissionAmount.toFixed(2),
          rate: item.commissionRate.toString(),
          status: 'pending',
        });
      }
    }

    const frozenReferrerId = buyer?.referredByMemberId || buyer?.referrerId;
    if (frozenReferrerId && commissionTotal > 0) {
      await db
        .update(users)
        .set({
          commissionBalance: sql`coalesce(${users.commissionBalance}, 0) + ${commissionTotal.toFixed(2)}`,
          totalSalesVolume: sql`coalesce(${users.totalSalesVolume}, 0) + ${totalAmount.toFixed(2)}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, frozenReferrerId));
    }

    return NextResponse.json({ orderId: order.id, order });
  } catch (error) {
    console.error('Failed to create order:', error);
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');
    const marketRegion = searchParams.get('marketRegion');
    const currency = searchParams.get('currency');

    const session = getRequestSession(request);
    if (!process.env.DATABASE_URL) {
      if (!session) return NextResponse.json({ error: '请先登录' }, { status: 401 });
      const localUserId = hasPlatformAdminAccess(session) && requestedUserId
        ? Number(requestedUserId)
        : hasPlatformAdminAccess(session)
          ? null
          : session.id;
      return NextResponse.json({ orders: listLocalCnOrders(localUserId) });
    }

    if (marketRegion === 'CN' && !session) return NextResponse.json({ error: '请先登录' }, { status: 401 });
    const userId = marketRegion === 'CN' && session && !hasPlatformAdminAccess(session) ? String(session.id) : requestedUserId;

    const conditions = [];
    if (userId) {
      conditions.push(eq(orders.userId, parseInt(userId)));
    }
    if (marketRegion === 'CN') {
      conditions.push(eq(orders.marketRegion, 'CN'));
    }
    if (currency === 'CNY') {
      conditions.push(eq(orders.currency, 'CNY'));
    }

    const orderQuery = conditions.length > 0
      ? db.select().from(orders).where(and(...conditions))
      : db.select().from(orders);

    const orderList = await orderQuery;

    // Fetch order items for each order
    const ordersWithItems = await Promise.all(
      orderList.map(async (order) => {
        const items = await db
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));
        return { ...order, items };
      })
    );

    return NextResponse.json({ orders: ordersWithItems });
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}

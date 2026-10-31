import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { supportTickets } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, name, email, phone, type, subject, message, orderId } = body;

    if (!name || !email || !subject || !message || !type) {
      return NextResponse.json(
        { error: 'Name, email, type, subject and message are required' },
        { status: 400 }
      );
    }

    const [ticket] = await db
      .insert(supportTickets)
      .values({
        userId: userId || null,
        name,
        email,
        phone: phone || null,
        type,
        subject,
        message,
        orderId: orderId ? parseInt(orderId) : null,
        status: 'open',
      })
      .returning();

    return NextResponse.json({ ticketId: ticket.id, ticket });
  } catch (error) {
    console.error('Failed to create support ticket:', error);
    return NextResponse.json(
      { error: 'Failed to create support ticket' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    let query = db.select().from(supportTickets);
    if (userId) {
      query = query.where(eq(supportTickets.userId, parseInt(userId))) as any;
    }

    const tickets = await query;
    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('Failed to fetch support tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch support tickets' },
      { status: 500 }
    );
  }
}

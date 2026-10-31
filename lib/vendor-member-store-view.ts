export function validCommissionSplit(value: { directRate: number; upperRate: number; activeRate: number }) {
  const rates = [value.directRate, value.upperRate, value.activeRate];
  return rates.every((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100)
    && Math.abs(rates.reduce((sum, rate) => sum + rate, 0) - 100) <= 0.001;
}

export function isPaidEngagementOrder(order: { paymentStatus: string; status: string; paymentMode?: string }) {
  return order.paymentStatus === 'paid' && order.paymentMode !== 'test'
    && !['cancelled', 'refunded'].includes(order.status);
}

export function matchesEngagementMember(row: Record<string, unknown>, member: { id: number; phone?: string }) {
  const id = row.userId ?? row.memberId;
  if (id !== undefined && id !== null && String(id) !== '') return String(id) === String(member.id);
  const phone = String(row.phone || row.shippingPhone || '').trim();
  return Boolean(member.phone && phone && phone === member.phone);
}

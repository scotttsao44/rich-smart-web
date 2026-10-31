export const CN_EXCHANGE_RATE = 0.23;

export function getCnyPrice(product: { priceCny?: string | null; priceTwd?: string | null }) {
  const directPrice = Number(product.priceCny || 0);
  if (directPrice > 0) return directPrice;

  const twdPrice = Number(product.priceTwd || 0);
  if (twdPrice <= 0) return 0;
  return Math.round(twdPrice * CN_EXCHANGE_RATE);
}

export function formatCny(value: number) {
  return `¥${value.toLocaleString('zh-CN')}`;
}

export function isChinaManualPayment(paymentMethod?: string | null, currency?: string | null) {
  return paymentMethod === 'wechat_manual' || currency === 'CNY';
}

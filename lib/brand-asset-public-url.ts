// POST /api/cn/brand-assets 成功时回的是 { url }。
// 商品页曾经只认 { asset: { url } }，成功上传也会被当成失败。两种都接受，避免再写错一层。

export function brandAssetUrlFromUploadResponse(data: unknown) {
  if (!data || typeof data !== 'object') return '';
  const record = data as { url?: unknown; asset?: { url?: unknown } };
  const direct = typeof record.url === 'string' ? record.url.trim() : '';
  if (direct) return direct;
  const nested = record.asset && typeof record.asset.url === 'string' ? record.asset.url.trim() : '';
  return nested;
}

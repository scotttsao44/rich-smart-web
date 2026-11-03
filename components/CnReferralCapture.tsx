'use client';

import { useEffect } from 'react';

// 带 ?ref= 打开品牌前页 / 商品页 / 认领页时，沿用现有 /api/cn/referral-link/pending 记录推荐归属（写入 rs_ref_attr）。
// 无推荐码时不做任何事，不默认官方直属。
export default function CnReferralCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = (params.get('ref') || params.get('r') || params.get('referrerCode') || '').trim().toUpperCase();
    if (!ref) return;
    fetch(`/api/cn/referral-link/pending?ref=${encodeURIComponent(ref)}`, { cache: 'no-store', credentials: 'include' }).catch(() => undefined);
  }, []);
  return null;
}

import type { Metadata } from 'next';
import AfuIntroPage from '@/components/AfuIntroPage';
import CnReferralCapture from '@/components/CnReferralCapture';

// 公开页（免登录）：/cn/afu 不在 middleware 的 PROTECTED_CN_PREFIXES 内。带 ?ref= 打开时由 CnReferralCapture 记录推荐归属，
// 并把 ref 带到「申请门店合作」链接与服务号带参二维码。
export const metadata: Metadata = {
  title: '阿富同学 · 门店合作',
  description: '阿富同学门店合作介绍：设备投放、预购次数（次卡）、安装售后与申请步骤。',
};

export default function AfuPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const pick = (key: string) => {
    const value = searchParams?.[key];
    return (Array.isArray(value) ? value[0] : value) || '';
  };
  const ref = (pick('ref') || pick('r') || pick('referrerCode') || pick('referrer')).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 100);
  return (
    <>
      <CnReferralCapture />
      <AfuIntroPage refCode={ref} />
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';

// 合伙人邀请登入（token 链接）目前未开放（见 lib/local-cn-partner-invitations.ts 的 isPartnerInvitationLoginEnabled）。
// 原本直接 notFound() 回 404；改为友善提示页，引导用户走现行的会员邀请链接／扫码登录。
export const metadata: Metadata = {
  title: '合作邀请 | 糙米量子',
  robots: { index: false, follow: false },
};

export default function PartnerInvitePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-stone-50 px-5 py-10">
      <div className="rounded-xl border border-stone-200 bg-white p-6 text-center">
        <h1 className="text-xl font-black text-stone-900">合作邀请链接暂未开放</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          此类邀请链接目前不能直接使用。请向邀请您的会员索取他的专属二维码或会员邀请链接，扫码或打开后即可完成注册，推荐关系会自动记录。
        </p>
        <p className="mt-2 text-sm leading-6 text-stone-600">已经是会员？直接登录即可。</p>
        <div className="mt-6 flex flex-col gap-3">
          <Link href="/cn/login" className="rounded-xl bg-[#07C160] px-4 py-3 text-base font-bold text-white">会员登录</Link>
          <Link href="/cn/shop" className="rounded-xl border border-stone-300 px-4 py-3 text-base font-bold text-stone-700">先逛逛商城</Link>
        </div>
      </div>
    </main>
  );
}

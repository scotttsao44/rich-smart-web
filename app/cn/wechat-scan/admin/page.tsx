// 手机端：电脑端「微信扫码验证管理员」的结果页（不写入任何登录状态）
const RESULT: Record<string, { title: string; detail: string; tone: string }> = {
  ok: { title: '已验证管理员身份', detail: '电脑端网页将自动进入后台，可关闭本页。', tone: 'text-teal-800' },
  denied: { title: '无管理员权限', detail: '当前微信不在管理员名单内，电脑端不会进入后台。', tone: 'text-red-700' },
  expired: { title: '二维码已过期', detail: '请在电脑上刷新二维码后重新扫描。', tone: 'text-amber-800' },
  wechat: { title: '请用微信扫一扫', detail: '请使用微信「扫一扫」扫描电脑上的二维码。', tone: 'text-amber-800' },
  error: { title: '验证失败', detail: '请在电脑上刷新二维码后重试。', tone: 'text-red-700' },
};

export const dynamic = 'force-dynamic';

export default function AdminScanResultPage({ searchParams }: { searchParams: { r?: string } }) {
  const r = RESULT[String(searchParams?.r || '')] || RESULT.error;
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-6 text-center">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-8" data-testid="admin-scan-result">
        <h1 className={`text-xl font-black ${r.tone}`}>{r.title}</h1>
        <p className="mt-3 text-sm font-semibold text-stone-600">{r.detail}</p>
      </div>
    </main>
  );
}

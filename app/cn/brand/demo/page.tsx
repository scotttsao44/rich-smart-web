import { redirect } from 'next/navigation';

type LegacyBrandDemoPageProps = {
  searchParams?: {
    invite?: string;
    token?: string;
  };
};

export default function LegacyBrandDemoPage({ searchParams }: LegacyBrandDemoPageProps) {
  const params = new URLSearchParams({ next: '/cn/shop' });
  const invite = String(searchParams?.invite || searchParams?.token || '').trim();
  if (invite) params.set('invite', invite);
  redirect(`/cn/login?${params.toString()}`);
}

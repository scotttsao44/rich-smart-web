'use client';

import { usePathname } from 'next/navigation';

export const ICP_BEIAN_NUMBER = '苏ICP备2026083440号-1';
export const ICP_BEIAN_URL = 'https://beian.miit.gov.cn/';
export const ICP_COMPANY_NAME = '苏州糙米量子科技有限公司';

/**
 * MIIT-required ICP website filing notice. Rendered site-wide (every page) from the root layout.
 * /cn pages carry a fixed mobile tab bar (h-16), so add bottom spacing on mobile there.
 */
export default function IcpBeianFooter() {
  const pathname = usePathname() || '';

  const hasMobileTabBar = pathname === '/cn' || pathname.startsWith('/cn/');

  return (
    <footer
      data-testid="icp-beian-footer"
      className={`border-t border-gray-100 bg-white px-4 py-4 text-center text-xs leading-6 text-gray-500 ${hasMobileTabBar ? 'pb-20 md:pb-4' : ''}`}
    >
      <span>© 2026 {ICP_COMPANY_NAME} 版权所有</span>
      <span className="mx-2 text-gray-300">|</span>
      <a
        href={ICP_BEIAN_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-gray-700 hover:underline"
      >
        {ICP_BEIAN_NUMBER}
      </a>
    </footer>
  );
}

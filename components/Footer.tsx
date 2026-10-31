'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, Mail, Phone, ShieldCheck, FileText } from 'lucide-react';

export default function Footer() {
  const pathname = usePathname();

  if (pathname?.startsWith('/cn') || pathname?.startsWith('/vendor') || pathname?.startsWith('/mini-preview')) {
    return null;
  }

  return (
    <footer className="bg-white border-t border-gray-100 mt-12">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <h3 className="font-bold text-lg text-amber-600 mb-2">糙米科技</h3>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">快速链接</h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/cn/login" className="text-gray-500 hover:text-amber-600 transition-colors">
                  登录
                </Link>
              </li>
              <li>
                <Link href="/cn/member" className="text-gray-500 hover:text-amber-600 transition-colors">
                  会员中心
                </Link>
              </li>
              <li>
                <Link href="/cn/shop" className="text-gray-500 hover:text-amber-600 transition-colors">
                  健康商城
                </Link>
              </li>
              <li>
                <Link href="/cn/cart" className="text-gray-500 hover:text-amber-600 transition-colors">
                  购物车
                </Link>
              </li>
              <li>
                <Link href="/support" className="text-gray-500 hover:text-amber-600 transition-colors flex items-center gap-1">
                  <MessageCircle size={14} /> 客服中心
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">联系我们</h4>
            <ul className="space-y-2 text-sm text-gray-500">
              <li className="flex items-center gap-2">
                <Phone size={14} className="text-amber-600" />
                客服：400-000-9318
              </li>
              <li className="flex items-center gap-2">
                <Mail size={14} className="text-amber-600" />
                邮箱：support@richsmart.net
              </li>
              <li className="flex items-center gap-2">
                <MessageCircle size={14} className="text-amber-600" />
                微信客服：糙米健康服务
              </li>
            </ul>
            <div className="mt-4 flex gap-3">
              <Link
                href="/support"
                className="inline-flex items-center gap-1 text-sm px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                <MessageCircle size={14} /> 联系微信客服
              </Link>
              <Link
                href="/support?tab=complaint"
                className="inline-flex items-center gap-1 text-sm px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                <FileText size={14} /> 我要投诉
              </Link>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 mt-8 pt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-4">
            <span>© 2026 苏州糙米量子科技有限公司</span>
            <Link href="/support?tab=complaint" className="hover:text-gray-600">客服与投诉</Link>
          </div>
          <div className="flex items-center gap-1">
            <ShieldCheck size={12} />
            <span>本網站产品屬健康趋势评估，不等同医疗诊断</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

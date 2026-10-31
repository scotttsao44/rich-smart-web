import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider, CartProvider } from './providers';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import IcpBeianFooter from '@/components/IcpBeianFooter';

export const metadata: Metadata = {
  title: '糙米',
  description: '微信小程序、门店体验、CRM、推荐码与服务包下单',
  icons: {
    icon: '/images/caomi-logo.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
        <AuthProvider>
          <CartProvider>
            <Header />
            <main className="flex-grow">{children}</main>
            <Footer />
            <IcpBeianFooter />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

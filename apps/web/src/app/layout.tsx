import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/AuthProvider';
import { Header } from '@/components/Header';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'KDCN — Kaduna Digital Commerce Network', template: '%s · KDCN' },
  description:
    'Shop verified sellers from Galaxy Mall, Kaduna markets, independent shops and home-based vendors — in one place.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0a4d38' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body>
        <AuthProvider>
          <Header />
          <main id="main">
            <div className="container">{children}</div>
          </main>
          <footer className="site-footer">
            <div className="container cols">
              <div>
                <strong>KDCN</strong>
                <p>
                  Kaduna Digital Commerce Network connects Kaduna businesses — mall stores, market
                  traders, independent shops and home-based vendors — with customers.
                </p>
              </div>
              <div className="stack-sm">
                <div>
                  <Link href="/markets/galaxy-mall">Galaxy Mall</Link>
                </div>
                <div>
                  <Link href="/sell">Sell on KDCN</Link>
                </div>
                <div>
                  <Link href="/track">Track an order</Link>
                </div>
              </div>
              <div>
                <p>
                  “Identity verified” means KDCN has checked who a seller is. It is not a guarantee
                  of product quality. Payments are processed by a licensed payment provider; refunds
                  follow each order&apos;s published terms.
                </p>
              </div>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}

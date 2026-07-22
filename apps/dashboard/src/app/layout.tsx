import type { Metadata } from 'next';
import { siteConfig } from '@phoenix/config';
import './globals.css';

export const metadata: Metadata = {
  title: `Phoenix Dashboard — ${siteConfig.tagline}`,
  description: 'The Phoenix governance dashboard — coming soon.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-phx-navy text-white antialiased min-h-screen flex flex-col">
        <header className="px-6 lg:px-8 py-6 border-b border-white/[0.06]">
          <div className="max-w-7xl mx-auto flex items-center gap-2.5">
            <svg width="24" height="28" viewBox="0 0 1731 1978" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M154 130L1259 130L1602 473V1015L1259 1358H639V1978H154V1258L639 773H1136L1259 1015L1136 1258H639V773L154 1258V130Z"
                fill="var(--phx-white)"
                fillRule="evenodd"
              />
              <rect x="154" y="1633" width="345" height="345" fill="var(--phx-cyan)" />
            </svg>
            <span className="text-base font-extrabold tracking-tight">PHOENIX DASHBOARD</span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="px-6 lg:px-8 py-8 border-t border-white/[0.06] text-center">
          <p className="text-xs text-gray-500">© {new Date().getFullYear()} Phoenix. All rights reserved.</p>
        </footer>
      </body>
    </html>
  );
}

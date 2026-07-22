'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navigationItems } from '@phoenix/config';

function PhoenixLogo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 group" aria-label="Phoenix home">
      <svg width="28" height="32" viewBox="0 0 1731 1978" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M154 130L1259 130L1602 473V1015L1259 1358H639V1978H154V1258L639 773H1136L1259 1015L1136 1258H639V773L154 1258V130Z"
          fill={dark ? 'var(--phx-navy)' : 'var(--phx-white)'}
          fillRule="evenodd"
        />
        <rect x="154" y="1633" width="345" height="345" fill="var(--phx-cyan)" />
      </svg>
      <span className={`text-lg font-extrabold tracking-tight ${dark ? 'text-phx-navy' : 'text-white'}`}>
        PHOENIX
      </span>
    </Link>
  );
}

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 bg-phx-navy/95 backdrop-blur-md border-b border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-18 py-4">
          <PhoenixLogo />

          <nav className="hidden lg:flex items-center gap-8" aria-label="Main navigation">
            {navigationItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`text-sm font-medium transition-colors duration-150 ${
                    isActive ? 'text-white' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden lg:flex items-center gap-4">
            <Link
              href="/contact"
              className="text-sm font-medium text-gray-300 hover:text-white transition-colors duration-150"
            >
              Contact
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center px-5 py-2.5 bg-phx-cyan text-white text-sm font-semibold rounded-lg hover:bg-phx-cyan-dark transition-colors duration-150"
            >
              Request Assessment
            </Link>
          </div>

          <button
            className="lg:hidden text-white p-2 -mr-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-white/[0.06] bg-phx-navy">
          <nav className="px-6 py-6 flex flex-col gap-1" aria-label="Mobile navigation">
            {navigationItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="py-3 text-base font-medium text-gray-300 hover:text-white transition-colors duration-150 border-b border-white/[0.04]"
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/contact"
              className="py-3 text-base font-medium text-gray-300 hover:text-white transition-colors duration-150"
              onClick={() => setMobileOpen(false)}
            >
              Contact
            </Link>
            <Link
              href="/contact"
              className="mt-4 inline-flex items-center justify-center px-5 py-3 bg-phx-cyan text-white text-sm font-semibold rounded-lg"
              onClick={() => setMobileOpen(false)}
            >
              Request Assessment
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

export { PhoenixLogo };

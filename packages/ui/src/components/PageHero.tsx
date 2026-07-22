'use client';

import React from 'react';
import Link from 'next/link';

// Internal routes use Next.js <Link>; external protocols stay plain anchors.
function isExternalHref(href: string): boolean {
  return /^(mailto:|tel:|https?:\/\/)/i.test(href);
}

interface PageHeroProps {
  eyebrow?: string;
  headline: string;
  subline?: string;
  primaryCTA?: { label: string; href: string };
  secondaryCTA?: { label: string; href: string };
  variant?: 'dark' | 'light';
  size?: 'default' | 'large';
  visual?: React.ReactNode;
}

export function PageHero({
  eyebrow,
  headline,
  subline,
  primaryCTA,
  secondaryCTA,
  variant = 'dark',
  size = 'default',
  visual,
}: PageHeroProps) {
  const isDark = variant === 'dark';
  const isLarge = size === 'large';

  return (
    <section
      className={`relative overflow-hidden ${
        isDark ? 'bg-phx-navy text-white' : 'bg-phx-surface text-phx-navy'
      } ${isLarge ? 'pt-32 pb-24 lg:pt-44 lg:pb-36' : 'pt-28 pb-20 lg:pt-36 lg:pb-28'}`}
    >
      {isDark && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-[40%] -right-[20%] w-[70%] h-[140%] rounded-full bg-gradient-to-b from-phx-navy-light to-transparent opacity-60" />
          <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-phx-cyan/20 to-transparent" />
        </div>
      )}
      <div className="relative max-w-7xl mx-auto px-6 lg:px-8">
        <div className={visual ? 'grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-12 lg:gap-16 items-center' : ''}>
          <div>
            {eyebrow && (
              <p className="text-phx-cyan text-sm font-semibold tracking-[0.15em] uppercase mb-4">
                {eyebrow}
              </p>
            )}
            <h1
              className={`font-extrabold tracking-tight leading-[1.08] ${
                isLarge
                  ? 'text-4xl sm:text-5xl lg:text-7xl max-w-5xl'
                  : 'text-3xl sm:text-4xl lg:text-5xl max-w-4xl'
              }`}
            >
              {headline}
            </h1>
            {subline && (
              <p
                className={`mt-6 leading-relaxed max-w-2xl ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                } ${isLarge ? 'text-lg lg:text-xl' : 'text-base lg:text-lg'}`}
              >
                {subline}
              </p>
            )}
            {(primaryCTA || secondaryCTA) && (
              <div className="mt-10 flex flex-col sm:flex-row gap-4">
                {primaryCTA && (
                  isExternalHref(primaryCTA.href) ? (
                    <a
                      href={primaryCTA.href}
                      className="inline-flex items-center justify-center px-7 py-3.5 bg-phx-cyan text-white text-sm font-semibold rounded-lg hover:bg-phx-cyan-dark transition-colors duration-200"
                    >
                      {primaryCTA.label}
                    </a>
                  ) : (
                    <Link
                      href={primaryCTA.href}
                      className="inline-flex items-center justify-center px-7 py-3.5 bg-phx-cyan text-white text-sm font-semibold rounded-lg hover:bg-phx-cyan-dark transition-colors duration-200"
                    >
                      {primaryCTA.label}
                    </Link>
                  )
                )}
                {secondaryCTA && (
                  isExternalHref(secondaryCTA.href) ? (
                    <a
                      href={secondaryCTA.href}
                      className={`inline-flex items-center justify-center px-7 py-3.5 text-sm font-semibold rounded-lg border-2 transition-colors duration-200 ${
                        isDark
                          ? 'border-gray-400 text-white hover:border-phx-cyan hover:text-phx-cyan'
                          : 'border-gray-400 text-phx-navy hover:border-phx-cyan hover:text-phx-cyan'
                      }`}
                    >
                      {secondaryCTA.label}
                    </a>
                  ) : (
                    <Link
                      href={secondaryCTA.href}
                      className={`inline-flex items-center justify-center px-7 py-3.5 text-sm font-semibold rounded-lg border-2 transition-colors duration-200 ${
                        isDark
                          ? 'border-gray-400 text-white hover:border-phx-cyan hover:text-phx-cyan'
                          : 'border-gray-400 text-phx-navy hover:border-phx-cyan hover:text-phx-cyan'
                      }`}
                    >
                      {secondaryCTA.label}
                    </Link>
                  )
                )}
              </div>
            )}
          </div>
          {visual && <div className="flex justify-center lg:justify-end">{visual}</div>}
        </div>
      </div>
    </section>
  );
}

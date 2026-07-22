import React from 'react';
import Link from 'next/link';
import { footerSections, siteConfig } from '@phoenix/config';
import { PhoenixLogo } from './Header';

export function Footer() {
  return (
    <footer className="bg-phx-navy border-t border-white/[0.06]">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-10">
          <div className="col-span-2">
            <PhoenixLogo />
            <p className="mt-4 text-sm text-gray-400 max-w-xs leading-relaxed">
              {siteConfig.tagline}
            </p>
            <p className="mt-6 text-xs text-gray-500">{siteConfig.email}</p>
          </div>

          {footerSections.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
                {section.title}
              </h3>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={`${link.label}-${link.href}`}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-400 hover:text-white transition-colors duration-150"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} Phoenix. All rights reserved.
          </p>
          <p className="text-xs text-gray-500">phoenixops.ai</p>
        </div>
      </div>
    </footer>
  );
}

'use client';

import React from 'react';
import { IconChevronDown, IconMenu } from './Icons';
import { AlphaRoleSwitcher } from './AlphaRoleSwitcher';

interface PlatformTopbarProps {
  onOpenMobileNav: () => void;
  workspaceName: string;
  /** Retained for prop-compatibility; the topbar now shows the live mock
   * session user (see AlphaRoleSwitcher) rather than this static value,
   * since the session user is switchable via the Alpha Role Preview. */
  userName: string;
}

export function PlatformTopbar({ onOpenMobileNav, workspaceName }: PlatformTopbarProps) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 h-16">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onOpenMobileNav}
            className="lg:hidden text-gray-500 hover:text-phx-navy flex-shrink-0"
            aria-label="Open navigation"
          >
            <IconMenu />
          </button>

          <button className="flex items-center gap-2 min-w-0 rounded-lg px-2 py-1.5 -ml-2 hover:bg-gray-50 transition-colors">
            <span className="text-sm font-semibold text-phx-navy truncate">{workspaceName}</span>
            <IconChevronDown className="text-gray-400 flex-shrink-0" />
          </button>

          <span className="hidden sm:inline-flex items-center text-[11px] font-semibold text-phx-cyan-dark bg-phx-cyan/10 px-2.5 py-1 rounded-full flex-shrink-0">
            Platform Alpha
          </span>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="pl-3 border-l border-gray-200">
            <AlphaRoleSwitcher />
          </div>
        </div>
      </div>
    </header>
  );
}

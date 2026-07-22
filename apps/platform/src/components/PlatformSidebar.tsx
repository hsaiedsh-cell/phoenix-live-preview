'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconDashboard,
  IconClipboard,
  IconShieldBadge,
  IconAward,
  IconReport,
  IconSettings,
  IconClose,
} from './Icons';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: IconDashboard },
  { label: 'Assessments', href: '/assessments', icon: IconClipboard },
  { label: 'PBRS Passports', href: '/passports', icon: IconShieldBadge },
  { label: 'Certifications', href: '/certifications', icon: IconAward },
  { label: 'Reports', href: '/reports', icon: IconReport },
  { label: 'Settings', href: '/settings', icon: IconSettings },
] as const;

function PhoenixMark() {
  return (
    <svg width="20" height="23" viewBox="0 0 1731 1978" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M154 130L1259 130L1602 473V1015L1259 1358H639V1978H154V1258L639 773H1136L1259 1015L1136 1258H639V773L154 1258V130Z"
        fill="var(--phx-white)"
        fillRule="evenodd"
      />
      <rect x="154" y="1633" width="345" height="345" fill="var(--phx-cyan)" />
    </svg>
  );
}

interface SidebarContentProps {
  onNavigate?: () => void;
}

function SidebarContent({ onNavigate }: SidebarContentProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-6 py-6">
        <PhoenixMark />
        <div className="leading-tight">
          <p className="text-sm font-extrabold tracking-tight text-white">PHOENIX</p>
          <p className="text-[10px] font-semibold tracking-widest text-phx-cyan uppercase">Platform</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                isActive
                  ? 'bg-white/[0.08] text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className={isActive ? 'text-phx-cyan' : 'text-gray-500'} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-6 py-5 border-t border-white/[0.06]">
        <p className="text-[10px] font-semibold tracking-widest text-gray-600 uppercase mb-1">Platform Alpha</p>
        <p className="text-xs text-gray-500 leading-relaxed">UI preview build. Sample data only.</p>
      </div>
    </div>
  );
}

export function PlatformSidebar() {
  return (
    <aside className="hidden lg:flex lg:flex-col w-64 flex-shrink-0 bg-phx-navy border-r border-white/[0.06] h-screen sticky top-0">
      <SidebarContent />
    </aside>
  );
}

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function MobileSidebar({ open, onClose }: MobileSidebarProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-y-0 left-0 w-72 bg-phx-navy shadow-xl flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-5 right-4 text-gray-400 hover:text-white"
          aria-label="Close navigation"
        >
          <IconClose />
        </button>
        <SidebarContent onNavigate={onClose} />
      </div>
    </div>
  );
}

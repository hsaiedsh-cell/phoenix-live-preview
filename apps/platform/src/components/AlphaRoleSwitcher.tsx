'use client';

// ============================================================
// Phoenix Platform — Alpha Role Switcher
// PHX-PLATFORM-006 — Authentication & Workspace Access Foundation
// PHX-PLATFORM-008 — Session Hydration Stabilization
// ------------------------------------------------------------
// QA-only control for previewing role-aware UI states. Clearly
// labeled "Alpha Role Preview" — this must never look like a
// production admin/impersonation feature. Switching roles here
// only changes the local mock session (see mock-session.ts); it
// does not change any real permission, user, or data.
//
// PHX-PLATFORM-008: while the mock session is still resolving
// (isLoading), this shows a compact disabled placeholder instead of
// the real selector — both server and client render the same
// placeholder, so there's nothing to mismatch during hydration.
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { usePhoenixSession } from '@/hooks/usePhoenixSession';
import { getAvailableMockUsers } from '@/lib/mock-session';
import { IconChevronDown } from './Icons';

export function AlphaRoleSwitcher() {
  const { user, role, switchRole, isLoading } = usePhoenixSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mockUsers = getAvailableMockUsers();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 opacity-60 cursor-default select-none">
        <span className="w-6 h-6 rounded-full bg-gray-200 flex-shrink-0 animate-pulse" />
        <span className="hidden md:flex flex-col leading-tight">
          <span className="text-xs font-semibold text-gray-400">Resolving role...</span>
          <span className="text-[10px] text-gray-300">Alpha Role Preview</span>
        </span>
      </div>
    );
  }

  if (!user || !role) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-left hover:border-phx-cyan/50 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="w-6 h-6 rounded-full bg-phx-navy flex items-center justify-center text-[10px] font-bold text-phx-cyan flex-shrink-0">
          {user.avatarInitials}
        </span>
        <span className="hidden md:flex flex-col leading-tight">
          <span className="text-xs font-semibold text-phx-navy">{user.name}</span>
          <span className="text-[10px] text-gray-400">{role} · Alpha Role Preview</span>
        </span>
        <IconChevronDown width={12} height={12} className="text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-2 w-64 rounded-xl border border-gray-200 bg-white shadow-lg z-40 overflow-hidden"
        >
          <div className="px-3.5 py-2.5 border-b border-gray-100">
            <p className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase">Alpha Role Preview</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              QA-only. Switches the mock session role to verify role-aware UI states.
            </p>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {mockUsers.map((mockUser) => {
              const isActive = mockUser.role === role;
              return (
                <li key={mockUser.id}>
                  <button
                    onClick={() => {
                      switchRole(mockUser.role);
                      setOpen(false);
                    }}
                    role="option"
                    aria-selected={isActive}
                    className={`w-full flex items-center justify-between gap-3 px-3.5 py-2 text-left text-sm transition-colors ${
                      isActive ? 'bg-phx-cyan/10 text-phx-navy font-semibold' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span>
                      <span className="block">{mockUser.role}</span>
                      <span className="block text-[11px] text-gray-400 font-normal">{mockUser.name}</span>
                    </span>
                    {isActive && <span className="text-[10px] font-semibold text-phx-cyan-dark">Current</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

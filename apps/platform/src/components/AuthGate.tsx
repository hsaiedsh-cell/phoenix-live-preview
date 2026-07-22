'use client';

// ============================================================
// Phoenix Platform — AuthGate
// PHX-PLATFORM-006 — Authentication & Workspace Access Foundation
// PHX-PLATFORM-008 — Session Hydration Stabilization
// ------------------------------------------------------------
// UI gating only — not a security boundary. Shows children when
// the mock session is authenticated (the Alpha default), or a
// lightweight "authentication required" panel otherwise. Since
// there is no real backend, nothing here actually protects data;
// it exists so the platform shell has the right shape for when a
// real session provider is introduced.
//
// PHX-PLATFORM-008: while the mock session is still resolving
// (isLoading — server render and the client's first hydration pass),
// this shows a neutral "preparing" panel instead of either the real
// children or the "authentication required" panel. Falling through to
// children here would render permission-gated UI (via RoleGate /
// GovernanceActionButton further down the tree) before the client
// knows which role is active.
// ============================================================

import React from 'react';
import Link from 'next/link';
import { usePhoenixSession } from '@/hooks/usePhoenixSession';
import { IconLock } from './Icons';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = usePhoenixSession();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-phx-surface flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="mx-auto mb-5 w-12 h-12 rounded-full bg-phx-navy/5 flex items-center justify-center text-phx-navy animate-pulse">
            <IconLock width={20} height={20} />
          </div>
          <h1 className="text-lg font-extrabold text-phx-navy tracking-tight mb-2">
            Preparing Phoenix Platform Alpha...
          </h1>
          <p className="text-sm text-gray-500">Resolving mock workspace session.</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-phx-surface flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="mx-auto mb-5 w-12 h-12 rounded-full bg-phx-navy/5 flex items-center justify-center text-phx-navy">
            <IconLock width={20} height={20} />
          </div>
          <h1 className="text-lg font-extrabold text-phx-navy tracking-tight mb-2">Authentication required</h1>
          <p className="text-sm text-gray-500 mb-6">
            Sign in to access Phoenix Platform. This is a mock-alpha session gate — no production authentication is
            connected yet.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold bg-phx-cyan text-white hover:bg-phx-cyan-dark transition-colors shadow-sm"
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

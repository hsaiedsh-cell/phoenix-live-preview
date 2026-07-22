'use client';

// ============================================================
// Phoenix Platform — RoleGate
// PHX-PLATFORM-006 — Authentication & Workspace Access Foundation
// PHX-PLATFORM-008 — Session Hydration Stabilization
// ------------------------------------------------------------
// Small client component that shows/hides existing UI based on
// the current mock session role and an access-control permission.
// Used to lightly gate actions and sections that already exist in
// the platform UI (Task 8/9) — it does not add any new actions.
//
// PHX-PLATFORM-008: while the mock session is still resolving
// (isLoading), this renders `loadingFallback` (default: nothing) —
// never `children` and never the "restricted" `fallback`. Both of
// those would be guessing at a role the client doesn't know yet, and
// server/first-hydration-pass would otherwise briefly reflect the
// wrong role's permissions. Once the session resolves, this falls
// back to its original "unauthenticated/not-permitted -> fallback,
// permitted -> children" behavior.
// ============================================================

import React from 'react';
import { usePhoenixSession } from '@/hooks/usePhoenixSession';
import type { PhoenixPermission } from '@/lib/access-control';

interface RoleGateProps {
  permission: PhoenixPermission;
  children: React.ReactNode;
  /** Rendered instead of children when authenticated but the permission check fails. */
  fallback?: React.ReactNode;
  /** Rendered while the mock session is still resolving. Defaults to nothing. */
  loadingFallback?: React.ReactNode;
}

export function RoleGate({ permission, children, fallback = null, loadingFallback = null }: RoleGateProps) {
  const { isLoading, isAuthenticated, capabilities } = usePhoenixSession();

  if (isLoading) return <>{loadingFallback}</>;
  if (!isAuthenticated || !capabilities) return <>{fallback}</>;
  if (!capabilities[permission]) return <>{fallback}</>;
  return <>{children}</>;
}

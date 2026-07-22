'use client';

// ============================================================
// Phoenix Platform — usePhoenixSession Hook
// PHX-PLATFORM-006 — Authentication & Workspace Access Foundation
// PHX-PLATFORM-008 — Session Hydration Stabilization
// ------------------------------------------------------------
// The one import platform components need for session/role-aware
// UI: `const { role, capabilities, isAuthenticated, isLoading } = usePhoenixSession();`
//
// While `isLoading` is true (before the client has resolved the mock
// session — see SessionProvider.tsx), `user`/`role`/`capabilities` are
// all safely null and `isAuthenticated` is false. Consumers that gate
// permission-sensitive UI should check `isLoading` first and render a
// neutral/placeholder state rather than falling through to whatever
// their "not permitted" branch does — see RoleGate.tsx and
// GovernanceActionButton.tsx for the reference pattern.
// ============================================================

import { useContext } from 'react';
import { PhoenixSessionContext } from '@/components/SessionProvider';

export function usePhoenixSession() {
  const ctx = useContext(PhoenixSessionContext);
  if (!ctx) {
    throw new Error('usePhoenixSession must be used within <SessionProvider>. Did you forget to wrap RootLayout?');
  }
  const { session, isAuthenticated, isLoading, role, capabilities, switchRole } = ctx;
  return {
    session,
    user: session.user,
    activeWorkspace: session.activeWorkspace,
    role,
    isAuthenticated,
    isLoading,
    switchRole,
    capabilities,
  };
}

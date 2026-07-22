'use client';

// ============================================================
// Phoenix Platform — Session Provider
// PHX-PLATFORM-006 — Authentication & Workspace Access Foundation
// PHX-PLATFORM-008 — Session Hydration Stabilization
// ------------------------------------------------------------
// Client-side React context wrapping the mock session. This is
// the single source of truth for "who is the current user" across
// the platform UI in Alpha. Swapping to a real backend later
// should mean replacing the body of this component (fetch a real
// session, subscribe to a real auth provider) — consumers using
// usePhoenixSession() should not need to change.
//
// PHX-PLATFORM-008: the initial React state is always the neutral
// `loading` session (getInitialMockSession()), identical on server
// and client, so the first hydration pass never has to guess a role.
// The real, localStorage-aware session is only resolved in an effect
// after client mount — see the file-level note in mock-session.ts for
// why this matters. Until that effect runs, `role` is null and
// `capabilities` is null; consumers must treat that as "not yet
// known", not as any particular role's (e.g. Owner's) permissions.
// ============================================================

import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { PhoenixSession, PhoenixUserRole } from '@/lib/auth-types';
import { getInitialMockSession, getMockSession, getMockSessionForRole, switchMockUser } from '@/lib/mock-session';
import { getRoleCapabilities, type PhoenixPermission } from '@/lib/access-control';

export interface PhoenixSessionContextValue {
  session: PhoenixSession;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: PhoenixUserRole | null;
  capabilities: Record<PhoenixPermission, boolean> | null;
  /** Mock-only helper — switches the active QA role. Not a real auth action. */
  switchRole: (role: PhoenixUserRole) => void;
}

export const PhoenixSessionContext = createContext<PhoenixSessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // Always starts as the neutral loading session — identical on server
  // and on the client's first hydration pass. Do NOT read localStorage
  // here (no lazy getMockSession() call): that would resolve a real
  // role in the client's initializer, mismatching the server's HTML
  // and reintroducing the hydration flash this sprint exists to fix.
  const [session, setSession] = useState<PhoenixSession>(getInitialMockSession());

  // Client-only: resolve the real mock session (localStorage-aware)
  // once, after mount, then swap it in. This intentionally happens
  // post-hydration.
  useEffect(() => {
    setSession(getMockSession());
  }, []);

  const switchRole = useCallback((role: PhoenixUserRole) => {
    switchMockUser(role);
    setSession(getMockSessionForRole(role));
  }, []);

  const value = useMemo<PhoenixSessionContextValue>(() => {
    const role = session.user?.role ?? null;
    return {
      session,
      isAuthenticated: session.status === 'authenticated',
      isLoading: session.status === 'loading',
      role,
      capabilities: role ? getRoleCapabilities(role) : null,
      switchRole,
    };
  }, [session, switchRole]);

  return <PhoenixSessionContext.Provider value={value}>{children}</PhoenixSessionContext.Provider>;
}

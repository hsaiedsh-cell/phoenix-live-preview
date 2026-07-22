// ============================================================
// Phoenix Platform — Mock Session
// PHX-PLATFORM-006 — Authentication & Workspace Access Foundation
// PHX-PLATFORM-008 — Session Hydration Stabilization
// ------------------------------------------------------------
// Alpha-only mock session data and helpers. There is no real
// authentication, no password storage, and no session token here
// — this exists purely so the UI has a role-aware user/workspace
// context to render against, and so QA can exercise every
// WorkspaceRole from PERMISSIONS_MODEL_PHX_PLATFORM_002.md without
// a real backend.
//
// `switchMockUser` is a QA convenience only ("Alpha Role Preview").
// It is not a role-management feature and must never be presented
// as one. State is kept in localStorage, guarded behind a browser
// check so this module stays safe to import from server code and
// does not break static builds/SSR.
//
// PHX-PLATFORM-008: a server render (and the client's very first
// hydration pass) has no access to localStorage, so it cannot know
// which mock role was previously selected in this browser. Rather
// than silently defaulting that first paint to Owner — which then
// gets replaced post-hydration by whatever role is actually stored,
// producing a hydration mismatch and a brief flash of Owner-only UI
// — this module exposes an explicit neutral `loading` session
// (MOCK_LOADING_SESSION / getInitialMockSession()) for callers to use
// as their initial state on both server and client. The real,
// localStorage-aware role is only resolved after client mount, via
// getMockSession() called from an effect.
// ============================================================

import { MOCK_WORKSPACE_ID } from './mock-ids';
import type { PhoenixUser, PhoenixUserRole, PhoenixWorkspaceContext, PhoenixSession } from './auth-types';
import { PHOENIX_USER_ROLES } from './auth-types';

const MOCK_ACTIVE_ROLE_STORAGE_KEY = 'phx.mockSession.activeRole';

/**
 * One mock user per WorkspaceRole. Names/emails are illustrative only —
 * no real credentials, no real people. Every user belongs to the single
 * Alpha mock workspace (MOCK_WORKSPACE_ID).
 */
const MOCK_USERS_BY_ROLE: Record<PhoenixUserRole, PhoenixUser> = {
  Owner: {
    id: '00000000-0000-4000-8000-0000000000aa',
    name: 'Hossam M.',
    email: 'hossam@acme-enterprise.example',
    role: 'Owner',
    avatarInitials: 'HM',
    workspaceIds: [MOCK_WORKSPACE_ID],
    defaultWorkspaceId: MOCK_WORKSPACE_ID,
  },
  Admin: {
    id: '00000000-0000-4000-8000-0000000000ab',
    name: 'S. Al-Farsi',
    email: 's.alfarsi@acme-enterprise.example',
    role: 'Admin',
    avatarInitials: 'SA',
    workspaceIds: [MOCK_WORKSPACE_ID],
    defaultWorkspaceId: MOCK_WORKSPACE_ID,
  },
  Reviewer: {
    id: '00000000-0000-4000-8000-0000000000ac',
    name: 'M. Khoury',
    email: 'm.khoury@acme-enterprise.example',
    role: 'Reviewer',
    avatarInitials: 'MK',
    workspaceIds: [MOCK_WORKSPACE_ID],
    defaultWorkspaceId: MOCK_WORKSPACE_ID,
  },
  Contributor: {
    id: '00000000-0000-4000-8000-0000000000ad',
    name: 'R. Haddad',
    email: 'r.haddad@acme-enterprise.example',
    role: 'Contributor',
    avatarInitials: 'RH',
    workspaceIds: [MOCK_WORKSPACE_ID],
    defaultWorkspaceId: MOCK_WORKSPACE_ID,
  },
  Viewer: {
    id: '00000000-0000-4000-8000-0000000000ae',
    name: 'L. Nasser',
    email: 'l.nasser@acme-enterprise.example',
    role: 'Viewer',
    avatarInitials: 'LN',
    workspaceIds: [MOCK_WORKSPACE_ID],
    defaultWorkspaceId: MOCK_WORKSPACE_ID,
  },
  Auditor: {
    id: '00000000-0000-4000-8000-0000000000af',
    name: 'T. Rahim',
    email: 't.rahim@acme-enterprise.example',
    role: 'Auditor',
    avatarInitials: 'TR',
    workspaceIds: [MOCK_WORKSPACE_ID],
    defaultWorkspaceId: MOCK_WORKSPACE_ID,
  },
};

const MOCK_WORKSPACE_CONTEXT: PhoenixWorkspaceContext = {
  id: MOCK_WORKSPACE_ID,
  name: 'Acme Enterprise Workspace',
  slug: 'acme-enterprise',
  plan: 'Alpha',
  status: 'Active',
};

/** Default signed-in user for a fresh Alpha session — Owner. */
const DEFAULT_MOCK_ROLE: PhoenixUserRole = 'Owner';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function isValidRole(value: string | null): value is PhoenixUserRole {
  return !!value && (PHOENIX_USER_ROLES as string[]).includes(value);
}

function readStoredRole(): PhoenixUserRole | null {
  if (!isBrowser()) return null;
  try {
    const stored = window.localStorage.getItem(MOCK_ACTIVE_ROLE_STORAGE_KEY);
    return isValidRole(stored) ? stored : null;
  } catch {
    // localStorage can throw in private-browsing/embedded contexts — fall
    // back to the default role rather than breaking the page.
    return null;
  }
}

function writeStoredRole(role: PhoenixUserRole): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(MOCK_ACTIVE_ROLE_STORAGE_KEY, role);
  } catch {
    // Ignore storage failures — the in-memory React state set by the
    // caller still reflects the switch for the current page lifetime.
  }
}

/** Returns the mock user object for a given WorkspaceRole. */
export function getMockUserByRole(role: PhoenixUserRole): PhoenixUser {
  return MOCK_USERS_BY_ROLE[role];
}

/** Full roster of mock users, one per role, for role-switcher UI. */
export function getAvailableMockUsers(): PhoenixUser[] {
  return PHOENIX_USER_ROLES.map((role) => MOCK_USERS_BY_ROLE[role]);
}

/**
 * Neutral, hydration-safe session used as the initial state on both
 * server and client, before the client has had a chance to read
 * localStorage. No user, no workspace, no assumed role — consumers
 * (AuthGate, RoleGate, GovernanceActionButton, AlphaRoleSwitcher) must
 * treat `status: 'loading'` as "not yet known", not as unauthenticated
 * and not as any particular role's permissions.
 */
export const MOCK_LOADING_SESSION: PhoenixSession = {
  status: 'loading',
  user: null,
  activeWorkspace: null,
};

/** Returns the default mock user (Owner) used when no role has been stored yet. */
export function getDefaultMockUser(): PhoenixUser {
  return MOCK_USERS_BY_ROLE[DEFAULT_MOCK_ROLE];
}

/**
 * Returns the QA-switched role persisted in this browser, or `null` if
 * none has been stored yet (or this is running on the server). Safe to
 * call from anywhere — never throws.
 */
export function getStoredMockRole(): PhoenixUserRole | null {
  return readStoredRole();
}

/** Builds an authenticated mock session for a specific role. Pure — no localStorage access. */
export function getMockSessionForRole(role: PhoenixUserRole): PhoenixSession {
  return {
    status: 'authenticated',
    user: getMockUserByRole(role),
    activeWorkspace: MOCK_WORKSPACE_CONTEXT,
  };
}

/**
 * The session state to use for the very first render, on both server
 * and client, before any localStorage read has happened. Always the
 * neutral loading session — see MOCK_LOADING_SESSION above. Using this
 * (rather than resolving a role immediately) is what keeps the server
 * HTML and the client's first hydration pass identical.
 */
export function getInitialMockSession(): PhoenixSession {
  return MOCK_LOADING_SESSION;
}

/**
 * Returns the current mock session. Safe to call from server or client:
 * on the server (no `window`), returns the neutral loading session
 * rather than guessing a role. On the client, resolves the active role
 * from localStorage if a QA switch has happened in this browser,
 * otherwise falls back to the default Owner user.
 *
 * Intended to be called from a client-only effect (post-mount), not
 * during initial render — see SessionProvider.tsx.
 */
export function getMockSession(): PhoenixSession {
  if (!isBrowser()) return MOCK_LOADING_SESSION;
  const activeRole = readStoredRole() ?? DEFAULT_MOCK_ROLE;
  return getMockSessionForRole(activeRole);
}

/**
 * QA-only helper: switches the active mock role and persists the choice
 * for this browser. Not a real role-management action — see
 * "Alpha Role Preview" in PlatformTopbar.tsx.
 */
export function switchMockUser(role: PhoenixUserRole): PhoenixUser {
  writeStoredRole(role);
  return getMockUserByRole(role);
}

export { DEFAULT_MOCK_ROLE };

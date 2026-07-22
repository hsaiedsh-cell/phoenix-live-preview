// ============================================================
// Phoenix Platform — Auth Domain Model (Types Only)
// PHX-PLATFORM-006 — Authentication & Workspace Access Foundation
// ------------------------------------------------------------
// Generic, backend-ready types describing a Phoenix session,
// user, and workspace context. Intentionally free of any mock
// data or UI behavior — see mock-session.ts for the Alpha mock
// implementation and access-control.ts for permission logic.
//
// `PhoenixUserRole` mirrors the `WorkspaceRole` values defined in
// docs/platform/PERMISSIONS_MODEL_PHX_PLATFORM_002.md. No new
// roles are introduced here.
// ============================================================

export type PhoenixUserRole = 'Owner' | 'Admin' | 'Reviewer' | 'Contributor' | 'Viewer' | 'Auditor';

export type PhoenixSessionStatus = 'authenticated' | 'unauthenticated' | 'loading';

export interface PhoenixUser {
  id: string;
  name: string;
  email: string;
  role: PhoenixUserRole;
  avatarInitials: string;
  workspaceIds: string[];
  defaultWorkspaceId: string;
}

export interface PhoenixWorkspaceContext {
  id: string;
  name: string;
  slug: string;
  plan: 'Alpha' | 'Professional' | 'Enterprise';
  status: 'Active' | 'Suspended' | 'Archived';
}

export interface PhoenixSession {
  status: PhoenixSessionStatus;
  user: PhoenixUser | null;
  activeWorkspace: PhoenixWorkspaceContext | null;
}

/** All roles, in the display order used by role selectors/switchers. */
export const PHOENIX_USER_ROLES: PhoenixUserRole[] = [
  'Owner',
  'Admin',
  'Reviewer',
  'Contributor',
  'Viewer',
  'Auditor',
];

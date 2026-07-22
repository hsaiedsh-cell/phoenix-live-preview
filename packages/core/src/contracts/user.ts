// ============================================================
// @phoenix/core/contracts — User
// PHX-PLATFORM-002 — Backend Contract Definition
// ============================================================

import type { BaseRecord } from './common';
import type { UserRole, WorkspaceRole } from './enums';

/**
 * User
 * Purpose: A platform account. Authentication implementation is out of scope
 * for this contract (see auth notes in API_CONTRACT and PERMISSIONS_MODEL docs) —
 * this interface describes the profile record only.
 */
export interface User extends BaseRecord {
  email: string;
  displayName: string;
  /** Platform-wide role. Independent of any per-workspace WorkspaceRole. */
  platformRole: UserRole;
  avatarUrl?: string;
  /** Last successful sign-in, for admin visibility. Null if never signed in (e.g. pending invite). */
  lastLoginAt: string | null;
}

/**
 * UserWorkspaceSummary
 * Purpose: Convenience read-model returned by GET /api/users/me — a user's
 * identity plus the list of workspaces they belong to and their role in each.
 * Not persisted directly; composed from User + WorkspaceMembership at read time.
 */
export interface UserWorkspaceSummary {
  user: User;
  workspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    role: WorkspaceRole;
  }>;
}

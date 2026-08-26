// ============================================================
// Phoenix Platform — Preview Auth Boundary (server-only)
// PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter
// ------------------------------------------------------------
// vercel-supabase-preview-mode counterpart to
// lib/auth/platform-auth.server.ts. Only ever imported from
// server-only modules — never from a 'use client' file.
//
// This mode has no separate Express backend, so there is no
// OidcJwtActorResolver / auth-identity.repository.ts to call over
// HTTP. Instead this file performs the SAME identity mapping and role
// resolution the backend would, directly against Supabase/Postgres,
// mirroring (not importing — different app/runtime):
//   - apps/backend/src/repositories/auth-identity.repository.ts
//     (resolveUserIdForIdentity — (provider, external_subject) lookup,
//     falling back to verified-email matching; never auto-creates a
//     user)
//   - apps/backend/src/repositories/auth.repository.ts
//     (getActorForWorkspace — resolves role + membership status)
//   - apps/backend/src/auth/permissions.ts (hasPermission — the exact
//     same role→permission matrix, copied verbatim so the two stay in
//     sync by inspection rather than silently drifting)
//
// Never trusts any role/workspace/org claim from Clerk — only a
// Clerk user id + verified email are read from the session; role and
// workspace membership are ALWAYS resolved from workspace_users via
// direct SQL, exactly as the backend does. See task brief's "Workspace
// role/permissions remain DB-derived. No roles/workspaces are trusted
// from Clerk claims." requirement.
// ============================================================

import { getPhoenixApiConfig } from '../api-config';
import { isPreviewDatabaseConfigured, getPreviewDatabasePool } from '../db/preview-db.server';

// ---------------------------------------------------------------------------
// Config status (mirrors platform-auth.server.ts's getServerAuthConfigStatus())
// ---------------------------------------------------------------------------

export interface PreviewAuthConfigStatus {
  publishableKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  databaseUrlConfigured: boolean;
  workspaceIdConfigured: boolean;
  fullyConfigured: boolean;
  missing: string[];
}

function isServerClerkSecretConfigured(): boolean {
  try {
    const value = process.env.CLERK_SECRET_KEY;
    return typeof value === 'string' && value.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolves the full vercel-supabase-preview configuration gate:
 * Clerk publishable key, Clerk secret key, PHOENIX_DATABASE_URL, and
 * the interim workspace-scope env var. Safe to call in any mode.
 */
export function getPreviewAuthConfigStatus(): PreviewAuthConfigStatus {
  const config = getPhoenixApiConfig();
  const publishableKeyConfigured = Boolean(config.clerkPublishableKey);
  const secretKeyConfigured = isServerClerkSecretConfigured();
  const databaseUrlConfigured = isPreviewDatabaseConfigured();
  const workspaceIdConfigured = Boolean(config.productionWorkspaceId);

  const missing: string[] = [];
  if (!publishableKeyConfigured) missing.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
  if (!secretKeyConfigured) missing.push('CLERK_SECRET_KEY');
  if (!databaseUrlConfigured) missing.push('PHOENIX_DATABASE_URL');
  if (!workspaceIdConfigured) missing.push('NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID');

  return {
    publishableKeyConfigured,
    secretKeyConfigured,
    databaseUrlConfigured,
    workspaceIdConfigured,
    fullyConfigured: publishableKeyConfigured && secretKeyConfigured && databaseUrlConfigured,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Clerk session state (mirrors platform-auth.server.ts's resolveProductionAuthState())
// ---------------------------------------------------------------------------

export type PreviewSessionState =
  | { mode: 'not-applicable' }
  | { mode: 'config-missing'; missing: string[] }
  | { mode: 'signed-out' }
  | { mode: 'signed-in'; clerkUserId: string; email: string | null; emailVerified: boolean };

/**
 * Resolves the current Clerk session for a Server Component, in
 * vercel-supabase-preview mode. Mirrors
 * platform-auth.server.ts's resolveProductionAuthState() exactly —
 * config (publishable + secret key) is confirmed present BEFORE
 * @clerk/nextjs/server is ever imported, so a missing secret key
 * returns 'config-missing', never an ambiguous SDK error conflated
 * with signed-out. PHOENIX_DATABASE_URL is intentionally NOT part of
 * this gate (a missing DB url is a separate, later failure — see
 * preview-api-client.server.ts, which surfaces it as its own
 * RealApiConfigError) so a signed-in Clerk user still sees "signed
 * in" even if the database happens to be misconfigured.
 */
export async function resolvePreviewSessionState(): Promise<PreviewSessionState> {
  const config = getPhoenixApiConfig();
  if (config.mode !== 'vercel-supabase-preview') {
    return { mode: 'not-applicable' };
  }

  const status = getPreviewAuthConfigStatus();
  if (!status.publishableKeyConfigured || !status.secretKeyConfigured) {
    return {
      mode: 'config-missing',
      missing: [
        ...(!status.publishableKeyConfigured ? ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] : []),
        ...(!status.secretKeyConfigured ? ['CLERK_SECRET_KEY'] : []),
      ],
    };
  }

  try {
    const { auth, currentUser } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    if (!userId) return { mode: 'signed-out' };

    const user = await currentUser();
    const primary = user?.emailAddresses.find((addr) => addr.id === user.primaryEmailAddressId);
    const email = primary?.emailAddress ?? user?.primaryEmailAddress?.emailAddress ?? null;
    const emailVerified = primary?.verification?.status === 'verified';

    return { mode: 'signed-in', clerkUserId: userId, email, emailVerified };
  } catch {
    // Clerk failures can contain request, identity, or token-adjacent data.
    // Keep the operational signal while never forwarding the raw SDK error.
    console.error('[preview-auth.server] Failed to resolve Clerk session.');
    return { mode: 'signed-out' };
  }
}

// ---------------------------------------------------------------------------
// Identity mapping — mirrors apps/backend/src/repositories/auth-identity.repository.ts
// ---------------------------------------------------------------------------

const CLERK_PROVIDER = 'clerk';

export type IdentityMappingResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'no_matching_user' | 'ambiguous_match' | 'email_not_verified' };

/**
 * Resolves a signed-in Clerk identity to a Phoenix `users.id`, per the
 * SAME mapping rules as the backend's resolveUserIdForIdentity():
 *   1. Try (provider='clerk', external_subject=clerkUserId) first.
 *   2. If unlinked, match an existing users.email — ONLY when the
 *      Clerk email is verified — and link it (INSERT auth_identities).
 *   3. Never auto-creates a new Phoenix user (per task brief's "Do not
 *      auto-provision users").
 *   4. Never assigns/infers workspace membership here — that remains
 *      resolvePreviewActor()'s job, resolved from workspace_users only.
 */
export async function resolvePreviewUserId(
  clerkUserId: string,
  email: string | null,
  emailVerified: boolean
): Promise<IdentityMappingResult> {
  const pool = getPreviewDatabasePool();

  const linked = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM auth_identities
     WHERE provider = $1 AND external_subject = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [CLERK_PROVIDER, clerkUserId]
  );

  if (linked.rows[0]) {
    await pool
      .query(
        `UPDATE auth_identities SET last_seen_at = now(), updated_at = now()
         WHERE provider = $1 AND external_subject = $2 AND deleted_at IS NULL`,
        [CLERK_PROVIDER, clerkUserId]
      )
      .catch(() => undefined); // best-effort touch; never blocks the read path
    return { ok: true, userId: linked.rows[0].user_id };
  }

  if (!email || !emailVerified) {
    return { ok: false, reason: email ? 'email_not_verified' : 'no_matching_user' };
  }

  const candidates = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email]
  );

  if (candidates.rows.length === 0) return { ok: false, reason: 'no_matching_user' };
  if (candidates.rows.length > 1) return { ok: false, reason: 'ambiguous_match' };

  const userId = candidates.rows[0].id;

  await pool.query(
    `INSERT INTO auth_identities (user_id, provider, external_subject, email, email_verified, last_seen_at)
     VALUES ($1, $2, $3, $4, true, now())
     ON CONFLICT (provider, external_subject) WHERE deleted_at IS NULL DO NOTHING`,
    [userId, CLERK_PROVIDER, clerkUserId, email]
  );

  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// Actor / role resolution — mirrors auth.repository.ts's getActorForWorkspace()
// ---------------------------------------------------------------------------

export type WorkspaceRole = 'Owner' | 'Admin' | 'Reviewer' | 'Contributor' | 'Viewer' | 'Auditor';
export type WorkspaceMembershipStatus = 'Active' | 'Invited' | 'Suspended';

export interface PreviewActor {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
  role: WorkspaceRole;
  membershipStatus: WorkspaceMembershipStatus;
}

/** Resolves the actor's role/membership for a specific workspace. Null if the user has no membership row there at all. */
export async function resolvePreviewActor(userId: string, workspaceId: string): Promise<PreviewActor | null> {
  const pool = getPreviewDatabasePool();
  const result = await pool.query<{
    user_id: string;
    email: string;
    display_name: string;
    workspace_id: string;
    role: string;
    status: string;
  }>(
    `SELECT
       u.id            AS user_id,
       u.email         AS email,
       u.display_name  AS display_name,
       wu.workspace_id AS workspace_id,
       wu.role         AS role,
       wu.status       AS status
     FROM users u
     JOIN workspace_users wu
       ON wu.user_id = u.id
      AND wu.workspace_id = $2
      AND wu.deleted_at IS NULL
     WHERE u.id = $1 AND u.deleted_at IS NULL
     LIMIT 1`,
    [userId, workspaceId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    email: row.email,
    name: row.display_name,
    workspaceId: row.workspace_id,
    role: row.role as WorkspaceRole,
    membershipStatus: row.status as WorkspaceMembershipStatus,
  };
}

// ---------------------------------------------------------------------------
// Permission matrix — copied verbatim from apps/backend/src/auth/permissions.ts
// so the two stay comparable by inspection. See that file for the full
// design rationale of each role's permission set.
// ---------------------------------------------------------------------------

export type Permission =
  | 'workspace.read'
  | 'assessment.read'
  | 'assessment.create'
  | 'assessment.submit'
  | 'evidence.read'
  | 'evidence.create'
  | 'evidence.update'
  | 'evidence.delete'
  | 'audit.read'
  | 'passport.issue'
  | 'certification.grant';

const ALL_PERMISSIONS: readonly Permission[] = [
  'workspace.read',
  'assessment.read',
  'assessment.create',
  'assessment.submit',
  'evidence.read',
  'evidence.create',
  'evidence.update',
  'evidence.delete',
  'audit.read',
  'passport.issue',
  'certification.grant',
];

const PERMISSION_MATRIX: Record<WorkspaceRole, readonly Permission[]> = {
  Owner: ALL_PERMISSIONS,
  Admin: ALL_PERMISSIONS,
  Reviewer: [
    'workspace.read',
    'assessment.read',
    'evidence.read',
    'evidence.create',
    'evidence.update',
    'evidence.delete',
    'passport.issue',
  ],
  Contributor: [
    'workspace.read',
    'assessment.read',
    'assessment.create',
    'assessment.submit',
    'evidence.read',
    'evidence.create',
    'evidence.update',
    'evidence.delete',
  ],
  Viewer: ['workspace.read', 'assessment.read', 'evidence.read'],
  Auditor: ['workspace.read', 'assessment.read', 'evidence.read', 'audit.read'],
};

/** True if `role` carries `permission`, under the exact same matrix the backend enforces. */
export function previewHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return PERMISSION_MATRIX[role].includes(permission);
}

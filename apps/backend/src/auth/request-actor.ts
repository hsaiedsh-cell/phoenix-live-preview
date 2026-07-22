// ============================================================
// Phoenix Backend — Request Actor Resolution & Permission Guards
// PHX-BACKEND-006 — Auth Session Foundation & Permission Boundary
// PHX-BACKEND-009 — Production Auth Preparation
// PHX-AUTH-002 — Hosted Auth Vendor Decision & Production Resolver
// ------------------------------------------------------------
// Request actor resolution. In dev-header mode (still the local/dev
// default) there is no token, cookie, session store, password, or
// external identity provider involved: the backend trusts a plain
// `x-phoenix-user-id: <uuid>` request header, verifies it against real
// `users`/`workspace_users` rows in the database, and discards the
// resolved actor once the request completes — nothing is cached or
// persisted across requests. See
// docs/backend/PHX_BACKEND_006_IMPLEMENTATION_REPORT.md § "Why this is
// not production auth" for that mode's rationale.
//
// In oidc-jwt mode (PHX-AUTH-002), the actor is instead resolved from a
// verified bearer token — see src/auth/token-verifier.ts and
// src/auth/actor-resolver.ts's OidcJwtActorResolver — but everything
// below this point (database membership lookup, Active-status check,
// hasPermission()) is identical in every mode; this file does not know
// or care which resolver produced a given userId.
//
// ---- Actor source is pluggable (PHX-BACKEND-009) -----------------------
// Every "read the caller's identity" step below goes through
// src/auth/actor-resolver.ts's ActorResolver abstraction instead of
// reading x-phoenix-user-id directly. In dev-header mode this produces
// byte-identical behavior to pre-PHX-BACKEND-009 — same header, same
// validation, same error codes/messages/ordering. In
// production-disabled or token-placeholder mode, every function below
// fails closed (401 AUTH_NOT_CONFIGURED or 501 AUTH_NOT_IMPLEMENTED
// respectively) before any database call. In oidc-jwt mode, a missing/
// malformed/invalid bearer token fails closed the same way (401
// AUTH_REQUIRED / AUTH_INVALID) before any database call.
//
// ---- Async-only, one source of truth (PHX-AUTH-002, Task 6) -----------
// PHX-BACKEND-009 kept getRequestUserId() synchronous (delegating to a
// resolveActorUserIdSync() helper) because every route's pre-check call
// site was written without `await`, and none of that sprint's three
// resolvers needed real I/O. OidcJwtActorResolver breaks that
// assumption — JWKS verification requires network I/O and cannot be
// done synchronously — so getRequestUserId() is now itself async and
// calls getActorResolver().resolveUserId(req) directly, exactly like
// resolveRequestActor() does below. Every route call site was updated
// to `await` this call (see routes/activity.ts, routes/audit.ts,
// routes/workspaces.ts, routes/assessments.ts) — all of them already
// run inside an async handler, so this is a same-shape `await`
// addition, not a control-flow change. There is now exactly one code
// path that resolves an actor source, used by both entry points — see
// docs/auth/PHX_AUTH_002_IMPLEMENTATION_REPORT.md §"Sync pre-check
// resolution" for the full before/after and rationale.
//
// ---- Response ordering (unchanged from PHX-BACKEND-006/009) ---------
// 1. Missing/invalid actor source          → 401/400/501/503, mode-dependent (before DB check)
// 2. requireDatabase() failure             → 503 DATABASE_UNAVAILABLE
// 3. Unknown user id                       → 401 AUTH_REQUIRED
// 4. No membership / non-Active membership → 403 FORBIDDEN
// 5. Role lacks permission                 → 403 FORBIDDEN
// 6. Success                               → returns RequestActor, writes nothing
//
// Every function below writes at most one structured ApiFailure to
// `res` and returns `null` on failure — callers must `return`
// immediately when `null` comes back, exactly like the existing
// validation/route-params.ts and middleware/database-required.ts
// helpers this module is modeled after.
// ============================================================

import type { Request, Response } from 'express';
import { ApiErrorCodes, failure } from '../contracts/api-response';
import { getRequestId } from '../lib/http';
import { requireDatabase } from '../middleware/database-required';
import { getActorForWorkspace, getUserById } from '../repositories/auth.repository';
import { hasPermission } from './permissions';
import type { Permission, RequestActor } from './auth-types';
import { getActorResolver, type AuthResolution } from './actor-resolver';

const USER_ID_HEADER = 'x-phoenix-user-id';

/** Writes the structured ApiFailure a failed AuthResolution describes. */
function writeAuthResolutionFailure(
  res: Response,
  resolution: Extract<AuthResolution, { ok: false }>
): void {
  res
    .status(resolution.status)
    .json(failure(resolution.code, resolution.message, getRequestId(res), resolution.details));
}

/**
 * Reads and validates the caller's actor-source header/credential in
 * isolation (no database call), via the current PHOENIX_AUTH_MODE's
 * resolver. In dev-header mode this is exactly the pre-PHX-BACKEND-009
 * `x-phoenix-user-id` check (missing → 401 AUTH_REQUIRED; malformed →
 * 400 VALIDATION_ERROR). In production-disabled or token-placeholder
 * mode this always fails (401 AUTH_NOT_CONFIGURED / 501
 * AUTH_NOT_IMPLEMENTED) without inspecting any header value. In
 * oidc-jwt mode this verifies the bearer token (401 AUTH_REQUIRED if
 * missing, 401 AUTH_INVALID if verification/mapping fails, 503
 * AUTH_NOT_CONFIGURED if the mode's config is incomplete).
 *
 * Callers must `return` immediately when this resolves to `null` — the
 * response has already been written. This mirrors validation/
 * route-params.ts's parseWorkspaceId()-style contract exactly, except
 * now async (see file header, "Async-only, one source of truth") —
 * every call site awaits this.
 */
export async function getRequestUserId(req: Request, res: Response): Promise<string | null> {
  const resolution = await getActorResolver().resolveUserId(req);

  if (!resolution.ok) {
    writeAuthResolutionFailure(res, resolution);
    return null;
  }

  return resolution.userId;
}

/**
 * Resolves a full RequestActor for the request, scoped to
 * `workspaceId`. Performs, in order:
 *   1. getActorResolver().resolveUserId(req) — mode-dependent failure
 *      as described above
 *   2. requireDatabase() — 503 on failure
 *   3. getUserById() — 401 AUTH_REQUIRED if the user id does not exist
 *      (an unknown actor id is treated the same as "unauthenticated",
 *      not as a 404 — see file header)
 *   4. getActorForWorkspace() — 403 FORBIDDEN if there is no
 *      membership row at all, OR the membership row exists but is not
 *      Active (Suspended/Invited)
 *
 * Returns the resolved RequestActor on success, or `null` after
 * writing the appropriate structured failure. Callers must `return`
 * immediately when `null` comes back.
 */
export async function resolveRequestActor(
  req: Request,
  res: Response,
  workspaceId: string
): Promise<RequestActor | null> {
  const resolution = await getActorResolver().resolveUserId(req);
  if (!resolution.ok) {
    writeAuthResolutionFailure(res, resolution);
    return null;
  }
  const userId = resolution.userId;

  if (!(await requireDatabase(res))) return null;

  const user = await getUserById(userId);
  if (!user) {
    res
      .status(401)
      .json(
        failure(
          ApiErrorCodes.AUTH_REQUIRED,
          `No user was found for the provided ${USER_ID_HEADER}.`,
          getRequestId(res)
        )
      );
    return null;
  }

  const actor = await getActorForWorkspace(userId, workspaceId);
  if (!actor || actor.membershipStatus !== 'Active') {
    res
      .status(403)
      .json(
        failure(
          ApiErrorCodes.FORBIDDEN,
          actor
            ? `User membership in this workspace is not Active (status: ${actor.membershipStatus}).`
            : 'User is not a member of this workspace.',
          getRequestId(res)
        )
      );
    return null;
  }

  return actor;
}

/**
 * Alias for resolveRequestActor() — present as a separate export to
 * match the PHX-BACKEND-006 task brief's naming (`requireActor`) for
 * routes that only need an authenticated, Active-member actor without
 * a specific permission check (none currently — every implemented
 * route in this sprint uses requirePermission() below — but this is
 * kept available for future stub-to-implemented routes that only need
 * "is this a real, active member" without a finer-grained permission).
 */
export async function requireActor(
  req: Request,
  res: Response,
  workspaceId: string
): Promise<RequestActor | null> {
  return resolveRequestActor(req, res, workspaceId);
}

/**
 * Resolves the request actor (see resolveRequestActor()) and then
 * enforces that the actor's role carries `permission`. Writes 403
 * FORBIDDEN (distinct message from the membership-status 403 above)
 * if the role lacks the permission. Returns the actor on success, or
 * `null` after writing the appropriate failure — callers must `return`
 * immediately when `null` comes back.
 */
export async function requirePermission(
  req: Request,
  res: Response,
  workspaceId: string,
  permission: Permission
): Promise<RequestActor | null> {
  const actor = await resolveRequestActor(req, res, workspaceId);
  if (!actor) return null;

  if (!hasPermission(actor.role, permission)) {
    res
      .status(403)
      .json(
        failure(
          ApiErrorCodes.FORBIDDEN,
          `Role "${actor.role}" does not have permission "${permission}".`,
          getRequestId(res)
        )
      );
    return null;
  }

  return actor;
}

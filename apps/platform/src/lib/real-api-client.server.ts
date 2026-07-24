// ============================================================
// Phoenix Platform — Real API Client (Server Component reads)
// PHX-PLATFORM-011-R1 — Server-Side Production Auth Token & Live Backend
//   Verification Fix
// ------------------------------------------------------------
// Server Component / server-only counterpart to real-api-client.client.ts.
// This is the file platform-data-source.ts imports its `realGet*`
// functions from — every migrated page (`/dashboard`, `/assessments`,
// `/assessments/[id]`, `/settings`) is a Server Component, so this file
// (not the client one) is what actually runs in production this sprint.
//
// production-auth header resolution here uses
// auth/platform-auth.server.ts's `getServerBackendToken()`, which reads
// the request's Clerk session server-side via `@clerk/nextjs/server`'s
// `auth()` — the correct, working replacement for the old (broken)
// behavior of calling the browser-only `getBackendAuthHeaders()` from a
// Server Component. See real-api-client.ts's header comment for the
// full bug history.
//
// This file MUST NOT be imported from any 'use client' component.
// It imports auth/platform-auth.server.ts, which itself dynamically
// imports '@clerk/nextjs/server' — pulling either into a client bundle
// would be a Next.js server/client boundary violation. Client Component
// reads (not used by any page yet) belong in real-api-client.client.ts
// instead.
// ============================================================

import { getPhoenixApiConfig } from './api-config';
import { getServerAuthConfigStatus, getServerBackendToken } from './auth/platform-auth.server';
import {
  realFetch,
  RealApiConfigError,
  RealApiAuthRequiredError,
  type BackendPaginatedResult,
  type BackendWorkspace,
  type BackendAssessment,
  type BackendActivityItem,
  type BackendAuditRecord,
  type BackendAssessmentDetail,
  type BackendEvidenceItem,
  type BackendScore,
  type BackendReport,
} from './real-api-client';

/**
 * Resolves the request headers appropriate for the CURRENT api mode,
 * from a SERVER context. Mirrors real-api-client.client.ts's
 * resolveClientAuthHeaders() but uses the server-side Clerk session
 * (auth/platform-auth.server.ts) instead of the browser one.
 *
 * - real-dev: { X-Phoenix-User-Id } — never an Authorization header.
 * - production-auth: checks getServerAuthConfigStatus().fullyConfigured
 *   FIRST (mirroring the config-then-token-getter order the original
 *   client-side resolver used) so a missing Clerk config throws
 *   RealApiConfigError rather than being conflated with "signed out."
 *   Only once config is confirmed present does it call
 *   getServerBackendToken() (real `@clerk/nextjs/server` `auth()` call);
 *   throws RealApiAuthRequiredError if no session/token is available.
 *   Never sends X-Phoenix-User-Id in this branch.
 * - mock / real-disabled: throws RealApiConfigError — callers in these
 *   modes should never reach this function at all (see platform-data-source.ts,
 *   which returns a 'mock'/'not-wired' status before ever calling a
 *   real* function).
 */
async function resolveServerAuthHeaders(): Promise<Record<string, string>> {
  const config = getPhoenixApiConfig();

  if (config.mode === 'real-dev') {
    if (config.isMisconfigured || !config.devUserId) {
      throw new RealApiConfigError(
        'real-dev mode requires NEXT_PUBLIC_PHOENIX_BACKEND_URL and NEXT_PUBLIC_PHOENIX_DEV_USER_ID.'
      );
    }
    return { 'X-Phoenix-User-Id': config.devUserId };
  }

  if (config.mode === 'production-auth') {
    // Check config status before attempting a real Clerk server call —
    // this is what distinguishes a clean "config-missing" from an
    // ambiguous SDK error, exactly as platform-auth.server.ts's own
    // resolveProductionAuthState() does for the page-level auth gate.
    const serverStatus = getServerAuthConfigStatus();
    if (!serverStatus.fullyConfigured) {
      throw new RealApiConfigError(
        `production-auth mode requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, and NEXT_PUBLIC_PHOENIX_BACKEND_URL. Missing: ${serverStatus.missing.join(', ')}.`
      );
    }

    const result = await getServerBackendToken();
    if (!result.ok) {
      // Config is confirmed present (checked above) — a failure here
      // means no active Clerk session for this request (signed out, or
      // the session cookie wasn't forwarded), never a config problem.
      // The token value itself is never logged — only result.ok is
      // branched on here.
      throw new RealApiAuthRequiredError();
    }
    // Never X-Phoenix-User-Id in production-auth — Bearer token only.
    return { Authorization: `Bearer ${result.token}` };
  }

  throw new RealApiConfigError(`Server-side real reads are not reachable in '${config.mode}' mode.`);
}

async function serverFetch<T>(path: string): Promise<T> {
  const headers = await resolveServerAuthHeaders();
  return realFetch<T>(path, headers);
}

// ---------------------------------------------------------------------------
// Public read functions — call these from Server Components only
// (pages, or platform-data-source.ts, which is itself only called from
// Server Component pages this sprint).
// ---------------------------------------------------------------------------

export async function realGetWorkspace(workspaceId: string): Promise<BackendWorkspace> {
  return serverFetch<BackendWorkspace>(`/api/workspaces/${encodeURIComponent(workspaceId)}`);
}

export async function realGetAssessments(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendAssessment>> {
  return serverFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/assessments`);
}

export async function realGetWorkspaceActivity(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendActivityItem>> {
  return serverFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/activity`);
}

export async function realGetWorkspaceAuditRecords(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendAuditRecord>> {
  return serverFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/audit-records`);
}

/**
 * GET /api/assessments/:assessmentId. Returns `score: null` when the
 * assessment has not been scored yet (a 200, not a 404 — see
 * assessments.ts route header).
 */
export async function realGetAssessmentDetail(assessmentId: string): Promise<BackendAssessmentDetail> {
  return serverFetch<BackendAssessmentDetail>(`/api/assessments/${encodeURIComponent(assessmentId)}`);
}

/** GET /api/assessments/:assessmentId/evidence. */
export async function realGetAssessmentEvidence(
  assessmentId: string
): Promise<BackendPaginatedResult<BackendEvidenceItem>> {
  return serverFetch(`/api/assessments/${encodeURIComponent(assessmentId)}/evidence`);
}

/**
 * GET /api/assessments/:assessmentId/score. Returns `null` (not an
 * error) when the assessment exists but has not been scored yet —
 * callers must render "No PBRS score available yet." rather than
 * treating null as an error state.
 */
export async function realGetAssessmentScore(assessmentId: string): Promise<BackendScore | null> {
  return serverFetch<BackendScore | null>(`/api/assessments/${encodeURIComponent(assessmentId)}/score`);
}

// ---------------------------------------------------------------------------
// PHX-REPORTS-004 — real-dev/production-auth live Reports reads.
// ---------------------------------------------------------------------------

/** GET /api/workspaces/:workspaceId/reports. */
export async function realGetReports(workspaceId: string): Promise<BackendPaginatedResult<BackendReport>> {
  return serverFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/reports`);
}

/** GET /api/reports/:reportId. */
export async function realGetReportDetail(reportId: string): Promise<BackendReport> {
  return serverFetch<BackendReport>(`/api/reports/${encodeURIComponent(reportId)}`);
}

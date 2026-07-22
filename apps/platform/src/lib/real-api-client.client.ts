// ============================================================
// Phoenix Platform — Real API Client (Client Component reads)
// PHX-PLATFORM-011-R1 — Server-Side Production Auth Token & Live Backend
//   Verification Fix
// ------------------------------------------------------------
// Client Component counterpart to real-api-client.server.ts. NOT
// called by any platform page this sprint — every migrated read page
// (`/dashboard`, `/assessments`, `/assessments/[id]`, `/settings`) is a
// Server Component and uses real-api-client.server.ts instead. This
// file exists as a ready, correct seam for a FUTURE client-side fetch
// (e.g. a client-side refresh button, polling widget, or infinite-scroll
// list), so that future work has an obvious, already-correct place to
// import from instead of either reaching for real-api-client.server.ts
// by mistake (which would pull '@clerk/nextjs/server' into a client
// bundle — a real Next.js server/client boundary violation) or
// reinventing header resolution inline in a component.
//
// production-auth header resolution here uses
// auth/platform-auth.client.ts's `getBackendAuthHeaders()`, which reads
// `window.Clerk.session.getToken()` — correct for a Client Component,
// where a real browser Clerk session exists. This is the same function
// real-api-client.ts (pre-R1) called unconditionally, which was the
// actual bug: that behavior is only correct here, in a client-only
// file, never from a Server Component.
//
// This file MUST NOT be imported from a Server Component data loader
// (pages, platform-data-source.ts). It has no 'use client' directive
// itself (it exports plain async functions, not a component — the
// directive isn't meaningful on a non-component module), but it
// imports auth/platform-auth.client.ts, which reads `window` and is
// only meaningful when actually executed in the browser.
// ============================================================

import { getPhoenixApiConfig } from './api-config';
import { getBackendAuthHeaders } from './auth/platform-auth.client';
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
} from './real-api-client';

/**
 * Resolves the request headers appropriate for the CURRENT api mode,
 * from a CLIENT (browser) context. Mirrors
 * real-api-client.server.ts's resolveServerAuthHeaders() but uses the
 * browser Clerk session (auth/platform-auth.client.ts) instead of the
 * server one.
 */
async function resolveClientAuthHeaders(): Promise<Record<string, string>> {
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
    if (config.isMisconfigured) {
      // Client-safe check only (api-config.ts never reads
      // CLERK_SECRET_KEY) — good enough to catch the common
      // missing-publishable-key/backend-URL case from the browser.
      // The authoritative three-var check is server-side
      // (getServerAuthConfigStatus()), used by
      // real-api-client.server.ts and the page-level auth gate.
      throw new RealApiConfigError(
        'production-auth mode requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, and NEXT_PUBLIC_PHOENIX_BACKEND_URL.'
      );
    }
    const result = await getBackendAuthHeaders();
    if (!result.ok) {
      throw new RealApiAuthRequiredError();
    }
    // Never X-Phoenix-User-Id in production-auth — Bearer token only.
    return { Authorization: `Bearer ${result.token}` };
  }

  throw new RealApiConfigError(`Client-side real reads are not reachable in '${config.mode}' mode.`);
}

async function clientFetch<T>(path: string): Promise<T> {
  const headers = await resolveClientAuthHeaders();
  return realFetch<T>(path, headers);
}

// ---------------------------------------------------------------------------
// Public read functions — call these from Client Components only. No
// page calls these yet this sprint (see file header).
// ---------------------------------------------------------------------------

export async function realGetWorkspace(workspaceId: string): Promise<BackendWorkspace> {
  return clientFetch<BackendWorkspace>(`/api/workspaces/${encodeURIComponent(workspaceId)}`);
}

export async function realGetAssessments(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendAssessment>> {
  return clientFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/assessments`);
}

export async function realGetWorkspaceActivity(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendActivityItem>> {
  return clientFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/activity`);
}

export async function realGetWorkspaceAuditRecords(
  workspaceId: string
): Promise<BackendPaginatedResult<BackendAuditRecord>> {
  return clientFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/audit-records`);
}

export async function realGetAssessmentDetail(assessmentId: string): Promise<BackendAssessmentDetail> {
  return clientFetch<BackendAssessmentDetail>(`/api/assessments/${encodeURIComponent(assessmentId)}`);
}

export async function realGetAssessmentEvidence(
  assessmentId: string
): Promise<BackendPaginatedResult<BackendEvidenceItem>> {
  return clientFetch(`/api/assessments/${encodeURIComponent(assessmentId)}/evidence`);
}

export async function realGetAssessmentScore(assessmentId: string): Promise<BackendScore | null> {
  return clientFetch<BackendScore | null>(`/api/assessments/${encodeURIComponent(assessmentId)}/score`);
}

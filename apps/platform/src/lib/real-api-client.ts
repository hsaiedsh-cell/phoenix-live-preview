// ============================================================
// Phoenix Platform — Real API Client (Shared)
// PHX-PLATFORM-009 — Backend Integration Readiness Layer (disabled skeleton)
// PHX-LIVE-001     — Platform Live Integration Readiness (real-dev reads)
// PHX-PLATFORM-010 — Clerk Platform Auth Integration (production-auth reads)
// PHX-PLATFORM-011 — Live Read Migration for Production Auth
// PHX-PLATFORM-011-R1 — Server-Side Production Auth Token & Live Backend
//   Verification Fix
// ------------------------------------------------------------
// PHX-PLATFORM-011-R1 SPLIT: this file used to also resolve auth
// headers (including calling the browser-only `getBackendAuthHeaders()`
// from `auth/platform-auth.client.ts`) and export every `realGet*` read
// function. That meant every Server Component page migrated in
// PHX-PLATFORM-011 (`/dashboard`, `/assessments`, `/assessments/[id]`,
// `/settings`) was, in production-auth mode, calling a function that
// reads `window.Clerk.session.getToken()` — which does not exist on the
// server. Every production-auth live read from a Server Component was
// therefore *always* failing with `auth-required`, even with a valid
// signed-in Clerk session, because `getBackendAuthHeaders()`'s own
// `typeof window === 'undefined'` guard (correctly, by design) returns
// `{ ok: false }` outside the browser.
//
// Fixed (per the task's preferred Option A) by splitting this file into
// three:
//
//   real-api-client.ts         (this file) — environment-agnostic
//                              shared types, error classes, the
//                              disabled/misconfigured/auth-required
//                              response helpers, and `realFetch<T>()`,
//                              which now takes ALREADY-RESOLVED headers
//                              as a parameter instead of resolving them
//                              itself. Contains no Clerk import, no
//                              `window` reference, and no
//                              `auth/platform-auth.{client,server}`
//                              import — safe to import from anywhere.
//   real-api-client.server.ts — Server Component / server-only reads.
//                              Resolves production-auth headers via
//                              `auth/platform-auth.server.ts`'s
//                              `getServerBackendToken()` (real Clerk
//                              server-side session, via `auth()` from
//                              `@clerk/nextjs/server`). This is what
//                              `platform-data-source.ts` (called only
//                              from Server Component pages) now
//                              imports.
//   real-api-client.client.ts — Client Component reads, for future use.
//                              Resolves production-auth headers via
//                              `auth/platform-auth.client.ts`'s
//                              `getBackendAuthHeaders()` (browser
//                              `window.Clerk.session.getToken()`). Not
//                              called by any page this sprint — no
//                              platform page reads data from a Client
//                              Component yet — but the seam exists so a
//                              future client-side fetch has a ready,
//                              correct boundary instead of reaching for
//                              the server file by mistake.
//
// Mode-aware behavior (identical across both split files, just via
// different header-resolution paths):
//
//   mock             No network call is ever made.
//   real-dev         Sends X-Phoenix-User-Id (dev header, no auth) —
//                    exactly as PHX-LIVE-001 documented. Never sends
//                    an Authorization header. Same env var
//                    (NEXT_PUBLIC_PHOENIX_DEV_USER_ID) works from
//                    either the server or client file.
//   real-disabled    No network call — resolves the documented
//                    "disabled" response (PHX-PLATFORM-009 behavior,
//                    unchanged).
//   production-auth  Sends `Authorization: Bearer <token>`. NEVER
//                    sends X-Phoenix-User-Id. If Clerk config is
//                    missing, throws RealApiConfigError
//                    (config-missing). If config is present but no
//                    session/token is available, throws
//                    RealApiAuthRequiredError (auth-required). Never
//                    falls back to mock or real-dev, never retries
//                    unauthenticated.
//
// PHX-PLATFORM-011 fix (unchanged by this R1): realFetch<T>() parses
// the backend's `{ ok, data, error, requestId }` envelope (see
// apps/backend/src/contracts/api-response.ts) rather than assuming
// the raw JSON body IS the payload.
//
// Governance actions (issuePassport / revokePassport / grantCertification /
// revokeCertification) are NOT wired to a real network call in ANY mode
// this sprint — see api-client.ts, which still only special-cases
// mode === 'mock' for those four and returns the disabled-response for
// everything else (real-dev, real-disabled, production-auth alike).
//
// Do not import sample-data.ts here — this file has no knowledge of mock
// fixtures; that boundary belongs to mock-api-client.ts / api-adapters.ts.
// ============================================================

import { getPhoenixApiConfig } from './api-config';
import type { PhoenixApiResponse, PhoenixApiRequestOptions } from './api-types';

// ---------------------------------------------------------------------------
// Disabled-response helper (unchanged from PHX-PLATFORM-009; used for
// real-disabled mode and for every governance action outside mock mode)
// ---------------------------------------------------------------------------

export function createDisabledRealApiError<T = never>(endpoint: string): PhoenixApiResponse<T> {
  return {
    ok: false,
    error: {
      code: 'REAL_API_DISABLED',
      message: 'Real API mode is not enabled. Mock mode remains the active runtime for this action.',
      details: { endpoint },
    },
    requestId: `disabled-${Date.now()}`,
    mode: 'real-disabled',
  };
}

export async function disabledRealApiCall<T = never>(
  endpoint: string,
  _options?: PhoenixApiRequestOptions
): Promise<PhoenixApiResponse<T>> {
  return createDisabledRealApiError<T>(endpoint);
}

/** Clear, typed "sign in required" response for production-auth mode with no token. */
export function createAuthRequiredError<T = never>(endpoint: string): PhoenixApiResponse<T> {
  return {
    ok: false,
    error: {
      code: 'AUTH_REQUIRED',
      message: 'Sign-in required. No Clerk session token is available for this request.',
      details: { endpoint },
    },
    requestId: `auth-required-${Date.now()}`,
    mode: 'production-auth',
  };
}

/** Real-dev / production-auth misconfiguration response — never falls back silently. */
export function createMisconfiguredError<T = never>(endpoint: string, reason: string): PhoenixApiResponse<T> {
  return {
    ok: false,
    error: {
      code: 'API_MODE_MISCONFIGURED',
      message: `Real API mode is misconfigured: ${reason}`,
      details: { endpoint },
    },
    requestId: `misconfigured-${Date.now()}`,
    mode: 'real-disabled',
  };
}

// ---------------------------------------------------------------------------
// Typed read-side errors used by realFetch() / the real* read helpers below.
// These are additive to (not a replacement for) the PhoenixApiResponse
// envelope above — read helpers throw; write/governance call sites through
// api-client.ts continue to use the envelope form.
// ---------------------------------------------------------------------------

export class RealApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RealApiError';
  }
}

export class RealDevUnsupportedError extends Error {
  constructor(action: string) {
    super(`Action not supported in this API mode: ${action}. Falling back to mock.`);
    this.name = 'RealDevUnsupportedError';
  }
}

export class RealApiConfigError extends Error {
  constructor(message: string) {
    super(`[real-api-client] Configuration error: ${message}`);
    this.name = 'RealApiConfigError';
  }
}

export class RealApiAuthRequiredError extends Error {
  constructor() {
    super('Sign-in required. No Clerk session token is available for this request.');
    this.name = 'RealApiAuthRequiredError';
  }
}

// ---------------------------------------------------------------------------
// GET-only fetch helper shared by real-dev and production-auth.
//
// PHX-PLATFORM-011-R1: this function used to resolve its own auth
// headers internally (calling the browser-only getBackendAuthHeaders()
// unconditionally for production-auth). It now takes ALREADY-RESOLVED
// headers as a parameter — real-api-client.server.ts and
// real-api-client.client.ts are each responsible for resolving the
// correct headers for their own environment (server-side Clerk token
// vs. browser Clerk token) and pass them in here. This file itself
// never imports @clerk/nextjs, auth/platform-auth.server.ts, or
// auth/platform-auth.client.ts, and never references `window` — it is
// safe to import from any context.
// ---------------------------------------------------------------------------

/** Shape of every Phoenix backend response — see apps/backend/src/contracts/api-response.ts. */
interface BackendEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
  requestId?: string;
}

/** Maps a backend error code (ApiErrorCodes) to this file's typed RealApiError. Falls back to the HTTP status when the code is unrecognized. */
function backendErrorToRealApiError(httpStatus: number, envelopeError: BackendEnvelope<unknown>['error']): RealApiError {
  const code = envelopeError?.code ?? 'BACKEND_ERROR';
  const message = envelopeError?.message ?? `Backend error ${httpStatus}`;
  switch (code) {
    case 'VALIDATION_ERROR':
      return new RealApiError(httpStatus || 400, 'VALIDATION_ERROR', `Validation error: ${message}`);
    case 'AUTH_REQUIRED':
      return new RealApiError(httpStatus || 401, 'AUTH_REQUIRED', `Auth required: ${message}`);
    case 'FORBIDDEN':
      return new RealApiError(httpStatus || 403, 'PERMISSION_DENIED', `Permission denied: ${message}`);
    case 'NOT_FOUND':
      return new RealApiError(httpStatus || 404, 'NOT_FOUND', `Not found: ${message}`);
    case 'CONFLICT':
      return new RealApiError(httpStatus || 409, 'CONFLICT', `Conflict: ${message}`);
    case 'DATABASE_UNAVAILABLE':
      return new RealApiError(httpStatus || 503, 'DB_UNAVAILABLE', `Database unavailable: ${message}`);
    case 'NOT_IMPLEMENTED':
      return new RealApiError(httpStatus || 501, 'NOT_IMPLEMENTED', `Not implemented: ${message}`);
    default:
      return new RealApiError(httpStatus || 500, 'BACKEND_ERROR', `Backend error ${httpStatus}: ${message}`);
  }
}

/**
 * Fetches `path` from the configured backend using ALREADY-RESOLVED
 * `authHeaders` (the caller — real-api-client.server.ts or
 * real-api-client.client.ts — is responsible for resolving those
 * correctly for its own environment before calling this). Exported so
 * both split files can share one request/envelope-parsing
 * implementation instead of duplicating it.
 */
export async function realFetch<T>(path: string, authHeaders: Record<string, string>): Promise<T> {
  const { baseUrl } = getPhoenixApiConfig();
  if (!baseUrl) {
    throw new RealApiConfigError('No backend URL configured (NEXT_PUBLIC_PHOENIX_BACKEND_URL).');
  }

  const url = `${baseUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      // No cookies/credentials in either real-dev or production-auth —
      // production-auth relies on the Authorization header, not cookies.
      credentials: 'omit',
      // PHX-PLATFORM-011: without this, Next.js's fetch-level caching can
      // treat this as a static, build-time-cacheable request — which
      // would bake a single snapshot (or a build-time error state, if no
      // backend was reachable during the build) into the page forever.
      // Live reads must hit the backend on every request.
      cache: 'no-store',
    });
  } catch {
    throw new RealApiError(0, 'BACKEND_UNAVAILABLE', `Backend unavailable at ${baseUrl}. Is it running?`);
  }

  // PHX-PLATFORM-011: every Phoenix backend response — success or
  // failure, any HTTP status — is the { ok, data, error, requestId }
  // envelope from apps/backend/src/contracts/api-response.ts. Parse it
  // once here rather than assuming a 2xx status means the JSON body IS
  // the payload.
  let envelope: BackendEnvelope<T> | null = null;
  try {
    envelope = (await response.json()) as BackendEnvelope<T>;
  } catch {
    // Non-JSON body. Only acceptable on a genuine non-2xx transport
    // failure (e.g. a proxy/gateway error page) — still surfaced as a
    // typed error, never treated as an empty success.
    throw new RealApiError(
      response.status,
      response.ok ? 'BACKEND_ERROR' : 'BACKEND_ERROR',
      `Backend returned a non-JSON response (status ${response.status}).`
    );
  }

  if (!response.ok || !envelope.ok) {
    throw backendErrorToRealApiError(response.status, envelope.error);
  }

  return envelope.data as T;
}

// ---------------------------------------------------------------------------
// Backend payload types.
//
// PHX-PLATFORM-011-R1 CORRECTION: live verification against a real,
// seeded backend (apps/backend from PHX-AUTH-002-R1 — see
// docs/platform/PHX_PLATFORM_011_R1_QA_REPORT.md) found that EVERY
// type below except BackendEvidenceItem/BackendScore/
// BackendDimensionScore/BackendDerivedSignal was wrong. PHX-PLATFORM-011
// wrote these by reading the raw SQL `SELECT ... AS snake_case` column
// aliases in each repository query and assuming that was the JSON shape
// returned to the client. It is not — every repository function maps
// its SQL row to a camelCase record type before the route handler
// passes it to `success()`, and the workspace/assessment-list shapes in
// particular have DIFFERENT fields entirely from what PHX-PLATFORM-011
// assumed (there is no `title`/`created_by` on an assessment list row;
// the list endpoint actually DOES include `overallScore`/`grade`/
// `riskLevel` per row, which PHX-PLATFORM-011's implementation report
// incorrectly said was unavailable). Every type below is now mirrored
// directly from the actual repository interfaces
// (apps/backend/src/repositories/{workspaces,assessments,activity,
// audit}.repository.ts), not from SQL column aliases.
// ---------------------------------------------------------------------------

export interface BackendPaginatedResult<T> {
  items: T[];
  total: number;
  cursor: string | null;
}

/** GET /api/workspaces/:workspaceId — mirrors repositories/workspaces.repository.ts's WorkspaceRecord. */
export interface BackendWorkspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  settings: unknown;
  status: 'Active';
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of GET /api/workspaces/:workspaceId/assessments — mirrors
 * repositories/assessments.repository.ts's AssessmentListItem. Note
 * this DOES include a score summary (overallScore/grade/riskLevel) when
 * the assessment has been scored — PHX-PLATFORM-011 incorrectly assumed
 * this endpoint returned no score data at all.
 */
export interface BackendAssessment {
  assessmentId: string;
  assetId: string;
  assetName: string;
  assetType: string;
  status: string;
  overallScore: number | null;
  grade: string | null;
  riskLevel: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One row of GET /api/workspaces/:workspaceId/activity — mirrors repositories/activity.repository.ts's ActivityLogRecord. */
export interface BackendActivityItem {
  id: string;
  workspaceId: string;
  type: string;
  actorUserId: string | null;
  actorDisplayName: string;
  /** Pre-composed, human-readable summary sentence — there is no separate action/entity_type pair to assemble one from. */
  summary: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
}

/** One row of GET /api/workspaces/:workspaceId/audit-records — mirrors repositories/audit.repository.ts's AuditRecord. */
export interface BackendAuditRecord {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** `{ field: [before, after] }` — already tuple-shaped at runtime, per audit.repository.ts's file header. */
  changes: Record<string, [unknown, unknown]>;
  context: string | null;
  createdAt: string;
}

interface BackendReadinessResult {
  ok?: boolean;
  auth?: { mode: string; status: string; productionSafe: boolean; provider?: string };
  database?: { status: string };
}

// ---- Assessment detail / evidence / score shapes ----
// Mirrored from apps/backend/src/routes/assessments.ts and
// repositories/assessments.repository.ts + evidence.repository.ts. These
// are read-only display shapes — no PBRS scoring logic is computed here;
// `score.summary` is the exact PBRSScore JSON the backend already
// persisted (see @phoenix/core's PBRSScore / PBRSScoreRecord contracts),
// passed through as-is.

/** The `assessment` field of GET /api/assessments/:assessmentId — mirrors repositories/assessments.repository.ts's AssessmentDetail. No `title` field exists here; the asset's `name` (see BackendAssessmentAssetSummary) is the closest display name. */
export interface BackendAssessmentDetailRecord {
  id: string;
  workspaceId: string;
  assetId: string;
  assetVersionId: string;
  status: string;
  requestedByUserId: string;
  assignedReviewerUserId: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  scoreId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The `asset` field of GET /api/assessments/:assessmentId — mirrors AssessmentAssetSummary. */
export interface BackendAssessmentAssetSummary {
  id: string;
  name: string;
  type: string;
  department: string;
  status: string;
}

/** The `workspace` field of GET /api/assessments/:assessmentId — a smaller summary than BackendWorkspace, mirrors AssessmentWorkspaceSummary. */
export interface BackendAssessmentWorkspaceSummary {
  id: string;
  name: string;
  slug: string;
}

export interface BackendAssessmentDetail {
  assessment: BackendAssessmentDetailRecord;
  asset: BackendAssessmentAssetSummary;
  workspace: BackendAssessmentWorkspaceSummary;
  score: BackendScore | null;
  steps: unknown[];
}

export interface BackendEvidenceItem {
  id: string;
  assessmentId: string;
  type: string;
  title: string;
  note: string | null;
  fileUrl: string | null;
  externalUrl: string | null;
  uploadedByUserId: string;
  relatedDimension: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackendDimensionScore {
  dimension: string;
  value: number;
  evidenceIds: string[];
  isOverridden: boolean;
  overrideReason: string | null;
}

export interface BackendDerivedSignal {
  key: string;
  valueText: string | null;
  valueNumeric: number | null;
}

/** PBRSScore summary JSON exactly as @phoenix/core / @phoenix/pbrs produced it — passed through unmodified. */
export interface BackendScoreSummary {
  overall: number;
  grade: string;
  tier: string;
  dimensions: Record<string, number>;
  confidenceIndex: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  automationReadiness: number;
}

export interface BackendScore {
  id: string;
  assessmentId: string;
  summary: BackendScoreSummary;
  hasOverrides: boolean;
  scoringMethod: string;
  scoredByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  dimensionScores: BackendDimensionScore[];
  derivedSignals: BackendDerivedSignal[];
}

/**
 * One row of a live passport list (PHX-PASSPORTS-001, vercel-supabase-preview
 * mode only — mirrors pbrs_passports joined with assets and, if present, its
 * most recent non-deleted pbrs_certifications row). There is no real-dev /
 * production-auth counterpart yet: apps/backend/src/routes/passports.ts is
 * still a PHX-BACKEND-001 stub (every route returns 501 Not Implemented), so
 * this type is only ever populated by previewGetPassports() in
 * preview-api-client.server.ts. Kept here, not in that file, for the same
 * reason as every other Backend* type — a single shared definition if a
 * future sprint adds a real backend passports endpoint.
 *
 * `certificationTier` / `certificationStatus` are null when the passport has
 * no certification row at all (pending certification) — this is NOT the
 * same as a 'Not Eligible'/'Expired' status, which the caller can also see
 * via a non-null `certificationStatus`. `certificationLevel` (PBRS
 * Foundation/Practitioner/Enterprise) is intentionally NOT included here —
 * it is a derived, presentation-layer value with a single source of truth
 * in lib/certification-levels.ts's certificationLevelFromScore(scoreSnapshot),
 * not a stored column, so callers derive it from `scoreSnapshot` rather than
 * this read layer duplicating that logic.
 */
export interface BackendPassport {
  id: string;
  passportId: string;
  assetId: string;
  assetName: string;
  assessmentId: string;
  /** PassportStatus: 'Not Issued' | 'Issued' | 'Active' | 'Expired' | 'Revoked'. */
  status: string;
  scoreSnapshot: number;
  /** Constrained at the DB layer to 'A' | 'B' | 'C' | 'Hold' (chk_pbrs_passports_grade). */
  gradeSnapshot: string;
  validFrom: string | null;
  validUntil: string | null;
  recordHash: string;
  issuedAt: string | null;
  revokedAt: string | null;
  /** CertificationTier ('Platinum'|'Gold'|'Silver'|'Bronze'), or null if no certification row exists yet. */
  certificationTier: string | null;
  /** CertificationStatus ('Certified'|'Expiring Soon'|'Expired'|'Eligible'|'Not Eligible'), or null if no certification row exists yet. */
  certificationStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One row of a live certifications list (PHX-CERTIFICATIONS-001,
 * vercel-supabase-preview mode only — mirrors pbrs_certifications joined
 * with its issuing pbrs_passports row and the underlying asset). There is
 * no real-dev / production-auth counterpart yet: apps/backend/src/routes/
 * certifications.ts is still a PHX-BACKEND-001 stub (every route returns
 * 501 Not Implemented), so this type is only ever populated by
 * previewGetCertifications() in preview-api-client.server.ts — the exact
 * same architectural pattern BackendPassport/previewGetPassports()
 * established for PHX-PASSPORTS-001.
 *
 * `certificationLevel` (PBRS Foundation/Practitioner/Enterprise) is
 * intentionally NOT included here — it is a derived, presentation-layer
 * value with a single source of truth in
 * lib/certification-levels.ts's certificationLevelFromScore(scoreSnapshot),
 * not a stored column, so callers derive it from `scoreSnapshot` rather
 * than this read layer duplicating that logic. `tier` here is the stored
 * PBRS Internal Tier ('Platinum'|'Gold'|'Silver'|'Bronze') already granted
 * for this certification row — not derived.
 */
export interface BackendCertification {
  id: string;
  certificationId: string;
  passportId: string;
  assetId: string;
  assetName: string;
  assessmentId: string;
  /** PBRS Internal Tier granted for this certification: 'Platinum' | 'Gold' | 'Silver' | 'Bronze'. */
  tier: string;
  /** CertificationStatus: 'Certified' | 'Expiring Soon' | 'Expired' | 'Eligible' | 'Not Eligible'. */
  status: string;
  scoreSnapshot: number;
  issuedDate: string | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Read functions have moved to real-api-client.server.ts (Server
// Component / server-only reads, used by platform-data-source.ts) and
// real-api-client.client.ts (Client Component reads, not yet called by
// any page). Both call this file's exported `realFetch<T>()` with their
// own resolved headers — see this file's header comment for the full
// PHX-PLATFORM-011-R1 rationale. Keeping the Backend* types here (below)
// means both split files, and any component doing a type-only import
// (e.g. components/LiveScorePanel.tsx), share one definition.
// ---------------------------------------------------------------------------

/** Health/readiness check — no auth required backend-side; still routed through baseUrl only. Safe from either server or client since it needs no auth headers. */
export async function realGetReadiness(): Promise<BackendReadinessResult> {
  const { baseUrl } = getPhoenixApiConfig();
  if (!baseUrl) return { ok: false };
  try {
    const response = await fetch(`${baseUrl}/api/readiness`, { method: 'GET', credentials: 'omit' });
    if (!response.ok) return { ok: false };
    return (await response.json()) as BackendReadinessResult;
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Write actions — NOT supported through this file in any mode this sprint.
// ---------------------------------------------------------------------------

export function realWriteUnsupported(action: string): never {
  throw new RealDevUnsupportedError(action);
}

/**
 * Skeleton wrapper preserved from PHX-PLATFORM-009 for api-client.ts's
 * governance-action call sites. Real-dev and production-auth both remain
 * unsupported for writes this sprint — every mode other than 'mock' routes
 * through disabledRealApiCall() here, matching PHX-PLATFORM-009's original
 * behavior and this sprint's "do not connect unsupported passport/
 * certification actions" instruction.
 */
export async function phoenixFetch<T = unknown>(
  endpoint: string,
  options?: PhoenixApiRequestOptions
): Promise<PhoenixApiResponse<T>> {
  return disabledRealApiCall<T>(endpoint, options);
}

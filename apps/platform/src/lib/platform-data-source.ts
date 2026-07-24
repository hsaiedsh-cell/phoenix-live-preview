// ============================================================
// Phoenix Platform — Data Source Resolver
// PHX-PLATFORM-011 — Live Read Migration for Production Auth
// ------------------------------------------------------------
// Single seam that decides, for each migrated read surface
// (dashboard / assessments list / assessment detail / settings
// activity+audit), whether to render mock data, live backend data, or
// an explicit non-data state (auth required / config missing /
// backend unavailable / permission denied / not found). Pages call one
// function from this file and render on `status` — no page re-derives
// the mock/real-dev/production-auth branch itself, per the task's "do
// not scatter mode checks across every page" instruction.
//
// mock mode:            every function below returns { status: 'mock' }
//                        immediately and never imports real-api-client.
// real-dev:              uses api-config.ts's devWorkspaceId. If unset,
//                        every workspace-scoped section returns
//                        'config-missing' — there is no fallback
//                        workspace id invented here.
// production-auth:       uses api-config.ts's productionWorkspaceId
//                        (PHX-PLATFORM-011's interim bridge — see that
//                        field's doc comment in api-config.ts). If
//                        unset, same 'config-missing' behavior as an
//                        unresolved real-dev workspace. If a Clerk
//                        session token is unavailable, returns
//                        'auth-required' instead of attempting the call
//                        anonymously.
// real-disabled:         returns 'not-wired' — this mode was never
//                        meant to reach a real backend (see
//                        api-config.ts).
//
// NEVER falls back to mock data for a migrated section in real-dev or
// production-auth — a failed/unavailable live read surfaces its own
// status; it does not silently render mock-api-client.ts's data
// instead. See PHX_PLATFORM_011_IMPLEMENTATION_REPORT.md for the full
// migration scope (which pages/sections are migrated vs. still
// mock-backed/preview-only).
//
// PHX-PLATFORM-011-R1: this file's realGet* imports now come from
// real-api-client.server.ts, not real-api-client.ts directly. Every
// function in this file is called only from Server Component pages, so
// it must use the server-side Clerk token resolution path — see
// real-api-client.server.ts and real-api-client.ts's header comments
// for the bug this fixes (production-auth live reads previously always
// failed with auth-required from a Server Component).
//
// PHX-DEPLOY-004C: vercel-supabase-preview is a fifth mode alongside
// mock/real-dev/real-disabled/production-auth. It is handled the SAME
// way production-auth is throughout this file (workspace-id resolution,
// mock/not-wired early-outs, error mapping) — the only difference is
// which read function each load* function calls (previewGet* direct-SQL
// reads instead of realGet* HTTP reads over the Express backend). See
// preview-api-client.server.ts.
// ============================================================

// PHX-PLATFORM-011-R1: every function in this file is called only from
// Server Component pages (dashboard/assessments/assessment-detail/
// settings — none of them are 'use client'). The realGet* functions
// therefore MUST come from real-api-client.server.ts (server-side Clerk
// token via getServerBackendToken()), never real-api-client.client.ts
// (browser window.Clerk — would always fail here). This was the actual
// PHX-PLATFORM-011-R1 bug: this file previously imported realGet*
// from real-api-client.ts, which at the time resolved production-auth
// headers via the browser-only getBackendAuthHeaders() unconditionally.
import { getPhoenixApiConfig, type PhoenixApiMode } from './api-config';
import {
  realGetAssessments,
  realGetAssessmentDetail,
  realGetAssessmentEvidence,
  realGetAssessmentScore,
  realGetAssessmentActivity,
  realGetAssessmentAuditRecords,
  realGetWorkspaceActivity,
  realGetWorkspaceAuditRecords,
  realGetReports,
  realGetReportDetail,
} from './real-api-client.server';
// PHX-DEPLOY-004C: vercel-supabase-preview mode's direct-SQL counterparts
// to the realGet* functions above. Same input/output shapes, same typed
// errors — see preview-api-client.server.ts's header for why this lets
// every function below stay a single small mode branch instead of a
// third parallel set of load* functions.
import {
  previewGetAssessments,
  previewGetAssessmentDetail,
  previewGetAssessmentEvidence,
  previewGetAssessmentScore,
  previewGetAssessmentActivity,
  previewGetAssessmentAuditRecords,
  previewGetWorkspaceActivity,
  previewGetWorkspaceAuditRecords,
  previewGetPassports,
  previewGetCertifications,
  previewGetReports,
} from './preview-api-client.server';
import {
  RealApiError,
  RealApiConfigError,
  RealApiAuthRequiredError,
  type BackendAssessment,
  type BackendAssessmentDetail,
  type BackendEvidenceItem,
  type BackendScore,
  type BackendActivityItem,
  type BackendAuditRecord,
  type BackendPassport,
  type BackendCertification,
  type BackendReport,
} from './real-api-client';

/** Which runtime mode is active. Re-exported from api-config.ts's PhoenixApiMode for call-site clarity — same four values. */
export type PlatformDataMode = PhoenixApiMode;

/**
 * The resolved state of a migrated read surface. 'mock' and 'live' are
 * genuine data states; the rest are explicit non-data states a page
 * must render distinctly rather than papering over.
 *
 * 'permission-denied' and 'not-found' are additions beyond the task
 * brief's suggested six-value list — added because Task 6 (assessment
 * detail) explicitly requires a distinct 404 state, and Task 7
 * (Settings activity/audit) explicitly requires distinguishing "you are
 * signed in but not authorized" from every other failure mode. None of
 * the other five values honestly describe either case. Documented here
 * as a deliberate, minimal deviation from the suggested type.
 */
export type DataSourceStatus =
  | 'mock'
  | 'live'
  | 'auth-required'
  | 'config-missing'
  | 'backend-unavailable'
  | 'permission-denied'
  | 'not-found'
  | 'not-wired';

export interface LiveResult<T> {
  status: DataSourceStatus;
  mode: PlatformDataMode;
  data?: T;
  /** Human-readable detail for the explicit non-data states. Never set alongside 'mock' or 'live'. */
  message?: string;
}

function mockResult<T>(mode: PlatformDataMode): LiveResult<T> {
  return { status: 'mock', mode };
}

function notWiredResult<T>(mode: PlatformDataMode): LiveResult<T> {
  return { status: 'not-wired', mode, message: 'real-disabled mode does not read from a live backend.' };
}

/**
 * Resolves the workspace id migrated live reads should be scoped to,
 * for whichever real mode is active. Returns null if the active mode's
 * required workspace-id env var is unset — callers must treat that as
 * config-missing, not guess a workspace id. See file header and
 * api-config.ts's `devWorkspaceId` / `productionWorkspaceId` doc
 * comments for why each mode needs its own explicit value.
 */
function resolveLiveWorkspaceId(): { workspaceId: string | null; reason?: string } {
  const config = getPhoenixApiConfig();
  if (config.mode === 'real-dev') {
    return config.devWorkspaceId
      ? { workspaceId: config.devWorkspaceId }
      : { workspaceId: null, reason: 'NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID is not set for this real-dev deployment.' };
  }
  if (config.mode === 'production-auth' || config.mode === 'vercel-supabase-preview') {
    return config.productionWorkspaceId
      ? { workspaceId: config.productionWorkspaceId }
      : {
          workspaceId: null,
          reason:
            'No workspace could be resolved for this session (NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID is not set). ' +
            'Workspace membership resolution from the authenticated identity is future work — see PHX-AUTH-001.',
        };
  }
  return { workspaceId: null };
}

/** Converts a thrown real-api-client error into the matching LiveResult status, for any live read. */
function errorToLiveResult<T>(err: unknown, mode: PlatformDataMode): LiveResult<T> {
  if (err instanceof RealApiAuthRequiredError) {
    return { status: 'auth-required', mode, message: err.message };
  }
  if (err instanceof RealApiConfigError) {
    return { status: 'config-missing', mode, message: err.message };
  }
  if (err instanceof RealApiError) {
    if (err.code === 'AUTH_REQUIRED') return { status: 'auth-required', mode, message: err.message };
    if (err.code === 'PERMISSION_DENIED') return { status: 'permission-denied', mode, message: err.message };
    if (err.code === 'NOT_FOUND') return { status: 'not-found', mode, message: err.message };
    // BACKEND_UNAVAILABLE, DB_UNAVAILABLE, VALIDATION_ERROR, CONFLICT,
    // BACKEND_ERROR, NOT_IMPLEMENTED — all surfaced as a generic
    // "backend unavailable"-shaped state; the message carries specifics.
    return { status: 'backend-unavailable', mode, message: err.message };
  }
  return {
    status: 'backend-unavailable',
    mode,
    message: err instanceof Error ? err.message : 'Unknown error contacting the backend.',
  };
}

// ---------------------------------------------------------------------------
// Dashboard (Task 4) — derived-from-live-assessment-list summary.
//
// PHX-PLATFORM-011-R1 CORRECTION: PHX-PLATFORM-011's implementation
// report claimed "the backend's assessment LIST endpoint returns
// id/title/status/owner/timestamps only — no score", used to justify
// omitting every score-based dashboard stat. Live verification against
// a real, seeded backend found this was wrong: the list endpoint DOES
// return `overallScore`/`grade`/`riskLevel` per row (see
// BackendAssessment in real-api-client.ts). `scoredInPage` below
// surfaces a count derived from that — explicitly labeled "in this
// loaded page" rather than "workspace-wide", since `realGetAssessments`
// is a single paginated call (default/likely limit — see the backend's
// own `clampLimit()`, capped at 100) and this file does not page through
// every assessment in the workspace to compute a true aggregate.
// ---------------------------------------------------------------------------

export interface LiveDashboardData {
  workspaceId: string;
  totalAssessments: number;
  statusBreakdown: Record<string, number>;
  /** Count of items, among the ones actually loaded on this page, that have a non-null overallScore. Not a workspace-wide count — see comment above. */
  scoredInPage: number;
  recentAssessments: BackendAssessment[];
}

export async function loadDashboardData(): Promise<LiveResult<LiveDashboardData>> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockResult(config.mode);
  if (config.mode === 'real-disabled') return notWiredResult(config.mode);

  const { workspaceId, reason } = resolveLiveWorkspaceId();
  if (!workspaceId) return { status: 'config-missing', mode: config.mode, message: reason };

  try {
    const { items, total } =
      config.mode === 'vercel-supabase-preview' ? await previewGetAssessments(workspaceId) : await realGetAssessments(workspaceId);
    const statusBreakdown: Record<string, number> = {};
    for (const item of items) {
      statusBreakdown[item.status] = (statusBreakdown[item.status] ?? 0) + 1;
    }
    const scoredInPage = items.filter((item) => item.overallScore !== null).length;
    return {
      status: 'live',
      mode: config.mode,
      data: {
        workspaceId,
        totalAssessments: total,
        statusBreakdown,
        scoredInPage,
        recentAssessments: items.slice(0, 5),
      },
    };
  } catch (err) {
    return errorToLiveResult(err, config.mode);
  }
}

// ---------------------------------------------------------------------------
// Assessments list (Task 5)
// ---------------------------------------------------------------------------

export interface LiveAssessmentsListData {
  workspaceId: string;
  items: BackendAssessment[];
  total: number;
}

export async function loadAssessmentsListData(): Promise<LiveResult<LiveAssessmentsListData>> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockResult(config.mode);
  if (config.mode === 'real-disabled') return notWiredResult(config.mode);

  const { workspaceId, reason } = resolveLiveWorkspaceId();
  if (!workspaceId) return { status: 'config-missing', mode: config.mode, message: reason };

  try {
    const { items, total } =
      config.mode === 'vercel-supabase-preview' ? await previewGetAssessments(workspaceId) : await realGetAssessments(workspaceId);
    return { status: 'live', mode: config.mode, data: { workspaceId, items, total } };
  } catch (err) {
    return errorToLiveResult(err, config.mode);
  }
}

// ---------------------------------------------------------------------------
// Assessment detail (Task 6; PHX-BACKEND-009B widens this with
// assessment-scoped Activity/Audit)
// ---------------------------------------------------------------------------

/**
 * PHX-BACKEND-009B: whether the current actor was granted audit.read
 * for this assessment's workspace. 'restricted' means a 403 was
 * received specifically for the audit-records call — every other
 * section (Assessment/Score/Evidence/Activity) still loaded normally.
 * This is NOT set for any other kind of audit failure (backend
 * unavailable, unexpected error, etc.) — those propagate as a normal
 * whole-section failure via errorToLiveResult(), exactly as they did
 * before this sprint, rather than being silently mislabeled as a
 * permission restriction.
 */
export type AssessmentAuditAccess = 'granted' | 'restricted';

export interface LiveAssessmentDetailData {
  detail: BackendAssessmentDetail;
  evidence: BackendEvidenceItem[];
  evidenceTotal: number;
  /** Redundant with detail.score, fetched separately per Task 6's explicit endpoint list; kept in sync — both come from the same backend record. */
  score: BackendScore | null;
  /** PHX-BACKEND-009B: assessment-scoped activity (Assessment + child Evidence events). Requires only assessment.read — same permission the rest of this load already requires — so it is never isolated the way audit is. */
  activity: BackendActivityItem[];
  /** PHX-BACKEND-009B: assessment-scoped audit records. Empty when auditAccess is 'restricted'. */
  auditRecords: BackendAuditRecord[];
  /** PHX-BACKEND-009B: see AssessmentAuditAccess doc comment. */
  auditAccess: AssessmentAuditAccess;
}

export async function loadAssessmentDetailData(
  assessmentId: string
): Promise<LiveResult<LiveAssessmentDetailData>> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockResult(config.mode);
  if (config.mode === 'real-disabled') return notWiredResult(config.mode);

  try {
    // Activity requires only assessment.read — the same permission this
    // whole load already requires for detail/evidence/score to succeed
    // — so it is bundled into the same Promise.all and fails together
    // with the rest of the section exactly like before this sprint.
    const [detail, evidenceResult, score, activityResult] =
      config.mode === 'vercel-supabase-preview'
        ? await Promise.all([
            previewGetAssessmentDetail(assessmentId),
            previewGetAssessmentEvidence(assessmentId),
            previewGetAssessmentScore(assessmentId),
            previewGetAssessmentActivity(assessmentId),
          ])
        : await Promise.all([
            realGetAssessmentDetail(assessmentId),
            realGetAssessmentEvidence(assessmentId),
            realGetAssessmentScore(assessmentId),
            realGetAssessmentActivity(assessmentId),
          ]);

    // Audit requires audit.read, which most roles that can view an
    // assessment do NOT have (see the approved Audit role matrix —
    // Owner/Admin/Auditor only). A 403 here is isolated: it must not
    // prevent the rest of this function's data from loading. Any OTHER
    // error (not a 403/PERMISSION_DENIED) is re-thrown into this
    // function's own outer catch below, so it surfaces as the normal
    // errorToLiveResult() status (e.g. 'backend-unavailable') the same
    // way it would have before this sprint — never silently converted
    // into 'restricted'.
    let auditRecords: BackendAuditRecord[] = [];
    let auditAccess: AssessmentAuditAccess = 'granted';
    try {
      const auditResult =
        config.mode === 'vercel-supabase-preview'
          ? await previewGetAssessmentAuditRecords(assessmentId)
          : await realGetAssessmentAuditRecords(assessmentId);
      auditRecords = auditResult.items;
    } catch (auditErr) {
      if (auditErr instanceof RealApiError && auditErr.code === 'PERMISSION_DENIED') {
        auditAccess = 'restricted';
      } else {
        throw auditErr;
      }
    }

    return {
      status: 'live',
      mode: config.mode,
      data: {
        detail,
        evidence: evidenceResult.items,
        evidenceTotal: evidenceResult.total,
        score,
        activity: activityResult.items,
        auditRecords,
        auditAccess,
      },
    };
  } catch (err) {
    return errorToLiveResult(err, config.mode);
  }
}

// ---------------------------------------------------------------------------
// Settings — runtime activity/audit preview (Task 7)
// ---------------------------------------------------------------------------

export interface LiveSettingsActivityAuditData {
  workspaceId: string;
  activity: BackendActivityItem[];
  auditRecords: BackendAuditRecord[];
}

export async function loadSettingsActivityAuditData(): Promise<LiveResult<LiveSettingsActivityAuditData>> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockResult(config.mode);
  if (config.mode === 'real-disabled') return notWiredResult(config.mode);

  const { workspaceId, reason } = resolveLiveWorkspaceId();
  if (!workspaceId) return { status: 'config-missing', mode: config.mode, message: reason };

  try {
    const [activityResult, auditResult] =
      config.mode === 'vercel-supabase-preview'
        ? await Promise.all([previewGetWorkspaceActivity(workspaceId), previewGetWorkspaceAuditRecords(workspaceId)])
        : await Promise.all([realGetWorkspaceActivity(workspaceId), realGetWorkspaceAuditRecords(workspaceId)]);
    return {
      status: 'live',
      mode: config.mode,
      data: {
        workspaceId,
        activity: activityResult.items,
        auditRecords: auditResult.items,
      },
    };
  } catch (err) {
    // audit.read is enforced per-workspace by the backend — a 403 here
    // is expected for e.g. a Viewer/Contributor identity and must
    // render as permission-denied, never as fake/empty data.
    return errorToLiveResult(err, config.mode);
  }
}

// ---------------------------------------------------------------------------
// Passports list (PHX-PASSPORTS-001) — vercel-supabase-preview mode only.
// There is no real-dev / production-auth branch here (unlike every other
// function in this file): apps/backend/src/routes/passports.ts is still a
// PHX-BACKEND-001 stub (every route 501s), so real-dev/production-auth
// simply have no live passport data source to call yet. Those two modes
// (and 'real-disabled') therefore return 'mock' here deliberately, NOT
// 'not-wired' — /passports/page.tsx keeps rendering its existing
// mock-backed view for every mode except vercel-supabase-preview, exactly
// as it did before this sprint. This is a narrower mock/live boundary than
// every other load*Data function above (which all treat real-dev/
// production-auth as live-capable) and is called out explicitly here so a
// future sprint adding a real backend passports endpoint knows to widen it.
// ---------------------------------------------------------------------------

export interface LivePassportsListData {
  workspaceId: string;
  items: BackendPassport[];
  total: number;
}

export async function loadPassportsListData(): Promise<LiveResult<LivePassportsListData>> {
  const config = getPhoenixApiConfig();
  if (config.mode !== 'vercel-supabase-preview') return mockResult(config.mode);

  const { workspaceId, reason } = resolveLiveWorkspaceId();
  if (!workspaceId) return { status: 'config-missing', mode: config.mode, message: reason };

  try {
    const { items, total } = await previewGetPassports(workspaceId);
    return { status: 'live', mode: config.mode, data: { workspaceId, items, total } };
  } catch (err) {
    return errorToLiveResult(err, config.mode);
  }
}

// ---------------------------------------------------------------------------
// Certifications list (PHX-CERTIFICATIONS-001) — vercel-supabase-preview
// mode only, exact same architectural pattern as loadPassportsListData()
// immediately above. There is no real-dev / production-auth branch here
// (unlike every other function in this file, save loadPassportsListData()):
// apps/backend/src/routes/certifications.ts is still a PHX-BACKEND-001
// stub (every route 501s), so real-dev/production-auth simply have no
// live certifications data source to call yet. Those two modes (and
// 'real-disabled') therefore return 'mock' here deliberately, NOT
// 'not-wired' — /certifications/page.tsx keeps rendering its existing
// mock-backed view for every mode except vercel-supabase-preview, exactly
// as it did before this sprint.
//
// Only the certified-assets LIST is migrated. "Eligible Assets" and
// "Expiring Soon" (mock-only stat cards derived from assessment-score-
// threshold matching against every assessment in the workspace) are NOT
// part of this read — this endpoint returns only rows that already exist
// in pbrs_certifications. Showing a fabricated 0 for either would
// misrepresent an unknown value as a known one, so the page omits those
// stat cards, the Certification Level cards' per-level asset counts, and
// the certification-granting governance panel (a write action, and
// preview-only in every mode per this sprint's brief) entirely in
// vercel-supabase-preview mode — see certifications/page.tsx.
// ---------------------------------------------------------------------------

export interface LiveCertificationsListData {
  workspaceId: string;
  items: BackendCertification[];
  total: number;
}

export async function loadCertificationsListData(): Promise<LiveResult<LiveCertificationsListData>> {
  const config = getPhoenixApiConfig();
  if (config.mode !== 'vercel-supabase-preview') return mockResult(config.mode);

  const { workspaceId, reason } = resolveLiveWorkspaceId();
  if (!workspaceId) return { status: 'config-missing', mode: config.mode, message: reason };

  try {
    const { items, total } = await previewGetCertifications(workspaceId);
    return { status: 'live', mode: config.mode, data: { workspaceId, items, total } };
  } catch (err) {
    return errorToLiveResult(err, config.mode);
  }
}

// ---------------------------------------------------------------------------
// Reports list (PHX-REPORTS-001, widened by PHX-REPORTS-004) — same
// architectural pattern as loadDashboardData()/loadAssessmentsListData()
// above: mock/real-disabled short-circuit first, then a three-way
// mode branch (vercel-supabase-preview's direct-Postgres read vs.
// real-dev/production-auth's HTTP read against the now-real backend
// endpoints). Before PHX-REPORTS-004, apps/backend/src/routes/reports.ts
// was still a PHX-BACKEND-001 stub (every route 501s), so real-dev/
// production-auth had no live reports data source to call and
// deliberately fell back to 'mock' here — that limitation is what this
// sprint removes. vercel-supabase-preview remains READ-ONLY (no write
// path is added to that mode by this sprint — see
// preview-api-client.server.ts's header) and mock mode is completely
// unchanged (still returns 'mock' below, still renders via
// ReportCard/getReports() on /reports/page.tsx).
// ---------------------------------------------------------------------------

export interface LiveReportsListData {
  workspaceId: string;
  items: BackendReport[];
  total: number;
}

export async function loadReportsListData(): Promise<LiveResult<LiveReportsListData>> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockResult(config.mode);
  if (config.mode === 'real-disabled') return notWiredResult(config.mode);

  const { workspaceId, reason } = resolveLiveWorkspaceId();
  if (!workspaceId) return { status: 'config-missing', mode: config.mode, message: reason };

  try {
    const { items, total } =
      config.mode === 'vercel-supabase-preview' ? await previewGetReports(workspaceId) : await realGetReports(workspaceId);
    return { status: 'live', mode: config.mode, data: { workspaceId, items, total } };
  } catch (err) {
    return errorToLiveResult(err, config.mode);
  }
}

// ---------------------------------------------------------------------------
// Report detail (PHX-REPORTS-004) — real-dev/production-auth only. The
// backend resolves a report's owning workspace from the report id
// itself (never trusting a client-supplied workspace id for a
// report-scoped read — see routes/reports.ts), so this loader, like
// loadAssessmentDetailData() above, needs no separate workspace
// resolution step; the reportId alone is enough.
//
// vercel-supabase-preview has no per-report detail read (LiveReportsTable
// renders directly from the list read) — mock mode is unchanged. Both
// therefore return 'mock'/'not-wired' the same way every other
// not-yet-migrated-for-this-mode loader in this file does.
// ---------------------------------------------------------------------------

export async function loadReportDetailData(reportId: string): Promise<LiveResult<BackendReport>> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockResult(config.mode);
  if (config.mode === 'real-disabled') return notWiredResult(config.mode);
  if (config.mode === 'vercel-supabase-preview') return mockResult(config.mode);

  try {
    const detail = await realGetReportDetail(reportId);
    return { status: 'live', mode: config.mode, data: detail };
  } catch (err) {
    return errorToLiveResult(err, config.mode);
  }
}

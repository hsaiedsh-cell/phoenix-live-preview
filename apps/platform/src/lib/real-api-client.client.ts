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
  realPost,
  backendErrorToRealApiError,
  RealApiConfigError,
  RealApiAuthRequiredError,
  RealApiError,
  type BackendPaginatedResult,
  type BackendWorkspace,
  type BackendAssessment,
  type BackendActivityItem,
  type BackendAuditRecord,
  type BackendAssessmentDetail,
  type BackendEvidenceItem,
  type BackendScore,
  type BackendReport,
  type CreateReportRequestInput,
  type CreateReportRequestResult,
  type IntakeQueueInput,
  type IntakeQueueResult,
  type IntakeRequestDetail,
  type IntakeFileDownloadResult,
  type IntakeQuoteInput,
  type IntakeQuoteResult,
  type IntakeOperatorAction,
  type IntakeUploadInvitationResult,
  type IntakeProvisioningInput,
  type IntakeProvisioningResult,
  type OnboardingInvitationIssueResult,
  type OnboardingInvitationRevokeResult,
  type CustomerPortalDecisionInput,
  type CustomerPortalRequestDetail,
  type CustomerFulfillment,
  type FulfillmentStatus,
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

export async function realAcceptOnboardingInvitation(token: string): Promise<{ status: 'Accepted'; workspaceId: string }> {
  const { baseUrl } = getPhoenixApiConfig();
  if (!baseUrl) throw new RealApiConfigError('No backend URL configured for invitation acceptance.');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/onboarding-invitations/accept`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }), credentials: 'omit', cache: 'no-store',
    });
  } catch {
    throw new RealApiError(0, 'BACKEND_UNAVAILABLE', 'The invitation service is temporarily unavailable.');
  }
  const envelope = await response.json() as { ok: boolean; data?: { status: 'Accepted'; workspaceId: string }; error?: { code?: string; message?: string } };
  if (!response.ok || !envelope.ok || !envelope.data) throw backendErrorToRealApiError(response.status, envelope.error);
  return envelope.data;
}

async function clientFetch<T>(path: string): Promise<T> {
  const headers = await resolveClientAuthHeaders();
  return realFetch<T>(path, headers);
}

// PHX-REPORTS-003: POST-capable sibling of clientFetch() above, using
// the exact same resolveClientAuthHeaders() this file already
// resolves for reads — real-dev's X-Phoenix-User-Id header or
// production-auth's Bearer token, never anything invented for this
// write path specifically.
async function clientPost<T>(path: string, body: unknown): Promise<T> {
  const headers = await resolveClientAuthHeaders();
  return realPost<T>(path, headers, body);
}

export async function realQueryIntakeRequests(input: IntakeQueueInput): Promise<IntakeQueueResult> {
  return clientPost('/api/operations/intake-requests/query', input);
}

export async function realGetIntakeRequestDetail(requestId: string): Promise<{ request: IntakeRequestDetail }> {
  return clientFetch(`/api/operations/intake-requests/${encodeURIComponent(requestId)}`);
}

export async function realGetIntakeFileDownload(
  requestId: string,
  fileId: string
): Promise<IntakeFileDownloadResult> {
  return clientFetch(
    `/api/operations/intake-requests/${encodeURIComponent(requestId)}/files/${encodeURIComponent(fileId)}/download`
  );
}

export async function realSendIntakeQuote(requestId: string, input: IntakeQuoteInput): Promise<IntakeQuoteResult> {
  return clientPost(`/api/operations/intake-requests/${encodeURIComponent(requestId)}/quote`, input);
}

export async function realGrantIntakeCustomerAccess(requestId: string, customerUserId: string): Promise<{ status: 'granted' }> {
  return clientPost(`/api/operations/intake-requests/${encodeURIComponent(requestId)}/customer-access`, { customerUserId });
}

export async function realGetOperatorCustomerPortal(requestId: string): Promise<CustomerPortalRequestDetail> {
  return clientFetch(`/api/operations/intake-requests/${encodeURIComponent(requestId)}/customer-portal`);
}

export async function realSendOperatorCustomerMessage(
  requestId: string,
  quoteOfferId: string,
  message: string
): Promise<{ messageId: string; createdAt: string; emailSent?: boolean }> {
  return clientPost(
    `/api/operations/intake-requests/${encodeURIComponent(requestId)}/quotes/${encodeURIComponent(quoteOfferId)}/messages`,
    { message }
  );
}

export async function realTransitionIntakeFulfillment(
  requestId: string,
  status: FulfillmentStatus
): Promise<CustomerFulfillment & { emailSent?: boolean }> {
  return clientPost(
    `/api/operations/intake-requests/${encodeURIComponent(requestId)}/fulfillment`,
    { status }
  );
}
export async function realSignPreviewProof(requestId:string,input:{filename:string;contentType:string;sizeBytes:number}){return clientPost<{previewProofId:string;uploadUrl:string;storageObjectKey:string}>(`/api/operations/intake-requests/${encodeURIComponent(requestId)}/preview-proofs/sign`,input);}
export async function realCompletePreviewProof(requestId:string,input:{previewProofId:string;storageObjectKey:string}){return clientPost<{status:'ready'}>(`/api/operations/intake-requests/${encodeURIComponent(requestId)}/preview-proofs/complete`,input);}
export async function realDecidePreviewProof(requestId:string,previewProofId:string,input:{decision:'approved'}|{decision:'revision_requested';reason:string}){return clientPost<{decisionId:string;decision:string;createdAt:string}>(`/api/customer/intake-requests/${encodeURIComponent(requestId)}/preview-proofs/${encodeURIComponent(previewProofId)}/decisions`,input);}

export async function realSubmitCustomerPortalDecision(
  requestId: string,
  quoteOfferId: string,
  input: CustomerPortalDecisionInput
): Promise<{ decisionId: string; decision: string; createdAt: string }> {
  return clientPost(
    `/api/customer/intake-requests/${encodeURIComponent(requestId)}/quotes/${encodeURIComponent(quoteOfferId)}/decisions`,
    input
  );
}

export async function realSendCustomerPortalMessage(
  requestId: string,
  quoteOfferId: string,
  message: string
): Promise<{ messageId: string; createdAt: string }> {
  return clientPost(
    `/api/customer/intake-requests/${encodeURIComponent(requestId)}/quotes/${encodeURIComponent(quoteOfferId)}/messages`,
    { message }
  );
}

export async function realRunIntakeAction(
  requestId: string,
  action: IntakeOperatorAction
): Promise<{ status: string }> {
  return clientPost(`/api/operations/intake-requests/${encodeURIComponent(requestId)}/actions`, { action });
}

export async function realIssueIntakeUploadInvitation(
  requestId: string
): Promise<IntakeUploadInvitationResult> {
  return clientPost(
    `/api/operations/intake-requests/${encodeURIComponent(requestId)}/upload-invitation`,
    {}
  );
}

export async function realProvisionIntakeWorkspace(
  input: IntakeProvisioningInput
): Promise<IntakeProvisioningResult> {
  return clientPost('/api/operations/intake-workspace-handoffs', input);
}

export async function realIssueOnboardingInvitation(
  membershipId: string,
  expiresInHours = 72
): Promise<OnboardingInvitationIssueResult> {
  return clientPost('/api/operations/onboarding-invitations', { membershipId, expiresInHours });
}

export async function realRevokeOnboardingInvitation(
  invitationId: string
): Promise<OnboardingInvitationRevokeResult> {
  return clientPost(`/api/operations/onboarding-invitations/${encodeURIComponent(invitationId)}/revoke`, {});
}

export async function realReissueOnboardingInvitation(
  invitationId: string,
  expiresInHours = 72
): Promise<OnboardingInvitationIssueResult> {
  return clientPost(`/api/operations/onboarding-invitations/${encodeURIComponent(invitationId)}/reissue`, { expiresInHours });
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

// ---------------------------------------------------------------------------
// PHX-BACKEND-009B — assessment-scoped Activity/Audit reads. Same
// clientFetch<T>() pattern as every function in this file; symmetric
// with real-api-client.server.ts's realGetAssessmentActivity()/
// realGetAssessmentAuditRecords(). Not called by any page this sprint
// (see file header — no platform page reads from a Client Component
// yet), kept here so a future client-side fetch has the correct seam.
// ---------------------------------------------------------------------------

export async function realGetAssessmentActivity(
  assessmentId: string
): Promise<BackendPaginatedResult<BackendActivityItem>> {
  return clientFetch(`/api/assessments/${encodeURIComponent(assessmentId)}/activity`);
}

export async function realGetAssessmentAuditRecords(
  assessmentId: string
): Promise<BackendPaginatedResult<BackendAuditRecord>> {
  return clientFetch(`/api/assessments/${encodeURIComponent(assessmentId)}/audit-records`);
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

// ---------------------------------------------------------------------------
// PHX-REPORTS-003 — first write function in this file. Called from
// RequestReportButton.tsx (a Client Component — this is why the write
// lives here, in the client variant, rather than in
// real-api-client.server.ts). Returns the created report request
// (status 'Requested', version 1) on success; throws RealApiError/
// RealApiConfigError/RealApiAuthRequiredError on failure, same as
// every read function above — callers handle these the same way.
//
// R1 correction: the return type is CreateReportRequestResult, not
// BackendReport — see that type's doc comment in real-api-client.ts
// for why R0's reuse of BackendReport here was inaccurate.
// ---------------------------------------------------------------------------

export async function realCreateReportRequest(
  workspaceId: string,
  input: CreateReportRequestInput
): Promise<CreateReportRequestResult> {
  return clientPost<CreateReportRequestResult>(`/api/workspaces/${encodeURIComponent(workspaceId)}/reports`, input);
}

// ---------------------------------------------------------------------------
// PHX-REPORTS-004 — live Reports list/detail/generate/download, called
// from the new action-aware Reports UI (LiveReportsActionTable.tsx,
// ReportDetailPoller.tsx). All client-side, since these are the
// functions a browser interaction (button click, poll tick) triggers
// directly — the initial page-load list read still goes through
// real-api-client.server.ts via platform-data-source.ts, matching every
// other migrated page's Server Component-first pattern; only the
// POST-triggering/polling/downloading actions live here.
// ---------------------------------------------------------------------------

/** GET /api/workspaces/:workspaceId/reports — client-side variant, used only if a client-triggered refresh is needed beyond the initial server-rendered list (not currently called; kept symmetric with real-api-client.server.ts's realGetReports for future use). */
export async function realGetReports(workspaceId: string): Promise<BackendPaginatedResult<BackendReport>> {
  return clientFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/reports`);
}

/** GET /api/reports/:reportId — used by ReportDetailPoller.tsx's bounded polling loop while a report is Generating, and by action components to refresh a single row's state after a POST. */
export async function realGetReportDetail(reportId: string): Promise<BackendReport> {
  return clientFetch<BackendReport>(`/api/reports/${encodeURIComponent(reportId)}`);
}

/**
 * POST /api/reports/:reportId/generate — starts, retries, or
 * regenerates a report depending on its current status (the backend
 * resolves which transition applies; this function sends no body at
 * all, matching the endpoint's contract — see
 * apps/backend/src/routes/reports.ts's generate handler doc comment:
 * "client may not supply version/status/storage/timestamp fields").
 * Throws RealApiError (mapped from the backend's 403/404/409 responses)
 * on failure — callers render this via the same sanitized inline
 * error pattern every other real-mode write already uses in this
 * codebase; NEVER pre-checked client-side (see
 * LiveReportsActionTable.tsx's header comment on why there is no
 * client-side role/ownership gate here).
 */
export async function realGenerateReport(reportId: string): Promise<BackendReport> {
  const headers = await resolveClientAuthHeaders();
  const { baseUrl } = getPhoenixApiConfig();
  const response = await fetch(`${baseUrl}/api/reports/${encodeURIComponent(reportId)}/generate`, {
    method: 'POST',
    headers,
  });

  let envelope: { ok: boolean; data?: BackendReport; error?: { code?: string; message?: string } } | null = null;
  try {
    envelope = await response.json();
  } catch {
    envelope = null;
  }

  if (!response.ok || !envelope?.ok) {
    throw backendErrorToRealApiError(response.status, envelope?.error);
  }

  return envelope.data as BackendReport;
}

export interface RealDownloadResult {
  blob: Blob;
  filename: string;
}

/**
 * GET /api/reports/:reportId/download — authenticated binary download.
 * Deliberately does NOT use realFetch() (that function always parses
 * the response as a JSON envelope; a successful download response here
 * is raw artifact bytes, not JSON). Resolves the SAME auth headers
 * every other client function in this file uses, reads the filename
 * from the backend's Content-Disposition header (never invented
 * client-side), and returns a Blob for the caller to trigger a browser
 * save from via a temporary object URL — never a plain `<a href>`
 * pointing at the backend URL directly, which would send no auth
 * header at all and therefore always fail against this backend.
 *
 * On a non-2xx response, parses the JSON error envelope (the backend
 * sends one for every failure path, including the integrity-failure
 * case) and throws the same RealApiError shape every other function
 * here throws — callers do not need a separate error-handling path for
 * downloads.
 */
export async function realDownloadReport(reportId: string): Promise<RealDownloadResult> {
  const headers = await resolveClientAuthHeaders();
  const { baseUrl } = getPhoenixApiConfig();
  const response = await fetch(`${baseUrl}/api/reports/${encodeURIComponent(reportId)}/download`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    let envelope: { error?: { code?: string; message?: string } } | null = null;
    try {
      envelope = await response.json();
    } catch {
      envelope = null;
    }
    throw backendErrorToRealApiError(response.status, envelope?.error);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const filename = filenameMatch?.[1] ?? 'report';

  const blob = await response.blob();
  return { blob, filename };
}

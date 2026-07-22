// ============================================================
// Phoenix Platform — API Client (Public Facade)
// PHX-PLATFORM-003 — Mock API Layer
// PHX-PLATFORM-009 — Backend Integration Readiness Layer
// ------------------------------------------------------------
// Public data-access surface for Phoenix Platform Alpha pages and
// components. This file itself makes no network calls and does
// not import sample-data.ts — it routes every call through
// api-config.ts's resolved mode:
//
//   'mock'          → mock-api-client.ts (sample-data-backed)
//   'real-disabled' → real-api-client.ts (always returns a clear
//                     "not enabled" result; never calls fetch())
//
// PHX-PLATFORM-009 scope note: the mode boundary is fully wired for
// the four governance actions below (issuePassport, revokePassport,
// grantCertification, revokeCertification), since those are the
// clearest "write" surface and the ones GovernanceActionButton /
// ActionConfirmDialog already call through a uniform
// PhoenixActionResult contract. Every other function in this facade
// is re-exported directly from mock-api-client.ts and always runs
// the mock implementation regardless of resolved mode — mode is
// always 'mock' in this Alpha's supported configuration, so this is
// not a behavior change; it is a scoping decision documented in
// PHX_PLATFORM_009_BACKEND_READINESS_IMPLEMENTATION_REPORT.md so a
// future sprint knows which call sites still need wiring when a
// real backend exists for reads.
//
// Platform pages/components should import ALL data-access functions
// and re-exported types from this file, never from
// mock-api-client.ts, real-api-client.ts, api-adapters.ts, or
// sample-data.ts directly.
// ============================================================

import { getPhoenixApiConfig } from './api-config';
import type { PhoenixApiResponse } from './api-types';
import { disabledRealApiCall } from './real-api-client';
import type { PhoenixActionResult, PassportActionInput, CertificationActionInput } from './action-types';
import {
  issuePassport as mockIssuePassport,
  revokePassport as mockRevokePassport,
  grantCertification as mockGrantCertification,
  revokeCertification as mockRevokeCertification,
} from './mock-api-client';

// ------------------------------------------------------------
// Re-export everything else from the mock implementation as-is.
// This covers: getCurrentUser, getCurrentWorkspace, getWorkspaceUsers,
// getDashboardSummary, getReadinessTrend, getRecentAssessments,
// getAssessments, getAssessmentById, getAssessmentDetail,
// getPassports, getPassportById, verifyPassport, getCertifications,
// getCertificationListItems, getCertificationById, getReports,
// getReportListItems, getReportById, requestReport, generateReport,
// getActivityLog, getAuditRecords, getActivityForEntity,
// getAuditRecordsForEntity, getWorkspaceSettings,
// updateWorkspaceSettings, plus every re-exported type (view models,
// action-layer types, certification-level helpers, sample-only
// legacy types). See mock-api-client.ts for the full list.
//
// Local declarations below (issuePassport, revokePassport,
// grantCertification, revokeCertification, apiResponseToActionResult)
// intentionally shadow the star-export's same-named bindings — ES
// modules resolve an explicit local export in favor of an ambiguous
// `export *` re-export of the same name, so this file's wrapped
// versions are what callers get.
// ------------------------------------------------------------
export * from './mock-api-client';

// ------------------------------------------------------------
// Governance actions — mode-aware facade (PHX-PLATFORM-009)
// ------------------------------------------------------------
// Mock behavior is byte-for-byte identical to PHX-PLATFORM-007 when
// getPhoenixApiConfig().mode === 'mock' (the default and only
// supported mode in this Alpha). When mode resolves to
// 'real-disabled', these return a PhoenixActionResult explaining
// that real API mode is not enabled, instead of performing any mock
// mutation — this is the one place in the app where 'real-disabled'
// behavior is currently observable.

/**
 * Adapts a PhoenixApiResponse (the generic client envelope from
 * api-types.ts) into the PhoenixActionResult shape GovernanceActionButton /
 * ActionConfirmDialog already expect (see action-types.ts). Used only for
 * the 'real-disabled' path below — mock-mode calls return a
 * PhoenixActionResult directly from mock-api-client.ts and never pass
 * through this adapter.
 */
export function apiResponseToActionResult<T>(response: PhoenixApiResponse<T>): PhoenixActionResult {
  if (response.ok) {
    return { ok: true, message: 'Request completed.' };
  }
  return {
    ok: false,
    message: response.error?.message ?? 'This action is not available in the current API mode.',
  };
}

export async function issuePassport(input: PassportActionInput): Promise<PhoenixActionResult> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockIssuePassport(input);
  const response = await disabledRealApiCall('POST /api/assessments/:assessmentId/passport');
  return apiResponseToActionResult(response);
}

export async function revokePassport(input: PassportActionInput): Promise<PhoenixActionResult> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockRevokePassport(input);
  const response = await disabledRealApiCall('PATCH /api/passports/:passportId');
  return apiResponseToActionResult(response);
}

export async function grantCertification(input: CertificationActionInput): Promise<PhoenixActionResult> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockGrantCertification(input);
  const response = await disabledRealApiCall('POST /api/passports/:passportId/certification');
  return apiResponseToActionResult(response);
}

export async function revokeCertification(input: CertificationActionInput): Promise<PhoenixActionResult> {
  const config = getPhoenixApiConfig();
  if (config.mode === 'mock') return mockRevokeCertification(input);
  const response = await disabledRealApiCall('POST /api/certifications/:certificationId/revoke');
  return apiResponseToActionResult(response);
}

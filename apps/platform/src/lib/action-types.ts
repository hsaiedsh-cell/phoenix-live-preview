// ============================================================
// Phoenix Platform — Governance Action Types
// PHX-PLATFORM-007 — Passport & Certification Action Layer
// ------------------------------------------------------------
// Generic, backend-ready shared types for mock workflow actions
// (issue/revoke passport, grant/revoke certification). These
// describe SHAPE only — no persistence, validation, or real
// security lives here. See api-client.ts for the mock action
// functions that return PhoenixActionResult, and
// GovernanceActionButton.tsx / ActionConfirmDialog.tsx for the
// UI that calls them.
//
// A real backend integration should be able to swap the mock
// function bodies in api-client.ts for real network calls
// without these shapes changing — call sites (components/pages)
// depend on this contract, not on any mock implementation detail.
// ============================================================

/** Lifecycle of a single governance action from a UI's point of view. */
export type PhoenixActionStatus = 'idle' | 'confirming' | 'submitting' | 'success' | 'error';

/**
 * Uniform result shape returned by every mock governance action function
 * in api-client.ts (issuePassport, revokePassport, grantCertification,
 * revokeCertification). `ok: false` represents a validation failure (e.g.
 * a missing required reason) rather than a thrown error, so UI can render
 * `message` directly without a try/catch.
 */
export interface PhoenixActionResult {
  ok: boolean;
  message: string;
  /** Mock-only reference id for the ActivityLog entry this action represents, if one was synthesized. */
  activityId?: string;
  /** Mock-only reference id for the AuditRecord entry this action represents, if one was synthesized. */
  auditRecordId?: string;
}

/** Input for issuePassport / revokePassport. */
export interface PassportActionInput {
  passportId?: string;
  assessmentId?: string;
  reason?: string;
}

/** Input for grantCertification / revokeCertification. */
export interface CertificationActionInput {
  passportId: string;
  certificationId?: string;
  reason?: string;
}

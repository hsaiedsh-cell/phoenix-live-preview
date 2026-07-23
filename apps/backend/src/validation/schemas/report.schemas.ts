// ============================================================
// Phoenix Backend — Report Request Write Body Schema
// PHX-REPORTS-003 — Report Request API & State Model
// ------------------------------------------------------------
// Zod schema for the POST /api/workspaces/:workspaceId/reports request
// body. Validates SHAPE ONLY (types, required/optional, UUID format,
// enum membership) — no existence checks here (those are
// reportTemplateById() / assetBelongsToWorkspace() /
// findActiveReportRequest() in routes/reports.ts, called after body
// parsing succeeds), same division of responsibility as
// validation/schemas/assessment.schemas.ts.
//
// `assetId` is optional/nullable at the SHAPE level because whether it
// is required depends on the referenced template's `scope`
// ('SingleAsset' requires it, 'Workspace'/'CertificationPortfolio'
// forbid it) — that is a business rule that needs the template row
// from the database, so it is enforced in the route handler after
// reportTemplateById() resolves, not here.
//
// `format`, if supplied, is validated against the same
// 'pdf' | 'html' | 'csv' allow-list as report_templates.output_formats
// / reports.format's CHECK constraint (db/migrations/0001_initial_
// schema.sql). Whether the *specific* value is actually one of the
// referenced template's supported output_formats is, again, a
// database-dependent business rule checked in the route handler, not
// here.
//
// ---- R1: .strict() — rejecting a client-supplied `version` --------
// PHX-REPORTS-003-R1 correction: the execution brief requires that
// "the client must not supply or override the initial version" and
// that version 1 be server/database-controlled
// (migration 0004_report_version.sql's `report_version INTEGER NOT
// NULL DEFAULT 1`). createReportRequest() in reports.repository.ts
// already never includes report_version in its INSERT column list, so
// a client-supplied `version` value could never reach the database
// even without this — but `.strict()` makes that guarantee explicit
// and independently testable at the validation layer: any unrecognized
// key in the request body (a `version` field included, but any other
// stray key too) now produces a 400 VALIDATION_ERROR
// (code: 'unrecognized_keys') instead of Zod's default behavior of
// silently stripping keys not declared on this schema. See the QA
// report for the request that proves a submitted `version` is
// rejected outright, rather than merely being ignored.
// ============================================================

import { z } from 'zod';

/** Same UUID shape as validation/schemas/assessment.schemas.ts's uuidSchema — kept local rather than shared to avoid a cross-schema-file dependency for one regex. */
const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'must be a valid UUID',
  });

/** Matches reports.format's CHECK constraint and report_templates.output_formats' element type exactly. */
export const REPORT_FORMATS = ['pdf', 'html', 'csv'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
const reportFormatSchema = z.enum(REPORT_FORMATS);

// ---- POST /api/workspaces/:workspaceId/reports --------------------------

export const CreateReportRequestBodySchema = z
  .object({
    templateId: uuidSchema,
    /** Required when the referenced template's scope is 'SingleAsset'; must be omitted/null otherwise — enforced in routes/reports.ts, not here (see file header). */
    assetId: uuidSchema.nullable().optional(),
    /** Defaults to the referenced template's first supported output format when omitted — see routes/reports.ts. */
    format: reportFormatSchema.optional(),
    // Deliberately NOT declaring a `version` field here — version is
    // never client-supplied (see file header's R1 note). `.strict()`
    // below turns an attempted `version` in the request body into a
    // 400, rather than this schema quietly accepting and discarding it.
  })
  .strict();

export type CreateReportRequestBody = z.infer<typeof CreateReportRequestBodySchema>;

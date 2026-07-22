// ============================================================
// Phoenix Backend — Assessment/Evidence Write Body Schemas
// PHX-BACKEND-005 — Assessment Write Endpoints Foundation
// ------------------------------------------------------------
// Zod schemas for the POST/PATCH request bodies introduced this
// sprint. These validate SHAPE ONLY (types, required/optional,
// string length, UUID format, enum membership) — they never touch
// the database (no existence checks here; those remain repository
// functions called from the route layer after body parsing
// succeeds) and never encode PBRS scoring logic.
//
// PBRS dimension keys — six-dimension model only (see
// PBRS_STANDARD_V1_2_RELEASE_CANDIDATE.md and
// docs/platform/PBRS_SCORING_CONTRACT_PHX_PLATFORM_002.md):
//   accuracy, compliance, brandAlignment, structure, consistency,
//   completeness
// Deliberately excludes the deprecated seven-dimension model's
// `businessLogic` and `clarity` keys — see
// PHX_STD_PBRS_003_R1 cleanup and CLAUDE's project memory for why
// those must never be reintroduced as scored dimensions.
//
// Evidence type allow-list decision: the task brief suggested a
// generic placeholder list (File/Link/Note/System) "if uncertain."
// This backend is NOT uncertain — the canonical `EvidenceType` enum
// already exists in packages/core/src/contracts/enums.ts (frontend
// source of truth) and is exercised by the dev seed data
// (db/seeds/0001_dev_seed.sql uses SourceOutput/ReviewerNote/
// Screenshot/Document). This schema uses that canonical list
// verbatim: Document, Screenshot, Dataset, SourceOutput,
// ReviewerNote, ExternalLink, Other. See
// docs/backend/PHX_BACKEND_005_IMPLEMENTATION_REPORT.md §"Evidence
// type allow-list" for the full rationale.
// ============================================================

import { z } from 'zod';

// ---- Shared primitives --------------------------------------------

/**
 * Same UUID shape as validation/validators.ts's UUID_PATTERN
 * (canonical xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx hex, hyphenated
 * 8-4-4-4-12, case-insensitive) — deliberately not version/variant
 * specific, for the same reason: seed/schema UUIDs are not
 * guaranteed to be strict UUIDv4. Zod's built-in `.uuid()` uses an
 * equivalent non-version-specific pattern, but this is defined
 * explicitly so the body-validation layer never silently drifts from
 * the path-param validation layer.
 */
const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'must be a valid UUID',
  });

/** ISO-8601 datetime string (Zod's built-in check; accepts an offset). */
const isoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * The six PBRS dimensions, exactly. See file header — never add
 * `businessLogic` or `clarity` here.
 */
export const PBRS_DIMENSION_KEYS = [
  'accuracy',
  'compliance',
  'brandAlignment',
  'structure',
  'consistency',
  'completeness',
] as const;

export type PbrsDimensionKey = (typeof PBRS_DIMENSION_KEYS)[number];

const pbrsDimensionKeySchema = z.enum(PBRS_DIMENSION_KEYS);

/**
 * Canonical EvidenceType values — see file header for why this list
 * (not the task brief's generic placeholder list) was used.
 */
export const EVIDENCE_TYPES = [
  'Document',
  'Screenshot',
  'Dataset',
  'SourceOutput',
  'ReviewerNote',
  'ExternalLink',
  'Other',
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

const evidenceTypeSchema = z.enum(EVIDENCE_TYPES);

// ---- POST /api/workspaces/:workspaceId/assessments -----------------

/**
 * `requestedByUserId` is NOT part of the task brief's field list, but
 * `assessments.requested_by_user_id` is a NOT NULL FK in the schema
 * (db/migrations/0001_initial_schema.sql). Since this sprint
 * explicitly excludes authentication, there is no session to derive
 * an acting user from. Rather than inventing a fabricated "system
 * user" row (which would require its own out-of-scope migration/seed
 * change), this field is added as an EXPLICIT, OPTIONAL extension:
 * callers may pass it; if omitted, the route layer falls back to a
 * deterministic lookup (the workspace's Owner-role member) — see
 * routes/assessments.ts and
 * docs/backend/PHX_BACKEND_005_IMPLEMENTATION_REPORT.md
 * §"requestedByUserId / uploadedByUserId placeholder actor decision"
 * for the full rationale and its documented limitation.
 */
export const CreateAssessmentBodySchema = z.object({
  assetId: uuidSchema,
  assetVersionId: uuidSchema,
  assignedReviewerUserId: uuidSchema.nullable().optional(),
  dueDate: isoDateTimeSchema.nullable().optional(),
  notes: z.string().max(2000).optional(),
  requestedByUserId: uuidSchema.optional(),
});

export type CreateAssessmentBody = z.infer<typeof CreateAssessmentBodySchema>;

// ---- POST /api/assessments/:assessmentId/submit --------------------

export const SubmitAssessmentBodySchema = z.object({
  submittedByUserId: uuidSchema.nullable().optional(),
  note: z.string().max(2000).optional(),
});

export type SubmitAssessmentBody = z.infer<typeof SubmitAssessmentBodySchema>;

// ---- POST /api/assessments/:assessmentId/evidence -------------------

export const AddEvidenceBodySchema = z.object({
  type: evidenceTypeSchema,
  title: z.string().min(1).max(200),
  note: z.string().max(4000).nullable().optional(),
  fileUrl: z.string().url().nullable().optional(),
  externalUrl: z.string().url().nullable().optional(),
  relatedDimension: pbrsDimensionKeySchema.nullable().optional(),
  uploadedByUserId: uuidSchema.optional(),
});

export type AddEvidenceBody = z.infer<typeof AddEvidenceBodySchema>;

// ---- PATCH /api/evidence/:evidenceId --------------------------------

export const UpdateEvidenceBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    note: z.string().max(4000).nullable().optional(),
    fileUrl: z.string().url().nullable().optional(),
    externalUrl: z.string().url().nullable().optional(),
    relatedDimension: pbrsDimensionKeySchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided.',
  });

export type UpdateEvidenceBody = z.infer<typeof UpdateEvidenceBodySchema>;

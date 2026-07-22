# Phoenix Backend — Database Schema Baseline

**Task ID:** PHX-BACKEND-001
**Status:** Scaffold only. No database is connected, and this document
describes a target PostgreSQL schema — nothing here is executed by the
backend at boot or at runtime this sprint.
**Source of truth:** This baseline is a direct, backend-facing translation
of `docs/platform/DATABASE_SCHEMA_PHX_PLATFORM_002.md` (PHX-PLATFORM-002),
cross-checked against `packages/core/src/contracts/*.ts` for field names
and enum values. It does not introduce any table, column, or relationship
that document does not already define. Where this document adds detail
(purpose, retention, audit notes) beyond the PHX-PLATFORM-002 draft, that
detail is additive documentation only — the column list and types are
unchanged.

**Conventions (carried over from PHX-PLATFORM-002):**
- All primary keys: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- All tables: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Soft-deletable tables additionally have `deleted_at TIMESTAMPTZ NULL`.
- `audit_records` is append-only — no `deleted_at`, no `UPDATE`/`DELETE` grants.
- Foreign keys default to `ON DELETE RESTRICT`; workspace-scoped children use `ON DELETE CASCADE` only where a full workspace teardown is an intentional, rare admin operation (noted per table).

---

## organizations

**Purpose:** Top-level tenant boundary. Every department and workspace
belongs to exactly one organization.

**Key fields:** `id`, `name`, `org_code` (unique, case-insensitive),
`primary_contact_email`, `industry`.

**Relationships:** Parent of `departments` and `workspaces` (1:N each).

**Indexes:** Unique on `upper(org_code)`.

**Audit considerations:** Organization creation/rename should be
audit-logged once `audit_records` writes exist; not enforced this sprint.

**Deletion/retention notes:** Soft-deletable. Hard delete is not a
supported operation in this Alpha's data lifecycle — see
`docs/platform/DATA_LIFECYCLE_PHX_PLATFORM_002.md`.

---

## departments

**Purpose:** Organizational grouping used for asset `department` filtering
and reporting scope, distinct from `workspaces` (which are the actual
access-control boundary).

**Key fields:** `id`, `organization_id`, `name`, `description`.

**Relationships:** Child of `organizations`.

**Indexes:** `(organization_id)`. Unique on `(organization_id, lower(name))` where `deleted_at IS NULL`.

**Audit considerations:** Low-sensitivity; no special audit requirement beyond standard `updated_at` tracking.

**Deletion/retention notes:** Soft-deletable, independent of workspace lifecycle.

---

## workspaces

**Purpose:** The primary access-control and data-scoping boundary.
Nearly every other entity (`assets`, `assessments`, `passports`,
`certifications`, `reports`, `activity_logs`, `notifications`,
`integrations`, `audit_records`) is scoped to a workspace.

**Key fields:** `id`, `organization_id`, `name`, `slug` (unique,
URL-safe), `settings` (JSONB — `WorkspaceSettings` shape, e.g.
`scoreThresholdOverride`, `autoIssuePassports`, `timezone`).

**Relationships:** Child of `organizations`; parent of `workspace_users`
and all workspace-scoped entities below.

**Indexes:** `(organization_id)`. Unique on `slug` where `deleted_at IS NULL`.

**Audit considerations:** `PATCH /api/workspaces/:workspaceId` (name/settings changes) is an `U` action requiring an `AuditRecord` per `PERMISSIONS_MODEL_PHX_PLATFORM_002.md`.

**Deletion/retention notes:** Soft-deletable. A hard workspace teardown is the one case where `ON DELETE CASCADE` is used on workspace-scoped children (see per-table notes below) — an intentional, rare admin operation, not part of normal soft-delete flow.

---

## users

**Purpose:** Platform-wide identity record. Distinct from workspace
membership — a `User` can belong to zero or more workspaces via
`workspace_users`.

**Key fields:** `id`, `email` (CITEXT, unique, case-insensitive),
`display_name`, `platform_role` (`UserRole`: `SuperAdmin` /
`StandardUser` / `ServiceAccount`), `avatar_url`, `last_login_at`.

**Relationships:** Referenced by nearly every other table as an actor
(`owner_user_id`, `created_by_user_id`, `actor_user_id`, etc.).

**Indexes:** Unique on `email` where `deleted_at IS NULL`.

**Audit considerations:** `last_login_at` is sensitive audit-adjacent
data; `Viewer` role is documented as unable to see it in list responses
per `API_CONTRACT_PHX_PLATFORM_002.md` §2.

**Deletion/retention notes:** Soft-deletable. No authentication is
implemented this sprint — this table has no password/credential column;
identity provider integration is a future, separately-reviewed decision
(see `integrations` table note below).

---

## workspace_users

**Purpose:** Implements `WorkspaceMembership` — the join between `users`
and `workspaces` carrying the workspace-scoped `WorkspaceRole`.

**Key fields:** `id`, `workspace_id`, `user_id`, `role`
(`WorkspaceRole`: `Owner` / `Admin` / `Reviewer` / `Contributor` /
`Viewer` / `Auditor`), `status` (`Active` / `Suspended` / `Invited`),
`invited_by_user_id`.

**Relationships:** Child of both `workspaces` (`ON DELETE CASCADE`) and
`users`.

**Indexes:** Unique on `(workspace_id, user_id)` where `deleted_at IS
NULL`. Index on `(user_id)` and `(workspace_id, role)` for permission
checks.

**Audit considerations:** Role/status changes are `U` actions per the
Permissions Model's "Users" matrix and must write an `AuditRecord` once
implemented.

**Deletion/retention notes:** Soft-deletable independently of the parent
workspace; cascades only on full workspace teardown.

---

## assets

**Purpose:** The AI-generated business asset under evaluation — the
central object PBRS assessments and scores attach to.

**Key fields:** `id`, `workspace_id`, `name`, `type` (`AssetType`),
`department`, `owner_user_id`, `status` (`AssetStatus`),
`current_version_id` (nullable FK, set after first version insert),
`last_assessed_at` (denormalized), `latest_score_snapshot`
(denormalized, `NUMERIC(5,2)`).

**Relationships:** Child of `workspaces` (`ON DELETE CASCADE`); parent of
`asset_versions` and (indirectly, via `asset_version_id`) `assessments`.

**Indexes:** `(workspace_id, status)`, `(workspace_id, owner_user_id)`,
`(workspace_id, department)`.

**Audit considerations:** Status transitions are governed by
`DATA_LIFECYCLE_PHX_PLATFORM_002.md`; invalid transitions return `409` at
the API layer (not yet implemented — see `routes/workspaces.ts` /
future asset routes).

**Deletion/retention notes:** Soft-deletable; "Archive" is the
documented terminal action (not a hard delete) per the Permissions Model.

---

## asset_versions

**Purpose:** Immutable content snapshots of an asset. Assessments always
reference a specific version, never a mutable "current" pointer, so a
PBRS score stays reproducible against the exact content it scored.

**Key fields:** `id`, `asset_id`, `version_number`, `content` /
`content_url` (exactly one required), `content_type`,
`created_by_user_id`, `change_note`.

**Relationships:** Child of `assets` (`ON DELETE CASCADE`); referenced by
`assessments.asset_version_id`.

**Indexes:** Unique on `(asset_id, version_number)`. Index on
`(asset_id)`.

**Audit considerations:** Immutable post-insert by design — no `UPDATE`
path is expected beyond `updated_at` bookkeeping, which in practice will
not change.

**Deletion/retention notes:** Soft-deletable in principle, but versions
referenced by an issued passport's `record_hash` should not be deleted in
practice — enforcement is a future concern, not implemented this sprint.

---

## assessments

**Purpose:** The reviewable unit of work — one assessment evaluates one
`asset_version` against the PBRS Standard and, on approval, can produce a
passport.

**Key fields:** `id`, `workspace_id`, `asset_id`, `asset_version_id`,
`status` (`AssessmentStatus`), `requested_by_user_id`,
`assigned_reviewer_user_id`, `submitted_at`, `decided_at`,
`decision_notes`, `score_id` (nullable FK → `pbrs_scores`).

**Relationships:** Child of `workspaces` (`ON DELETE CASCADE`); parent of
`assessment_steps`, `evidence_items`; 1:1 with `pbrs_scores`; 1:1 with
`pbrs_passports`.

**Indexes:** `(workspace_id, status)`, `(asset_id)`,
`(assigned_reviewer_user_id, status)`.

**Audit considerations:** `submit`, `review`, and `decision` transitions
each correspond to a permission-gated action in
`PERMISSIONS_MODEL_PHX_PLATFORM_002.md` and should each write an
`AuditRecord` once real endpoints exist.

**Deletion/retention notes:** Soft-deletable. "Close" is the documented
terminal lifecycle action distinct from delete.

---

## assessment_steps

**Purpose:** Ordered checklist/workflow steps within an assessment (the
UI's `Stepper` component reads this shape).

**Key fields:** `id`, `assessment_id`, `sequence`, `name`, `status`
(`AssessmentStepStatus`), `assigned_user_id`, `completed_at`, `notes`.

**Relationships:** Child of `assessments` (`ON DELETE CASCADE`).

**Indexes:** Unique on `(assessment_id, sequence)`.

**Audit considerations:** Step status changes are part of the `review`
action's audit trail at the assessment level, not separately audited
per-step in this design.

**Deletion/retention notes:** Soft-deletable; deleted alongside parent
assessment on cascade.

---

## evidence_items

**Purpose:** Supporting material (document, screenshot, note, external
link) attached to an assessment, optionally tagged to one of the six PBRS
dimensions for traceability (see `DimensionEvidencePanel` in the
frontend).

**Key fields:** `id`, `assessment_id`, `type` (`EvidenceType`), `title`,
`note`, `file_url`, `external_url`, `uploaded_by_user_id`,
`related_dimension` (one of the six `PBRSDimensionKey` values).

**Relationships:** Child of `assessments` (`ON DELETE CASCADE`);
referenced by `pbrs_dimension_scores.evidence_ids` (array of UUIDs, not a
formal FK — see that table's notes).

**Indexes:** `(assessment_id)`, `(assessment_id, related_dimension)`.

**Audit considerations:** Becomes immutable once the parent assessment is
submitted — edit/delete return `403` per the API contract at that point.

**Deletion/retention notes:** Soft-deletable pre-submission only;
post-submission evidence is retained as part of the assessment's
permanent record.

---

## pbrs_scores

**Purpose:** Stores the exact `PBRSScore` object produced by
`@phoenix/pbrs`'s scoring engine so **no scoring logic is duplicated in
the database layer** — this table is a snapshot store, not a
computation engine. **This backend foundation sprint does not implement,
call, or modify the scoring engine.**

**Key fields:** `id`, `assessment_id`, `summary` (JSONB — full
`PBRSScore` shape: overall, grade, tier, dimensions, confidenceIndex,
riskLevel, automationReadiness), `has_overrides`, `scored_by_user_id`,
`scoring_method` (`Automated` / `Manual`).

**Relationships:** 1:1 with `assessments` (one active score row;
re-scoring inserts a new row and re-points `assessments.score_id` —
prior rows are retained for audit history, never deleted); parent of
`pbrs_dimension_scores` and `derived_signals`.

**Indexes:** Unique on `(assessment_id)`. Index on `(assessment_id)`.

**Audit considerations:** Every override write
(`PATCH /api/assessments/:assessmentId/score/override`) is documented as
writing one `AuditRecord` per override.

**Deletion/retention notes:** Prior score rows are retained (not deleted)
for audit history even after re-scoring.

---

## pbrs_dimension_scores

**Purpose:** Per-dimension breakdown of a `pbrs_scores` row — exactly the
six PBRS dimensions currently defined in `@phoenix/core`'s
`PBRS_DIMENSIONS` (Accuracy, Compliance, Brand Alignment, Structure,
Consistency, Completeness). **This backend does not define, weight, or
alter PBRS dimensions — `@phoenix/core` remains the single source of
truth.**

**Key fields:** `id`, `score_id`, `dimension`, `value` (`NUMERIC(5,2)`,
0–100), `evidence_ids` (`UUID[]`), `is_overridden`, `override_reason`,
`overridden_by_user_id`.

**Relationships:** Child of `pbrs_scores` (`ON DELETE CASCADE`).
`evidence_ids` references `evidence_items.id` values by convention, not
a declared array FK (PostgreSQL does not support array foreign keys
natively; validated at the application layer in a future sprint).

**Indexes:** Unique on `(score_id, dimension)`.

**Audit considerations:** `CHECK (value >= 0 AND value <= 100)`.
`CHECK (NOT is_overridden OR (override_reason IS NOT NULL AND
array_length(evidence_ids, 1) > 0))` — an override always requires a
reason and at least one evidence item.

**Deletion/retention notes:** Cascades with parent `pbrs_scores` row;
since score rows are never deleted (only superseded), dimension rows are
effectively permanent history too.

---

## derived_signals

**Purpose:** Stores the three derived signals (`riskLevel`,
`confidenceIndex`, `automationReadiness`) that accompany a PBRS score.
Per user-provided context, these are **derived signals only, not
weighted scoring dimensions** — this table's shape reflects that; there
is no `weight` column here, unlike a true dimension table.

**Key fields:** `id`, `score_id`, `key` (`riskLevel` /
`confidenceIndex` / `automationReadiness`), `value_text` (populated when
`key = 'riskLevel'`), `value_numeric` (`NUMERIC(4,3)`, populated when
`key` is `confidenceIndex` or `automationReadiness`, range 0–1).

**Relationships:** Child of `pbrs_scores` (`ON DELETE CASCADE`).

**Indexes:** Unique on `(score_id, key)`.

**Audit considerations:** No direct write path other than the scoring
engine — these are always derived, never independently editable via API.

**Deletion/retention notes:** Cascades with parent `pbrs_scores` row.

---

## pbrs_passports

**Purpose:** The issued, verifiable record that an asset version cleared
assessment at a given score/grade. Format:
`PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL]`.

**Key fields:** `id`, `passport_id` (human-readable, unique), `workspace_id`, `asset_id`, `assessment_id`, `score_id`, `status` (`PassportStatus`), `score_snapshot`, `grade_snapshot` (`A`/`B`/`C`/`Hold`), `issued_at`, `issued_by_user_id`, `valid_from`, `valid_until`, `record_hash`, `last_verified_at`, `revoked_at`, `revoked_reason`.

**Relationships:** Child of `workspaces` (`ON DELETE CASCADE`); 1:1 with `assessments`; parent of `pbrs_certifications`.

**Indexes:** Unique on `passport_id`; unique on `(assessment_id)` (one passport per assessment). Index on `(workspace_id, status)`.

**Audit considerations:** Issue and revoke are both `AuditRecord`-worthy per the Permissions Model; `verify` updates `last_verified_at` without changing `status`.

**Deletion/retention notes:** Soft-deletable in the generic sense, but revocation (`status = 'Revoked'`) is the documented terminal action, not deletion — passports are compliance artifacts and should not be hard-deleted in practice.

---

## pbrs_certifications

**Purpose:** A formal certification tier grant (`Platinum` / `Gold` /
`Silver` / `Bronze`) against an issued passport whose score clears that
tier's threshold. **This backend does not implement, define, or alter
Certification Level / Internal Tier thresholds** — see
`certification-levels.ts` and
`PBRS_CERTIFICATION_THRESHOLD_ADDENDUM_PHX_CERT_003.md`, which remain the
sole source of truth.

**Key fields:** `id`, `certification_id` (human-readable, unique), `workspace_id`, `passport_id`, `organization_id`, `tier`, `status` (`CertificationStatus`), `score_snapshot`, `issued_date`, `expiry_date`, `granted_by_user_id`, `revoked_at`, `revoked_by_user_id`, `revoked_reason`.

**Relationships:** Child of `workspaces` (`ON DELETE CASCADE`) and `pbrs_passports`; references `organizations`.

**Indexes:** Unique on `certification_id`. Index on `(workspace_id, status)` and `(expiry_date)` (for a future expiry-sweep job).

**Audit considerations:** Revocation is intentionally restricted to
`Owner` only (stricter than passport revoke, which allows `Admin`) given
its external/legal weight, per `PERMISSIONS_MODEL_PHX_PLATFORM_002.md`.

**Deletion/retention notes:** Never hard-deleted; revoked/expired
certifications remain queryable history.

---

## report_templates

**Purpose:** Platform-seeded catalog of report types (e.g.
`executive-readiness-summary`), not workspace-scoped.

**Key fields:** `id`, `key` (unique), `name`, `description`, `scope`
(`SingleAsset` / `Workspace` / `CertificationPortfolio`),
`output_formats` (subset of `pdf`, `html`, `csv`).

**Relationships:** Parent of `reports`.

**Indexes:** Unique on `key`.

**Audit considerations:** Low-sensitivity, admin/seed data; no
per-request audit expected.

**Deletion/retention notes:** Soft-deletable; not expected to change
often post-seed.

---

## reports

**Purpose:** A requested/generated report instance from a template,
optionally scoped to a single asset.

**Key fields:** `id`, `workspace_id`, `template_id`, `name`
(denormalized), `status` (`ReportStatus`), `asset_id` (nullable),
`requested_by_user_id`, `requested_at`, `generated_at`, `file_url`,
`format` (`pdf`/`html`/`csv`), `expires_at`, `failure_reason`.

**Relationships:** Child of `workspaces` (`ON DELETE CASCADE`) and
`report_templates`; optionally references `assets`.

**Indexes:** `(workspace_id, status)`, `(expires_at)` (for a future
expiry-sweep job).

**Audit considerations:** Report requests are `C` actions available to
any active role per the Permissions Model; generation/regeneration is a
future background-job concern, not implemented this sprint.

**Deletion/retention notes:** Soft-deletable; `expires_at` sweep is a
future scheduled job, not implemented this sprint.

---

## activity_logs

**Purpose:** Human-readable workspace activity feed (dashboard "Recent
Activity" panel).

**Key fields:** `id`, `workspace_id`, `type` (`ActivityType`),
`actor_user_id` (nullable), `actor_display_name` (denormalized),
`summary`, `related_entity_type`, `related_entity_id`.

**Relationships:** Child of `workspaces` (`ON DELETE CASCADE`);
optionally references any entity via `(related_entity_type,
related_entity_id)` (polymorphic, not a formal FK).

**Indexes:** `(workspace_id, created_at DESC)` for feed pagination;
`(related_entity_type, related_entity_id)`.

**Audit considerations:** Distinct from `audit_records` — this is a
UX-facing feed, not the compliance-grade immutable trail. Any active
role can read it (contrast with `audit_records`, which is
Auditor/Admin/Owner only).

**Deletion/retention notes:** Soft-deletable; a future retention policy
(e.g. rolling window) is not defined this sprint.

---

## notifications

**Purpose:** Per-user notification inbox items (not yet surfaced in the
Alpha UI, but part of the approved contract).

**Key fields:** `id`, `workspace_id`, `recipient_user_id`, `title`,
`body`, `read_at`, `related_entity_type`, `related_entity_id`.

**Relationships:** Child of `workspaces` (`ON DELETE CASCADE`);
references `users` as recipient.

**Indexes:** `(recipient_user_id, read_at)`.

**Audit considerations:** Personal data (notification content may
reference sensitive workspace activity); no special audit requirement
beyond standard access control once auth exists.

**Deletion/retention notes:** Soft-deletable; read/unread state (`read_at`) is the primary mutable field.

---

## integrations

**Purpose:** Tracks connected external systems (document sources,
identity providers, notification channels) at the workspace level.
**Explicitly excludes credential storage** — no OAuth tokens or secrets
are modeled here.

**Key fields:** `id`, `workspace_id`, `category` (`DocumentSource` /
`IdentityProvider` / `NotificationChannel` / `Other`), `display_name`,
`status` (`IntegrationStatus`), `connected_by_user_id`, `connected_at`,
`last_sync_at`, `last_error_message`.

**Relationships:** Child of `workspaces` (`ON DELETE CASCADE`).

**Indexes:** None beyond the implicit workspace FK index; can be added
once query patterns are known.

**Audit considerations:** "Manage integrations" is an `Owner`/`Admin`-only
action per the Permissions Model. **No credential/token storage decision
is made by this schema** — that is explicitly deferred to a future,
separately-reviewed design.

**Deletion/retention notes:** Soft-deletable; disconnecting an
integration should be a status change (`status` → disconnected), not
necessarily a delete, to preserve `last_sync_at`/`last_error_message`
history.

---

## audit_records

**Purpose:** The compliance-grade, append-only audit trail. Every `U`/`D`
action documented in `PERMISSIONS_MODEL_PHX_PLATFORM_002.md` is expected
to write exactly one row here once real write endpoints exist. **This
backend foundation sprint does not write to this table** — no business
logic is implemented yet.

**Key fields:** `id`, `workspace_id`, `created_at`, `actor_user_id`
(nullable — e.g. system-initiated actions), `action` (e.g.
`assessment.decision.approved`), `entity_type`, `entity_id`, `changes`
(JSONB, `{ field: [before, after] }`), `context`.

**Relationships:** References `workspaces` (`ON DELETE RESTRICT` — audit
history must survive workspace edits, unlike other workspace-scoped
tables which cascade) and optionally `users`.

**Indexes:** `(workspace_id, created_at DESC)`, `(entity_type,
entity_id)`, `(actor_user_id)`.

**Audit considerations:** This table **has no `deleted_at` column** and
is never soft- or hard-deleted. At the database level, `UPDATE`/`DELETE`
grants should be revoked from the application role
(`REVOKE UPDATE, DELETE ON audit_records FROM app_role;`) with a
row-level `BEFORE UPDATE/DELETE` trigger as defense in depth — captured
as a TODO in the migration file, not executed this sprint (no database
connection exists to run it against).

**Deletion/retention notes:** Append-only, permanent. Read access is
restricted to `Auditor`, `Admin`, `Owner` per the Permissions Model
(enforcement itself is out of scope for this backend foundation sprint).

---

## Entity Relationship Summary

_(Unchanged from `DATABASE_SCHEMA_PHX_PLATFORM_002.md` — reproduced here
for convenience.)_

```
organizations ──< departments
organizations ──< workspaces ──< workspace_users >── users
workspaces ──< assets ──< asset_versions
assets ──< assessments >── asset_versions
assessments ──< assessment_steps
assessments ──< evidence_items
assessments ──1:1── pbrs_scores ──< pbrs_dimension_scores
pbrs_scores ──< derived_signals
assessments ──1:1── pbrs_passports
pbrs_passports ──< pbrs_certifications
workspaces ──< reports >── report_templates
workspaces ──< activity_logs
workspaces ──< notifications >── users
workspaces ──< integrations
workspaces ──< audit_records
```

---

## What this baseline deliberately does NOT do

- Does not connect to any database.
- Does not implement or invoke ORM models — see
  `apps/backend/db/README.md` for why an ORM was not installed this
  sprint.
- Does not implement row-level security, the `audit_records`
  revoke/trigger defense-in-depth described above, or any migration
  runner configuration.
- Does not change any table, column, type, or relationship from
  `DATABASE_SCHEMA_PHX_PLATFORM_002.md` — this is a faithful backend-facing
  restatement plus additive documentation only.

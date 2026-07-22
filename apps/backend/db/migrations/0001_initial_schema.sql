-- ============================================================
-- Phoenix Backend — Migration 0001: Initial Schema Baseline
-- PHX-BACKEND-001 — Backend Foundation & Database Skeleton
-- ------------------------------------------------------------
-- PostgreSQL-oriented DDL translating
-- docs/platform/DATABASE_SCHEMA_PHX_PLATFORM_002.md and
-- apps/backend/db/schema/PHOENIX_DATABASE_SCHEMA_BASELINE.md into a
-- concrete baseline migration.
--
-- THIS FILE IS NOT EXECUTED BY ANY TOOLING IN THIS SPRINT.
-- No migration runner is configured, no database connection exists in
-- the backend at boot, and this file is not referenced by any script in
-- apps/backend/package.json. It exists as a reviewable, versioned
-- artifact for a future sprint that introduces a real database.
--
-- Does not change PBRS scoring logic, PBRS dimensions, Certification
-- Level thresholds, Internal Tier thresholds, or the PBRS Standard —
-- this file only creates storage for the outputs of that logic
-- (pbrs_scores, pbrs_dimension_scores, derived_signals,
-- pbrs_certifications), never the logic itself.
-- ============================================================

-- Extensions ---------------------------------------------------
-- gen_random_uuid() requires pgcrypto (or PostgreSQL 13+'s built-in
-- gen_random_uuid() from pgcrypto/uuid-ossp — using pgcrypto here as the
-- more commonly available option). CITEXT is used for case-insensitive
-- email columns.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- organizations
-- ============================================================
CREATE TABLE organizations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  org_code                VARCHAR(12) NOT NULL,
  primary_contact_email   TEXT NULL,
  industry                TEXT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX uq_organizations_org_code ON organizations (upper(org_code));

-- ============================================================
-- departments
-- ============================================================
CREATE TABLE departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  description     TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL
);

CREATE INDEX idx_departments_organization_id ON departments (organization_id);
CREATE UNIQUE INDEX uq_departments_org_name ON departments (organization_id, lower(name))
  WHERE deleted_at IS NULL;

-- ============================================================
-- workspaces
-- ============================================================
CREATE TABLE workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb, -- WorkspaceSettings shape
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ NULL
);

CREATE INDEX idx_workspaces_organization_id ON workspaces (organization_id);
CREATE UNIQUE INDEX uq_workspaces_slug ON workspaces (slug) WHERE deleted_at IS NULL;

-- ============================================================
-- users
-- ============================================================
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT NOT NULL,
  display_name   TEXT NOT NULL,
  platform_role  TEXT NOT NULL, -- UserRole: 'SuperAdmin' | 'StandardUser' | 'ServiceAccount'
  avatar_url     TEXT NULL,
  last_login_at  TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ NULL,
  CONSTRAINT chk_users_platform_role CHECK (platform_role IN ('SuperAdmin', 'StandardUser', 'ServiceAccount'))
);

CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE deleted_at IS NULL;

-- ============================================================
-- workspace_users  (WorkspaceMembership)
-- ============================================================
CREATE TABLE workspace_users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, -- cascades only on full workspace teardown
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role                TEXT NOT NULL, -- WorkspaceRole
  status              TEXT NOT NULL, -- 'Active' | 'Suspended' | 'Invited'
  invited_by_user_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ NULL,
  CONSTRAINT chk_workspace_users_role CHECK (role IN ('Owner', 'Admin', 'Reviewer', 'Contributor', 'Viewer', 'Auditor')),
  CONSTRAINT chk_workspace_users_status CHECK (status IN ('Active', 'Suspended', 'Invited'))
);

CREATE UNIQUE INDEX uq_workspace_users_workspace_user ON workspace_users (workspace_id, user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_workspace_users_user_id ON workspace_users (user_id);
CREATE INDEX idx_workspace_users_workspace_role ON workspace_users (workspace_id, role);

-- ============================================================
-- assets
-- ============================================================
CREATE TABLE assets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  type                    TEXT NOT NULL, -- AssetType
  department              TEXT NOT NULL,
  owner_user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status                  TEXT NOT NULL, -- AssetStatus
  current_version_id      UUID NULL, -- FK added below after asset_versions exists (deferred/nullable)
  last_assessed_at        TIMESTAMPTZ NULL, -- denormalized
  latest_score_snapshot   NUMERIC(5,2) NULL, -- denormalized
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ NULL
);

CREATE INDEX idx_assets_workspace_status ON assets (workspace_id, status);
CREATE INDEX idx_assets_workspace_owner ON assets (workspace_id, owner_user_id);
CREATE INDEX idx_assets_workspace_department ON assets (workspace_id, department);

-- ============================================================
-- asset_versions
-- ============================================================
CREATE TABLE asset_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  content             TEXT NULL,
  content_url         TEXT NULL,
  content_type        TEXT NOT NULL,
  created_by_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_note         TEXT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(), -- immutable in practice post-insert
  deleted_at          TIMESTAMPTZ NULL,
  CONSTRAINT chk_asset_versions_content CHECK (content IS NOT NULL OR content_url IS NOT NULL)
);

CREATE UNIQUE INDEX uq_asset_versions_asset_version ON asset_versions (asset_id, version_number);
CREATE INDEX idx_asset_versions_asset_id ON asset_versions (asset_id);

-- Now that asset_versions exists, add the deferred FK from assets.
ALTER TABLE assets
  ADD CONSTRAINT fk_assets_current_version
  FOREIGN KEY (current_version_id) REFERENCES asset_versions(id) ON DELETE SET NULL;

-- ============================================================
-- assessments
-- ============================================================
CREATE TABLE assessments (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id                    UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  asset_version_id            UUID NOT NULL REFERENCES asset_versions(id) ON DELETE RESTRICT,
  status                      TEXT NOT NULL, -- AssessmentStatus
  requested_by_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_reviewer_user_id   UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  submitted_at                TIMESTAMPTZ NULL,
  decided_at                  TIMESTAMPTZ NULL,
  decision_notes              TEXT NULL,
  score_id                    UUID NULL, -- FK added below after pbrs_scores exists (deferred/nullable)
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ NULL
);

CREATE INDEX idx_assessments_workspace_status ON assessments (workspace_id, status);
CREATE INDEX idx_assessments_asset_id ON assessments (asset_id);
CREATE INDEX idx_assessments_reviewer_status ON assessments (assigned_reviewer_user_id, status);

-- ============================================================
-- assessment_steps
-- ============================================================
CREATE TABLE assessment_steps (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id     UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  sequence          SMALLINT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL, -- AssessmentStepStatus
  assigned_user_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  completed_at      TIMESTAMPTZ NULL,
  notes             TEXT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX uq_assessment_steps_sequence ON assessment_steps (assessment_id, sequence);

-- ============================================================
-- evidence_items
-- ============================================================
CREATE TABLE evidence_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id         UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL, -- EvidenceType
  title                 TEXT NOT NULL,
  note                  TEXT NULL,
  file_url              TEXT NULL,
  external_url          TEXT NULL,
  uploaded_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  related_dimension     TEXT NULL, -- one of the six PBRSDimensionKey values
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ NULL
);

CREATE INDEX idx_evidence_items_assessment_id ON evidence_items (assessment_id);
CREATE INDEX idx_evidence_items_assessment_dimension ON evidence_items (assessment_id, related_dimension);

-- ============================================================
-- pbrs_scores
-- Stores the PBRSScore snapshot exactly as produced by @phoenix/pbrs.
-- No scoring logic lives in this schema.
-- ============================================================
CREATE TABLE pbrs_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id         UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  summary               JSONB NOT NULL, -- PBRSScore shape (overall, grade, tier, dimensions, confidenceIndex, riskLevel, automationReadiness)
  has_overrides         BOOLEAN NOT NULL DEFAULT false,
  scored_by_user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  scoring_method        TEXT NOT NULL, -- 'Automated' | 'Manual'
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ NULL,
  CONSTRAINT chk_pbrs_scores_method CHECK (scoring_method IN ('Automated', 'Manual'))
);

-- One active score row per assessment; re-scoring inserts a new row and
-- re-points assessments.score_id (prior rows retained for audit history).
CREATE UNIQUE INDEX uq_pbrs_scores_assessment ON pbrs_scores (assessment_id);

-- Now that pbrs_scores exists, add the deferred FK from assessments.
ALTER TABLE assessments
  ADD CONSTRAINT fk_assessments_score
  FOREIGN KEY (score_id) REFERENCES pbrs_scores(id) ON DELETE SET NULL;

-- ============================================================
-- pbrs_dimension_scores
-- Exactly the six PBRS dimensions defined in @phoenix/core's
-- PBRS_DIMENSIONS. This table stores values only — dimension keys,
-- weights, and scoring logic are NOT defined here.
-- ============================================================
CREATE TABLE pbrs_dimension_scores (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id                UUID NOT NULL REFERENCES pbrs_scores(id) ON DELETE CASCADE,
  dimension               TEXT NOT NULL, -- one of the six PBRSDimensionKey values
  value                   NUMERIC(5,2) NOT NULL,
  evidence_ids            UUID[] NOT NULL DEFAULT '{}',
  is_overridden           BOOLEAN NOT NULL DEFAULT false,
  override_reason         TEXT NULL,
  overridden_by_user_id   UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ NULL,
  CONSTRAINT chk_pbrs_dimension_scores_value CHECK (value >= 0 AND value <= 100),
  CONSTRAINT chk_pbrs_dimension_scores_override
    CHECK (NOT is_overridden OR (override_reason IS NOT NULL AND array_length(evidence_ids, 1) > 0))
);

CREATE UNIQUE INDEX uq_pbrs_dimension_scores_score_dimension ON pbrs_dimension_scores (score_id, dimension);

-- ============================================================
-- derived_signals
-- Derived signals only (riskLevel, confidenceIndex, automationReadiness)
-- — not weighted scoring dimensions. No direct write path other than the
-- scoring engine.
-- ============================================================
CREATE TABLE derived_signals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id       UUID NOT NULL REFERENCES pbrs_scores(id) ON DELETE CASCADE,
  key            TEXT NOT NULL, -- 'riskLevel' | 'confidenceIndex' | 'automationReadiness'
  value_text     TEXT NULL, -- populated when key = 'riskLevel'
  value_numeric  NUMERIC(4,3) NULL, -- populated when key is confidenceIndex/automationReadiness (0-1)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ NULL,
  CONSTRAINT chk_derived_signals_key CHECK (key IN ('riskLevel', 'confidenceIndex', 'automationReadiness'))
);

CREATE UNIQUE INDEX uq_derived_signals_score_key ON derived_signals (score_id, key);

-- ============================================================
-- pbrs_passports
-- ============================================================
CREATE TABLE pbrs_passports (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_id          TEXT NOT NULL, -- human-readable PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL]
  workspace_id         UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  asset_id             UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  assessment_id        UUID NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT,
  score_id             UUID NOT NULL REFERENCES pbrs_scores(id) ON DELETE RESTRICT,
  status               TEXT NOT NULL, -- PassportStatus
  score_snapshot       NUMERIC(5,2) NOT NULL,
  grade_snapshot       TEXT NOT NULL, -- 'A' | 'B' | 'C' | 'Hold'
  issued_at            TIMESTAMPTZ NULL,
  issued_by_user_id    UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  valid_from           TIMESTAMPTZ NULL,
  valid_until          TIMESTAMPTZ NULL,
  record_hash          TEXT NOT NULL,
  last_verified_at     TIMESTAMPTZ NULL,
  revoked_at           TIMESTAMPTZ NULL,
  revoked_reason       TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ NULL,
  CONSTRAINT chk_pbrs_passports_grade CHECK (grade_snapshot IN ('A', 'B', 'C', 'Hold'))
);

CREATE UNIQUE INDEX uq_pbrs_passports_passport_id ON pbrs_passports (passport_id);
CREATE UNIQUE INDEX uq_pbrs_passports_assessment ON pbrs_passports (assessment_id);
CREATE INDEX idx_pbrs_passports_workspace_status ON pbrs_passports (workspace_id, status);

-- ============================================================
-- pbrs_certifications
-- Certification Level / Internal Tier THRESHOLDS are not defined or
-- enforced here — this table stores the outcome only.
-- ============================================================
CREATE TABLE pbrs_certifications (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id       TEXT NOT NULL, -- human-readable PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL]
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  passport_id            UUID NOT NULL REFERENCES pbrs_passports(id) ON DELETE RESTRICT,
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  tier                   TEXT NOT NULL, -- 'Platinum' | 'Gold' | 'Silver' | 'Bronze'
  status                 TEXT NOT NULL, -- CertificationStatus
  score_snapshot         NUMERIC(5,2) NOT NULL,
  issued_date            DATE NULL,
  expiry_date            DATE NULL,
  granted_by_user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  revoked_at             TIMESTAMPTZ NULL,
  revoked_by_user_id     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  revoked_reason         TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ NULL,
  CONSTRAINT chk_pbrs_certifications_tier CHECK (tier IN ('Platinum', 'Gold', 'Silver', 'Bronze'))
);

CREATE UNIQUE INDEX uq_pbrs_certifications_certification_id ON pbrs_certifications (certification_id);
CREATE INDEX idx_pbrs_certifications_workspace_status ON pbrs_certifications (workspace_id, status);
CREATE INDEX idx_pbrs_certifications_expiry_date ON pbrs_certifications (expiry_date);

-- ============================================================
-- report_templates  (platform-seeded, not workspace-scoped)
-- ============================================================
CREATE TABLE report_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key              TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL,
  scope            TEXT NOT NULL, -- 'SingleAsset' | 'Workspace' | 'CertificationPortfolio'
  output_formats   TEXT[] NOT NULL DEFAULT '{}', -- subset of 'pdf', 'html', 'csv'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ NULL,
  CONSTRAINT chk_report_templates_scope CHECK (scope IN ('SingleAsset', 'Workspace', 'CertificationPortfolio'))
);

CREATE UNIQUE INDEX uq_report_templates_key ON report_templates (key);

-- ============================================================
-- reports
-- ============================================================
CREATE TABLE reports (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id           UUID NOT NULL REFERENCES report_templates(id) ON DELETE RESTRICT,
  name                  TEXT NOT NULL, -- denormalized
  status                TEXT NOT NULL, -- ReportStatus
  asset_id              UUID NULL REFERENCES assets(id) ON DELETE SET NULL,
  requested_by_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at          TIMESTAMPTZ NOT NULL,
  generated_at          TIMESTAMPTZ NULL,
  file_url              TEXT NULL,
  format                TEXT NOT NULL, -- 'pdf' | 'html' | 'csv'
  expires_at            TIMESTAMPTZ NULL,
  failure_reason        TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ NULL,
  CONSTRAINT chk_reports_format CHECK (format IN ('pdf', 'html', 'csv'))
);

CREATE INDEX idx_reports_workspace_status ON reports (workspace_id, status);
CREATE INDEX idx_reports_expires_at ON reports (expires_at);

-- ============================================================
-- activity_logs
-- ============================================================
CREATE TABLE activity_logs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL, -- ActivityType
  actor_user_id          UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  actor_display_name     TEXT NOT NULL, -- denormalized
  summary                TEXT NOT NULL,
  related_entity_type    TEXT NULL,
  related_entity_id      UUID NULL, -- polymorphic reference; not a formal FK
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ NULL
);

CREATE INDEX idx_activity_logs_workspace_created_at ON activity_logs (workspace_id, created_at DESC);
CREATE INDEX idx_activity_logs_related_entity ON activity_logs (related_entity_type, related_entity_id);

-- ============================================================
-- notifications
-- ============================================================
CREATE TABLE notifications (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                  TEXT NOT NULL,
  body                   TEXT NOT NULL,
  read_at                TIMESTAMPTZ NULL,
  related_entity_type    TEXT NULL,
  related_entity_id      UUID NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ NULL
);

CREATE INDEX idx_notifications_recipient_read ON notifications (recipient_user_id, read_at);

-- ============================================================
-- integrations
-- No vendor-specific credential columns (e.g. OAuth tokens) are defined
-- here — credential storage is a future, separately-reviewed decision.
-- ============================================================
CREATE TABLE integrations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category               TEXT NOT NULL, -- 'DocumentSource' | 'IdentityProvider' | 'NotificationChannel' | 'Other'
  display_name           TEXT NOT NULL,
  status                 TEXT NOT NULL, -- IntegrationStatus
  connected_by_user_id   UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  connected_at           TIMESTAMPTZ NULL,
  last_sync_at           TIMESTAMPTZ NULL,
  last_error_message     TEXT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ NULL,
  CONSTRAINT chk_integrations_category CHECK (category IN ('DocumentSource', 'IdentityProvider', 'NotificationChannel', 'Other'))
);

-- ============================================================
-- audit_records
-- Append-only. No deleted_at column — records are never removed.
-- ============================================================
CREATE TABLE audit_records (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT, -- audit history must survive workspace edits
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL, -- e.g. 'assessment.decision.approved'
  entity_type    TEXT NOT NULL,
  entity_id      UUID NOT NULL,
  changes        JSONB NOT NULL, -- { field: [before, after] }
  context        TEXT NULL
);

CREATE INDEX idx_audit_records_workspace_created_at ON audit_records (workspace_id, created_at DESC);
CREATE INDEX idx_audit_records_entity ON audit_records (entity_type, entity_id);
CREATE INDEX idx_audit_records_actor ON audit_records (actor_user_id);

-- TODO (future sprint, NOT executed here — no database connection exists
-- in this backend foundation to run it against):
--   REVOKE UPDATE, DELETE ON audit_records FROM app_role;
--   Plus a row-level BEFORE UPDATE/DELETE trigger that raises an
--   exception, as defense in depth per
--   docs/platform/DATABASE_SCHEMA_PHX_PLATFORM_002.md.

-- ============================================================
-- End of migration 0001.
-- ============================================================

-- ============================================================
-- Phoenix Backend — Migration 0007: Intake Workspace Handoffs
-- PHX-LAUNCH-002-R1 — Data Model and Intake Handoff Contract
-- ------------------------------------------------------------
-- Durable Backend-owned ledger for converting an accepted public
-- intake request into one Phoenix organization, workspace, user,
-- invited Owner membership, and append-only audit record.
--
-- This migration adds schema only. It does not implement an API,
-- provisioning runtime, public onboarding, invitation delivery,
-- identity resolution, or Assessment creation.
--
-- Website intake tables remain a separate bounded context. No
-- cross-database foreign key or distributed transaction exists.
-- ============================================================

CREATE TABLE intake_workspace_handoffs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system              TEXT NOT NULL,
  source_reference           TEXT NOT NULL,
  source_request_type        TEXT NOT NULL,
  source_payload_fingerprint TEXT NOT NULL,
  status                     TEXT NOT NULL,

  organization_id            UUID NULL
    REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id               UUID NULL
    REFERENCES workspaces(id) ON DELETE RESTRICT,
  primary_user_id            UUID NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  membership_id              UUID NULL
    REFERENCES workspace_users(id) ON DELETE RESTRICT,
  assessment_id              UUID NULL
    REFERENCES assessments(id) ON DELETE RESTRICT,

  created_by_user_id         UUID NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,
  completed_at               TIMESTAMPTZ NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_intake_workspace_handoffs_source_system
    CHECK (source_system = 'phoenix_public_intake'),

  CONSTRAINT chk_intake_workspace_handoffs_source_reference
    CHECK (
      source_reference = btrim(source_reference)
      AND char_length(source_reference) BETWEEN 1 AND 100
    ),

  CONSTRAINT chk_intake_workspace_handoffs_request_type
    CHECK (source_request_type IN ('assessment', 'demo', 'general')),

  CONSTRAINT chk_intake_workspace_handoffs_fingerprint
    CHECK (source_payload_fingerprint ~ '^[0-9a-f]{64}$'),

  CONSTRAINT chk_intake_workspace_handoffs_status
    CHECK (status IN ('Processing', 'Completed')),

  CONSTRAINT chk_intake_workspace_handoffs_assessment_deferred
    CHECK (assessment_id IS NULL),

  CONSTRAINT chk_intake_workspace_handoffs_state_consistency
    CHECK (
      (
        status = 'Processing'
        AND organization_id IS NULL
        AND workspace_id IS NULL
        AND primary_user_id IS NULL
        AND membership_id IS NULL
        AND assessment_id IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        status = 'Completed'
        AND organization_id IS NOT NULL
        AND workspace_id IS NOT NULL
        AND primary_user_id IS NOT NULL
        AND membership_id IS NOT NULL
        AND assessment_id IS NULL
        AND completed_at IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX uq_intake_workspace_handoffs_source
  ON intake_workspace_handoffs (source_system, source_reference);

CREATE INDEX idx_intake_workspace_handoffs_status
  ON intake_workspace_handoffs (status);

CREATE INDEX idx_intake_workspace_handoffs_workspace_id
  ON intake_workspace_handoffs (workspace_id);

CREATE INDEX idx_intake_workspace_handoffs_primary_user_id
  ON intake_workspace_handoffs (primary_user_id);

CREATE INDEX idx_intake_workspace_handoffs_created_at
  ON intake_workspace_handoffs (created_at);

-- ============================================================
-- Handoff ledger immutability
-- ------------------------------------------------------------
-- Processing rows permit exactly one UPDATE: the atomic
-- Processing-to-Completed transition. Completed rows are permanent
-- and read-only. DELETE is prohibited for every ledger row.
-- ============================================================

CREATE FUNCTION enforce_intake_workspace_handoff_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Processing' THEN
      RAISE EXCEPTION
        'new intake_workspace_handoffs rows must start as Processing';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'intake_workspace_handoffs rows cannot be deleted';
  END IF;

  IF OLD.status = 'Completed' THEN
    RAISE EXCEPTION 'completed intake_workspace_handoffs rows are immutable';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.source_system IS DISTINCT FROM OLD.source_system
    OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
    OR NEW.source_request_type IS DISTINCT FROM OLD.source_request_type
    OR NEW.source_payload_fingerprint IS DISTINCT FROM
       OLD.source_payload_fingerprint
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'immutable intake_workspace_handoffs fields cannot change';
  END IF;

  IF OLD.status <> 'Processing' OR NEW.status <> 'Completed' THEN
    RAISE EXCEPTION 'only Processing to Completed transition is permitted';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'updated_at cannot move backwards';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_intake_workspace_handoffs_immutable
BEFORE INSERT OR UPDATE OR DELETE ON intake_workspace_handoffs
FOR EACH ROW
EXECUTE FUNCTION enforce_intake_workspace_handoff_immutability();

-- ============================================================
-- End of migration 0007.
-- ============================================================

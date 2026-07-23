-- ============================================================
-- Phoenix Backend — Dev Seed 0001
-- PHX-BACKEND-003 — Read-Only Workspace & Assessment Endpoints
-- ------------------------------------------------------------
-- Deterministic, idempotent development seed data used to exercise the
-- read-only endpoints implemented in this sprint (workspace read,
-- assessment list/detail, evidence list, score read). This file is NOT
-- executed automatically by any application code path — it only runs
-- via the manual `db:seed` / `db:seed:dev` CLI command (see
-- src/db/seed.ts), and only after migration 0001_initial_schema.sql has
-- been applied.
--
-- All primary keys below are fixed, deterministic UUIDs (not
-- gen_random_uuid()) so the same seed can be re-run safely and so the
-- IDs used in this file's companion QA report and smoke tests are
-- reproducible across machines. Every INSERT uses ON CONFLICT (id) DO
-- NOTHING, so re-running this file after a partial or full prior run is
-- a no-op rather than an error.
--
-- ID convention: 000000XX-1111-4111-8111-NNNNNNNNNNNN
--   XX = entity-type marker (01 org, 02 department, 03 workspace,
--        04 user, 05 workspace_user, 06 asset, 07 asset_version,
--        08 assessment, 09 assessment_step, 0a evidence_item,
--        0b pbrs_score, 0c pbrs_dimension_score, 0d derived_signal,
--        0e pbrs_passport, 0f activity_log, 10 audit_record,
--        11 report_template — added PHX-REPORTS-003)
--   NNNN... = 12-digit sequence within that entity type.
--
-- Sample record names ("Acme Enterprise", "Acme Enterprise Workspace",
-- slug "acme-enterprise") intentionally reuse the same illustrative
-- values already shown in docs/platform/API_CONTRACT_PHX_PLATFORM_002.md
-- §1's sample response — these are generic placeholder/demo values, not
-- an import from apps/platform's sample-data.ts (which this backend
-- does not reference in any form). See
-- docs/backend/PHX_BACKEND_003_SEED_DATA_REPORT.md for the full record
-- inventory and rationale.
--
-- PBRS six dimensions used below (values only — no scoring logic, no
-- weights, no thresholds are defined or altered here):
--   accuracy, compliance, brandAlignment, structure, consistency,
--   completeness
-- No 'Business Logic' or 'Clarity' dimension is introduced.
-- ============================================================

BEGIN;

-- ============================================================
-- organizations (1)
-- ============================================================
INSERT INTO organizations (id, name, org_code, primary_contact_email, industry, created_at, updated_at)
VALUES (
  '00000001-1111-4111-8111-000000000001',
  'Acme Enterprise',
  'ACME',
  'ops@acme-enterprise.example',
  'Financial Services',
  '2026-01-10T09:00:00Z',
  '2026-06-01T09:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- departments (1)
-- ============================================================
INSERT INTO departments (id, organization_id, name, description, created_at, updated_at)
VALUES (
  '00000002-1111-4111-8111-000000000001',
  '00000001-1111-4111-8111-000000000001',
  'Corporate Communications',
  'Owns external and executive-facing communications for Acme Enterprise.',
  '2026-01-10T09:05:00Z',
  '2026-01-10T09:05:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- workspaces (1)
-- ============================================================
INSERT INTO workspaces (id, organization_id, name, slug, settings, created_at, updated_at)
VALUES (
  '00000003-1111-4111-8111-000000000001',
  '00000001-1111-4111-8111-000000000001',
  'Acme Enterprise Workspace',
  'acme-enterprise',
  '{"scoreThresholdOverride": null, "autoIssuePassports": false, "timezone": "Asia/Dubai"}'::jsonb,
  '2026-01-10T09:00:00Z',
  '2026-06-01T09:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- users (3)
-- ============================================================
INSERT INTO users (id, email, display_name, platform_role, avatar_url, last_login_at, created_at, updated_at)
VALUES
  ('00000004-1111-4111-8111-000000000001', 'maya.chen@acme-enterprise.example', 'Maya Chen', 'SuperAdmin', NULL, '2026-07-01T08:00:00Z', '2026-01-10T09:10:00Z', '2026-07-01T08:00:00Z'),
  ('00000004-1111-4111-8111-000000000002', 'owen.fischer@acme-enterprise.example', 'Owen Fischer', 'StandardUser', NULL, '2026-06-28T14:30:00Z', '2026-01-12T10:00:00Z', '2026-06-28T14:30:00Z'),
  ('00000004-1111-4111-8111-000000000003', 'priya.nair@acme-enterprise.example', 'Priya Nair', 'StandardUser', NULL, '2026-06-30T11:15:00Z', '2026-01-15T11:00:00Z', '2026-06-30T11:15:00Z')
ON CONFLICT (id) DO NOTHING;

-- PHX-BACKEND-006: two additional users so every WorkspaceRole has at
-- least one seeded, Active member for permission QA (the original
-- PHX-BACKEND-003 seed only covered Owner/Reviewer/Contributor).
-- Appended as new rows, not a rewrite of the block above, so this
-- remains idempotent against any environment where 0001_dev_seed.sql
-- has already been run once.
INSERT INTO users (id, email, display_name, platform_role, avatar_url, last_login_at, created_at, updated_at)
VALUES
  ('00000004-1111-4111-8111-000000000004', 'sofia.reyes@acme-enterprise.example', 'Sofia Reyes', 'StandardUser', NULL, '2026-06-27T09:45:00Z', '2026-01-16T09:00:00Z', '2026-06-27T09:45:00Z'),
  ('00000004-1111-4111-8111-000000000005', 'daniel.okafor@acme-enterprise.example', 'Daniel Okafor', 'StandardUser', NULL, '2026-06-29T13:20:00Z', '2026-01-17T09:00:00Z', '2026-06-29T13:20:00Z')
ON CONFLICT (id) DO NOTHING;

-- PHX-BACKEND-007 Task 11: an Admin-role user. PHX-BACKEND-006's seed
-- covered Owner/Reviewer/Contributor/Viewer/Auditor but had no Admin
-- member at all — this sprint's permission/ownership QA needs one
-- (Admin is granted every permission identically to Owner in
-- permissions.ts, and every ownership predicate in
-- src/auth/ownership.ts treats Admin the same as Owner — a seeded
-- Admin member is the only way to exercise that "Admin behaves like
-- Owner" claim against real seeded data rather than by code
-- inspection alone). Appended, idempotent, matching the blocks above.
INSERT INTO users (id, email, display_name, platform_role, avatar_url, last_login_at, created_at, updated_at)
VALUES
  ('00000004-1111-4111-8111-000000000006', 'elena.vasquez@acme-enterprise.example', 'Elena Vasquez', 'StandardUser', NULL, '2026-07-01T10:00:00Z', '2026-01-18T09:00:00Z', '2026-07-01T10:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- workspace_users (3)
-- ============================================================
INSERT INTO workspace_users (id, workspace_id, user_id, role, status, invited_by_user_id, created_at, updated_at)
VALUES
  ('00000005-1111-4111-8111-000000000001', '00000003-1111-4111-8111-000000000001', '00000004-1111-4111-8111-000000000001', 'Owner', 'Active', NULL, '2026-01-10T09:10:00Z', '2026-01-10T09:10:00Z'),
  ('00000005-1111-4111-8111-000000000002', '00000003-1111-4111-8111-000000000001', '00000004-1111-4111-8111-000000000002', 'Reviewer', 'Active', '00000004-1111-4111-8111-000000000001', '2026-01-12T10:00:00Z', '2026-01-12T10:00:00Z'),
  ('00000005-1111-4111-8111-000000000003', '00000003-1111-4111-8111-000000000001', '00000004-1111-4111-8111-000000000003', 'Contributor', 'Active', '00000004-1111-4111-8111-000000000001', '2026-01-15T11:00:00Z', '2026-01-15T11:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- PHX-BACKEND-006: Viewer and Auditor memberships for the same two new
-- users above, both Active, so PHX_BACKEND_006_PERMISSION_QA_REPORT.md
-- can exercise every WorkspaceRole's permission matrix against real
-- seeded data. Appended, idempotent (ON CONFLICT (id) DO NOTHING),
-- matching the block above.
INSERT INTO workspace_users (id, workspace_id, user_id, role, status, invited_by_user_id, created_at, updated_at)
VALUES
  ('00000005-1111-4111-8111-000000000004', '00000003-1111-4111-8111-000000000001', '00000004-1111-4111-8111-000000000004', 'Viewer', 'Active', '00000004-1111-4111-8111-000000000001', '2026-01-16T09:00:00Z', '2026-01-16T09:00:00Z'),
  ('00000005-1111-4111-8111-000000000005', '00000003-1111-4111-8111-000000000001', '00000004-1111-4111-8111-000000000005', 'Auditor', 'Active', '00000004-1111-4111-8111-000000000001', '2026-01-17T09:00:00Z', '2026-01-17T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- PHX-BACKEND-007 Task 11: Admin membership for the new user above.
INSERT INTO workspace_users (id, workspace_id, user_id, role, status, invited_by_user_id, created_at, updated_at)
VALUES
  ('00000005-1111-4111-8111-000000000006', '00000003-1111-4111-8111-000000000001', '00000004-1111-4111-8111-000000000006', 'Admin', 'Active', '00000004-1111-4111-8111-000000000001', '2026-01-18T09:00:00Z', '2026-01-18T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- assets (3)
-- ============================================================
INSERT INTO assets (id, workspace_id, name, type, department, owner_user_id, status, current_version_id, last_assessed_at, latest_score_snapshot, created_at, updated_at)
VALUES
  ('00000006-1111-4111-8111-000000000001', '00000003-1111-4111-8111-000000000001', 'Q3 Investor Update Draft', 'Board Report', 'Corporate Communications', '00000004-1111-4111-8111-000000000003', 'Certified', NULL, '2026-06-20T12:00:00Z', 87.15, '2026-05-01T09:00:00Z', '2026-06-20T12:00:00Z'),
  ('00000006-1111-4111-8111-000000000002', '00000003-1111-4111-8111-000000000001', 'Customer Data Handling Policy', 'Policy Document', 'Corporate Communications', '00000004-1111-4111-8111-000000000003', 'Assessed', NULL, '2026-06-25T15:00:00Z', 76.05, '2026-05-05T09:00:00Z', '2026-06-25T15:00:00Z'),
  ('00000006-1111-4111-8111-000000000003', '00000003-1111-4111-8111-000000000001', 'Product Launch Social Campaign', 'Marketing Asset', 'Corporate Communications', '00000004-1111-4111-8111-000000000003', 'Draft', NULL, NULL, NULL, '2026-06-28T09:00:00Z', '2026-06-28T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- asset_versions (3)
-- ============================================================
INSERT INTO asset_versions (id, asset_id, version_number, content, content_url, content_type, created_by_user_id, change_note, created_at, updated_at)
VALUES
  ('00000007-1111-4111-8111-000000000001', '00000006-1111-4111-8111-000000000001', 1, NULL, 'https://assets.phoenixops.ai/dev-seed/q3-investor-update-v1.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '00000004-1111-4111-8111-000000000003', 'Initial draft for review.', '2026-05-01T09:00:00Z', '2026-05-01T09:00:00Z'),
  ('00000007-1111-4111-8111-000000000002', '00000006-1111-4111-8111-000000000002', 1, NULL, 'https://assets.phoenixops.ai/dev-seed/customer-data-policy-v1.pdf', 'application/pdf', '00000004-1111-4111-8111-000000000003', 'Initial policy draft.', '2026-05-05T09:00:00Z', '2026-05-05T09:00:00Z'),
  ('00000007-1111-4111-8111-000000000003', '00000006-1111-4111-8111-000000000003', 1, NULL, 'https://assets.phoenixops.ai/dev-seed/launch-campaign-v1.pdf', 'application/pdf', '00000004-1111-4111-8111-000000000003', 'Initial campaign copy draft.', '2026-06-28T09:00:00Z', '2026-06-28T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Point assets.current_version_id at the version created above.
UPDATE assets SET current_version_id = '00000007-1111-4111-8111-000000000001' WHERE id = '00000006-1111-4111-8111-000000000001';
UPDATE assets SET current_version_id = '00000007-1111-4111-8111-000000000002' WHERE id = '00000006-1111-4111-8111-000000000002';
UPDATE assets SET current_version_id = '00000007-1111-4111-8111-000000000003' WHERE id = '00000006-1111-4111-8111-000000000003';

-- ============================================================
-- assessments (3)
--   Assessment 1: Approved, has a PBRS score.
--   Assessment 2: Under Review, has a PBRS score.
--   Assessment 3: Draft, no PBRS score yet (used to exercise the
--     "assessment exists but not yet scored" 200/data:null path).
-- ============================================================
INSERT INTO assessments (id, workspace_id, asset_id, asset_version_id, status, requested_by_user_id, assigned_reviewer_user_id, submitted_at, decided_at, decision_notes, score_id, created_at, updated_at)
VALUES
  ('00000008-1111-4111-8111-000000000001', '00000003-1111-4111-8111-000000000001', '00000006-1111-4111-8111-000000000001', '00000007-1111-4111-8111-000000000001', 'Approved', '00000004-1111-4111-8111-000000000003', '00000004-1111-4111-8111-000000000002', '2026-06-15T10:00:00Z', '2026-06-20T12:00:00Z', 'Meets Enterprise readiness bar; approved without overrides.', NULL, '2026-06-10T09:00:00Z', '2026-06-20T12:00:00Z'),
  ('00000008-1111-4111-8111-000000000002', '00000003-1111-4111-8111-000000000001', '00000006-1111-4111-8111-000000000002', '00000007-1111-4111-8111-000000000002', 'Under Review', '00000004-1111-4111-8111-000000000003', '00000004-1111-4111-8111-000000000002', '2026-06-22T09:30:00Z', NULL, NULL, NULL, '2026-06-18T09:00:00Z', '2026-06-25T15:00:00Z'),
  ('00000008-1111-4111-8111-000000000003', '00000003-1111-4111-8111-000000000001', '00000006-1111-4111-8111-000000000003', '00000007-1111-4111-8111-000000000003', 'Draft', '00000004-1111-4111-8111-000000000003', NULL, NULL, NULL, NULL, NULL, '2026-06-28T09:00:00Z', '2026-06-28T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- PHX-BACKEND-007 Task 11: assessment 4 — a Draft assessment
-- requested by the workspace Owner (NOT the Contributor), on the same
-- Draft asset assessment 3 already uses. This is the seed's "at least
-- one non-Contributor-owned Draft assessment" fixture, needed to
-- exercise the ownership matrix's negative case: a Contributor
-- attempting to submit/add evidence to an assessment they did NOT
-- request should get 403 OWNERSHIP_REQUIRED even though Contributor
-- carries assessment.submit/evidence.create at the ROLE level.
-- Appended, idempotent, no rewrite of the block above.
INSERT INTO assessments (id, workspace_id, asset_id, asset_version_id, status, requested_by_user_id, assigned_reviewer_user_id, submitted_at, decided_at, decision_notes, score_id, created_at, updated_at)
VALUES
  ('00000008-1111-4111-8111-000000000004', '00000003-1111-4111-8111-000000000001', '00000006-1111-4111-8111-000000000003', '00000007-1111-4111-8111-000000000003', 'Draft', '00000004-1111-4111-8111-000000000001', '00000004-1111-4111-8111-000000000002', NULL, NULL, NULL, NULL, '2026-07-02T09:00:00Z', '2026-07-02T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- assessment_steps (4, on assessment 1)
-- ============================================================
INSERT INTO assessment_steps (id, assessment_id, sequence, name, status, assigned_user_id, completed_at, notes, created_at, updated_at)
VALUES
  ('00000009-1111-4111-8111-000000000001', '00000008-1111-4111-8111-000000000001', 1, 'Evidence Collection', 'Completed', '00000004-1111-4111-8111-000000000003', '2026-06-14T09:00:00Z', 'All required evidence attached.', '2026-06-10T09:00:00Z', '2026-06-14T09:00:00Z'),
  ('00000009-1111-4111-8111-000000000002', '00000008-1111-4111-8111-000000000001', 2, 'Automated Scoring', 'Completed', NULL, '2026-06-15T09:30:00Z', 'PBRS Engine run completed.', '2026-06-15T09:00:00Z', '2026-06-15T09:30:00Z'),
  ('00000009-1111-4111-8111-000000000003', '00000008-1111-4111-8111-000000000001', 3, 'Reviewer Assessment', 'Completed', '00000004-1111-4111-8111-000000000002', '2026-06-19T16:00:00Z', 'No unresolved dimension gaps.', '2026-06-15T10:00:00Z', '2026-06-19T16:00:00Z'),
  ('00000009-1111-4111-8111-000000000004', '00000008-1111-4111-8111-000000000001', 4, 'Final Decision', 'Completed', '00000004-1111-4111-8111-000000000002', '2026-06-20T12:00:00Z', 'Approved.', '2026-06-19T16:00:00Z', '2026-06-20T12:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- evidence_items (6, on assessment 1 — one per PBRS dimension)
-- ============================================================
INSERT INTO evidence_items (id, assessment_id, type, title, note, file_url, external_url, uploaded_by_user_id, related_dimension, created_at, updated_at)
VALUES
  ('0000000a-1111-4111-8111-000000000001', '00000008-1111-4111-8111-000000000001', 'SourceOutput', 'Investor update source figures reconciliation', 'Figures cross-checked against Q3 finance close.', 'https://assets.phoenixops.ai/dev-seed/evidence/reconciliation.xlsx', NULL, '00000004-1111-4111-8111-000000000003', 'accuracy', '2026-06-11T09:00:00Z', '2026-06-11T09:00:00Z'),
  ('0000000a-1111-4111-8111-000000000002', '00000008-1111-4111-8111-000000000001', 'ReviewerNote', 'Legal/regulatory language sign-off', 'Confirmed forward-looking statement disclaimer present.', NULL, NULL, '00000004-1111-4111-8111-000000000002', 'compliance', '2026-06-12T09:00:00Z', '2026-06-12T09:00:00Z'),
  ('0000000a-1111-4111-8111-000000000003', '00000008-1111-4111-8111-000000000001', 'Screenshot', 'Brand style guide comparison', 'Typography and tone checked against brand guidelines.', 'https://assets.phoenixops.ai/dev-seed/evidence/brand-compare.png', NULL, '00000004-1111-4111-8111-000000000003', 'brandAlignment', '2026-06-12T13:00:00Z', '2026-06-12T13:00:00Z'),
  ('0000000a-1111-4111-8111-000000000004', '00000008-1111-4111-8111-000000000001', 'Document', 'Section outline review', 'Confirmed section order matches investor update template.', 'https://assets.phoenixops.ai/dev-seed/evidence/outline-review.pdf', NULL, '00000004-1111-4111-8111-000000000003', 'structure', '2026-06-13T09:00:00Z', '2026-06-13T09:00:00Z'),
  ('0000000a-1111-4111-8111-000000000005', '00000008-1111-4111-8111-000000000001', 'ReviewerNote', 'Terminology consistency pass', 'Standardized product naming across all sections.', NULL, NULL, '00000004-1111-4111-8111-000000000002', 'consistency', '2026-06-13T15:00:00Z', '2026-06-13T15:00:00Z'),
  ('0000000a-1111-4111-8111-000000000006', '00000008-1111-4111-8111-000000000001', 'Document', 'Required sections checklist', 'All mandatory investor-update sections present.', 'https://assets.phoenixops.ai/dev-seed/evidence/checklist.pdf', NULL, '00000004-1111-4111-8111-000000000003', 'completeness', '2026-06-14T09:00:00Z', '2026-06-14T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- pbrs_scores (2 — assessments 1 and 2; assessment 3 intentionally
-- has no score row)
-- ============================================================
INSERT INTO pbrs_scores (id, assessment_id, summary, has_overrides, scored_by_user_id, scoring_method, created_at, updated_at)
VALUES
  (
    '0000000b-1111-4111-8111-000000000001',
    '00000008-1111-4111-8111-000000000001',
    '{
      "overall": 87.15,
      "grade": "B+",
      "tier": "Gold",
      "dimensions": {
        "accuracy": 92,
        "compliance": 88,
        "brandAlignment": 85,
        "structure": 90,
        "consistency": 82,
        "completeness": 84
      },
      "confidenceIndex": 0.92,
      "riskLevel": "Low",
      "automationReadiness": 0.65
    }'::jsonb,
    false,
    NULL,
    'Automated',
    '2026-06-15T09:30:00Z',
    '2026-06-15T09:30:00Z'
  ),
  (
    '0000000b-1111-4111-8111-000000000002',
    '00000008-1111-4111-8111-000000000002',
    '{
      "overall": 76.05,
      "grade": "C",
      "tier": "Bronze",
      "dimensions": {
        "accuracy": 78,
        "compliance": 75,
        "brandAlignment": 80,
        "structure": 77,
        "consistency": 72,
        "completeness": 74
      },
      "confidenceIndex": 0.81,
      "riskLevel": "Medium",
      "automationReadiness": 0.40
    }'::jsonb,
    false,
    NULL,
    'Automated',
    '2026-06-23T10:00:00Z',
    '2026-06-23T10:00:00Z'
  )
ON CONFLICT (id) DO NOTHING;

-- Point assessments.score_id at the score rows created above.
UPDATE assessments SET score_id = '0000000b-1111-4111-8111-000000000001' WHERE id = '00000008-1111-4111-8111-000000000001';
UPDATE assessments SET score_id = '0000000b-1111-4111-8111-000000000002' WHERE id = '00000008-1111-4111-8111-000000000002';

-- ============================================================
-- pbrs_dimension_scores (12 — six dimensions x two scored assessments)
-- ============================================================
INSERT INTO pbrs_dimension_scores (id, score_id, dimension, value, evidence_ids, is_overridden, override_reason, overridden_by_user_id, created_at, updated_at)
VALUES
  ('0000000c-1111-4111-8111-000000000001', '0000000b-1111-4111-8111-000000000001', 'accuracy',       92, ARRAY['0000000a-1111-4111-8111-000000000001']::uuid[], false, NULL, NULL, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000c-1111-4111-8111-000000000002', '0000000b-1111-4111-8111-000000000001', 'compliance',     88, ARRAY['0000000a-1111-4111-8111-000000000002']::uuid[], false, NULL, NULL, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000c-1111-4111-8111-000000000003', '0000000b-1111-4111-8111-000000000001', 'brandAlignment', 85, ARRAY['0000000a-1111-4111-8111-000000000003']::uuid[], false, NULL, NULL, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000c-1111-4111-8111-000000000004', '0000000b-1111-4111-8111-000000000001', 'structure',      90, ARRAY['0000000a-1111-4111-8111-000000000004']::uuid[], false, NULL, NULL, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000c-1111-4111-8111-000000000005', '0000000b-1111-4111-8111-000000000001', 'consistency',    82, ARRAY['0000000a-1111-4111-8111-000000000005']::uuid[], false, NULL, NULL, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000c-1111-4111-8111-000000000006', '0000000b-1111-4111-8111-000000000001', 'completeness',   84, ARRAY['0000000a-1111-4111-8111-000000000006']::uuid[], false, NULL, NULL, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000c-1111-4111-8111-000000000007', '0000000b-1111-4111-8111-000000000002', 'accuracy',       78, '{}'::uuid[], false, NULL, NULL, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z'),
  ('0000000c-1111-4111-8111-000000000008', '0000000b-1111-4111-8111-000000000002', 'compliance',     75, '{}'::uuid[], false, NULL, NULL, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z'),
  ('0000000c-1111-4111-8111-000000000009', '0000000b-1111-4111-8111-000000000002', 'brandAlignment', 80, '{}'::uuid[], false, NULL, NULL, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z'),
  ('0000000c-1111-4111-8111-00000000000a', '0000000b-1111-4111-8111-000000000002', 'structure',      77, '{}'::uuid[], false, NULL, NULL, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z'),
  ('0000000c-1111-4111-8111-00000000000b', '0000000b-1111-4111-8111-000000000002', 'consistency',    72, '{}'::uuid[], false, NULL, NULL, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z'),
  ('0000000c-1111-4111-8111-00000000000c', '0000000b-1111-4111-8111-000000000002', 'completeness',   74, '{}'::uuid[], false, NULL, NULL, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- derived_signals (6 — three derived signals x two scored assessments)
-- ============================================================
INSERT INTO derived_signals (id, score_id, key, value_text, value_numeric, created_at, updated_at)
VALUES
  ('0000000d-1111-4111-8111-000000000001', '0000000b-1111-4111-8111-000000000001', 'riskLevel',           'Low', NULL, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000d-1111-4111-8111-000000000002', '0000000b-1111-4111-8111-000000000001', 'confidenceIndex',     NULL, 0.920, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000d-1111-4111-8111-000000000003', '0000000b-1111-4111-8111-000000000001', 'automationReadiness', NULL, 0.650, '2026-06-15T09:30:00Z', '2026-06-15T09:30:00Z'),
  ('0000000d-1111-4111-8111-000000000004', '0000000b-1111-4111-8111-000000000002', 'riskLevel',           'Medium', NULL, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z'),
  ('0000000d-1111-4111-8111-000000000005', '0000000b-1111-4111-8111-000000000002', 'confidenceIndex',     NULL, 0.810, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z'),
  ('0000000d-1111-4111-8111-000000000006', '0000000b-1111-4111-8111-000000000002', 'automationReadiness', NULL, 0.400, '2026-06-23T10:00:00Z', '2026-06-23T10:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- pbrs_passports (1 — optional; issued for assessment 1's Gold-tier,
-- Approved outcome)
-- ============================================================
INSERT INTO pbrs_passports (id, passport_id, workspace_id, asset_id, assessment_id, score_id, status, score_snapshot, grade_snapshot, issued_at, issued_by_user_id, valid_from, valid_until, record_hash, last_verified_at, revoked_at, revoked_reason, created_at, updated_at)
VALUES (
  '0000000e-1111-4111-8111-000000000001',
  'PBRS-ACME-2026-0001-GOLD',
  '00000003-1111-4111-8111-000000000001',
  '00000006-1111-4111-8111-000000000001',
  '00000008-1111-4111-8111-000000000001',
  '0000000b-1111-4111-8111-000000000001',
  'Active',
  87.15,
  'B',
  '2026-06-20T12:05:00Z',
  '00000004-1111-4111-8111-000000000002',
  '2026-06-20T12:05:00Z',
  '2027-06-20T12:05:00Z',
  'dev-seed-record-hash-0000000e0001',
  '2026-06-20T12:05:00Z',
  NULL,
  NULL,
  '2026-06-20T12:05:00Z',
  '2026-06-20T12:05:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- activity_logs (3, optional)
-- ============================================================
INSERT INTO activity_logs (id, workspace_id, type, actor_user_id, actor_display_name, summary, related_entity_type, related_entity_id, created_at, updated_at)
VALUES
  ('0000000f-1111-4111-8111-000000000001', '00000003-1111-4111-8111-000000000001', 'AssessmentSubmitted', '00000004-1111-4111-8111-000000000003', 'Priya Nair', 'Submitted "Q3 Investor Update Draft" for review.', 'Assessment', '00000008-1111-4111-8111-000000000001', '2026-06-15T10:00:00Z', '2026-06-15T10:00:00Z'),
  ('0000000f-1111-4111-8111-000000000002', '00000003-1111-4111-8111-000000000001', 'AssessmentDecided', '00000004-1111-4111-8111-000000000002', 'Owen Fischer', 'Approved "Q3 Investor Update Draft" (Gold tier).', 'Assessment', '00000008-1111-4111-8111-000000000001', '2026-06-20T12:00:00Z', '2026-06-20T12:00:00Z'),
  ('0000000f-1111-4111-8111-000000000003', '00000003-1111-4111-8111-000000000001', 'AssessmentSubmitted', '00000004-1111-4111-8111-000000000003', 'Priya Nair', 'Submitted "Customer Data Handling Policy" for review.', 'Assessment', '00000008-1111-4111-8111-000000000002', '2026-06-22T09:30:00Z', '2026-06-22T09:30:00Z')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- audit_records (1, optional — append-only)
-- ============================================================
INSERT INTO audit_records (id, workspace_id, created_at, actor_user_id, action, entity_type, entity_id, changes, context)
VALUES (
  '00000010-1111-4111-8111-000000000001',
  '00000003-1111-4111-8111-000000000001',
  '2026-06-20T12:00:00Z',
  '00000004-1111-4111-8111-000000000002',
  'assessment.decision.approved',
  'Assessment',
  '00000008-1111-4111-8111-000000000001',
  '{"status": ["Under Review", "Approved"]}'::jsonb,
  'Dev seed record — PHX-BACKEND-003.'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================
-- report_templates (2) — PHX-REPORTS-003
-- ------------------------------------------------------------
-- Added in a separate transaction/append, not a rewrite of the block
-- above, matching the idempotent-append convention already used by
-- every PHX-BACKEND-006/007 addition to this file. Neither
-- report_templates nor reports had any seed data before this sprint —
-- POST /api/workspaces/:workspaceId/reports has no valid templateId
-- to reference without these rows. Two templates, covering the two
-- scope branches routes/reports.ts's POST handler actually checks:
--   - SingleAsset (requires assetId — see 00000006-...-001, the
--     already-seeded "Q3 Investor Update Draft" asset, above)
--   - Workspace (forbids assetId)
-- CertificationPortfolio is a real, valid scope value too but is not
-- separately seeded here — the SingleAsset/Workspace pair already
-- exercises both branches of the scope-vs-assetId business rule; a
-- third template would not add new coverage for this sprint's QA.
-- ID convention: marker 0x11 (report_template), continuing the
-- sequence documented in this file's header (...0f activity_log,
-- 10 audit_record).
-- ============================================================
BEGIN;

INSERT INTO report_templates (id, key, name, description, scope, output_formats, created_at, updated_at)
VALUES
  (
    '00000011-1111-4111-8111-000000000001',
    'asset-readiness-summary',
    'Asset Readiness Summary',
    'A single-asset PBRS readiness summary: dimension scores, derived signals, and evidence references for one asset.',
    'SingleAsset',
    ARRAY['pdf', 'html'],
    '2026-01-10T09:00:00Z',
    '2026-01-10T09:00:00Z'
  ),
  (
    '00000011-1111-4111-8111-000000000002',
    'workspace-portfolio-summary',
    'Workspace Portfolio Summary',
    'A workspace-wide portfolio summary across every assessed asset in the workspace.',
    'Workspace',
    ARRAY['pdf', 'csv'],
    '2026-01-10T09:00:00Z',
    '2026-01-10T09:00:00Z'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================
-- End of dev seed 0001.
-- ============================================================

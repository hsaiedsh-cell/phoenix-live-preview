# Phoenix Platform — Database Schema Draft

**Task ID:** PHX-PLATFORM-002
**Status:** Draft — no database is connected. This document defines the target
relational schema (PostgreSQL) for the future backend.
**Conventions:**
- All primary keys are `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- All tables have `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- Soft-deletable tables additionally have `deleted_at TIMESTAMPTZ NULL` (partial indexes below assume `WHERE deleted_at IS NULL`).
- `audit_records` is append-only and is **not** soft-deletable — no `deleted_at`.
- Foreign keys use `ON DELETE RESTRICT` by default unless noted; workspace-scoped children of a workspace use `ON DELETE CASCADE` only where a hard workspace teardown is an intentional, rare admin operation — noted per table.

---

## organizations
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| org_code | VARCHAR(12) NOT NULL | Uppercase alphanumeric |
| primary_contact_email | TEXT NULL | |
| industry | TEXT NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `org_code` (case-insensitive, `UNIQUE (upper(org_code))`).

---

## departments
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| organization_id | UUID NOT NULL FK → organizations(id) | |
| name | TEXT NOT NULL | |
| description | TEXT NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Index:** `(organization_id)`.
**Unique:** `(organization_id, lower(name))` where `deleted_at IS NULL`.

---

## workspaces
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| organization_id | UUID NOT NULL FK → organizations(id) | |
| name | TEXT NOT NULL | |
| slug | TEXT NOT NULL | URL-safe |
| settings | JSONB NOT NULL | `WorkspaceSettings` shape |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `slug` where `deleted_at IS NULL`.
**Index:** `(organization_id)`.

---

## users
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| email | CITEXT NOT NULL | Case-insensitive |
| display_name | TEXT NOT NULL | |
| platform_role | TEXT NOT NULL | enum `UserRole` |
| avatar_url | TEXT NULL | |
| last_login_at | TIMESTAMPTZ NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `email` where `deleted_at IS NULL`.

---

## workspace_users
Implements `WorkspaceMembership`.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | Cascades only on full workspace teardown |
| user_id | UUID NOT NULL FK → users(id) | |
| role | TEXT NOT NULL | enum `WorkspaceRole` |
| status | TEXT NOT NULL | `Active` / `Suspended` / `Invited` |
| invited_by_user_id | UUID NULL FK → users(id) | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `(workspace_id, user_id)` where `deleted_at IS NULL`.
**Index:** `(user_id)`, `(workspace_id, role)`.

---

## assets
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | |
| name | TEXT NOT NULL | |
| type | TEXT NOT NULL | enum `AssetType` |
| department | TEXT NOT NULL | |
| owner_user_id | UUID NOT NULL FK → users(id) | |
| status | TEXT NOT NULL | enum `AssetStatus` |
| current_version_id | UUID NULL FK → asset_versions(id) | Deferred/nullable FK — set after first version insert |
| last_assessed_at | TIMESTAMPTZ NULL | Denormalized |
| latest_score_snapshot | NUMERIC(5,2) NULL | Denormalized |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Index:** `(workspace_id, status)`, `(workspace_id, owner_user_id)`, `(workspace_id, department)`.

---

## asset_versions
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| asset_id | UUID NOT NULL FK → assets(id) ON DELETE CASCADE | |
| version_number | INTEGER NOT NULL | |
| content | TEXT NULL | |
| content_url | TEXT NULL | |
| content_type | TEXT NOT NULL | |
| created_by_user_id | UUID NOT NULL FK → users(id) | |
| change_note | TEXT NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | Versions are immutable; `updated_at` will not change post-insert in practice |

**Unique:** `(asset_id, version_number)`.
**Check:** `content IS NOT NULL OR content_url IS NOT NULL`.
**Index:** `(asset_id)`.

---

## assessments
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | |
| asset_id | UUID NOT NULL FK → assets(id) | |
| asset_version_id | UUID NOT NULL FK → asset_versions(id) | |
| status | TEXT NOT NULL | enum `AssessmentStatus` |
| requested_by_user_id | UUID NOT NULL FK → users(id) | |
| assigned_reviewer_user_id | UUID NULL FK → users(id) | |
| submitted_at | TIMESTAMPTZ NULL | |
| decided_at | TIMESTAMPTZ NULL | |
| decision_notes | TEXT NULL | |
| score_id | UUID NULL FK → pbrs_scores(id) | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Index:** `(workspace_id, status)`, `(asset_id)`, `(assigned_reviewer_user_id, status)`.

---

## assessment_steps
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| assessment_id | UUID NOT NULL FK → assessments(id) ON DELETE CASCADE | |
| sequence | SMALLINT NOT NULL | |
| name | TEXT NOT NULL | |
| status | TEXT NOT NULL | enum `AssessmentStepStatus` |
| assigned_user_id | UUID NULL FK → users(id) | |
| completed_at | TIMESTAMPTZ NULL | |
| notes | TEXT NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `(assessment_id, sequence)`.

---

## evidence_items
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| assessment_id | UUID NOT NULL FK → assessments(id) ON DELETE CASCADE | |
| type | TEXT NOT NULL | enum `EvidenceType` |
| title | TEXT NOT NULL | |
| note | TEXT NULL | |
| file_url | TEXT NULL | |
| external_url | TEXT NULL | |
| uploaded_by_user_id | UUID NOT NULL FK → users(id) | |
| related_dimension | TEXT NULL | one of the six `PBRSDimensionKey` values |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Index:** `(assessment_id)`, `(assessment_id, related_dimension)`.

---

## pbrs_scores
Implements `PBRSScoreRecord`. The `summary` column stores the exact `PBRSScore` object from `@phoenix/core` so no scoring logic is duplicated in the database layer.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| assessment_id | UUID NOT NULL FK → assessments(id) ON DELETE CASCADE | |
| summary | JSONB NOT NULL | `PBRSScore` shape (overall, grade, tier, dimensions, confidenceIndex, riskLevel, automationReadiness) |
| has_overrides | BOOLEAN NOT NULL DEFAULT false | |
| scored_by_user_id | UUID NULL FK → users(id) | |
| scoring_method | TEXT NOT NULL | `Automated` / `Manual` |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `(assessment_id)` — one active score record per assessment; re-scoring creates a new row and re-points `assessments.score_id` (prior rows retained for audit history, not deleted).
**Index:** `(assessment_id)`.

---

## pbrs_dimension_scores
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| score_id | UUID NOT NULL FK → pbrs_scores(id) ON DELETE CASCADE | |
| dimension | TEXT NOT NULL | one of the six `PBRSDimensionKey` values |
| value | NUMERIC(5,2) NOT NULL | 0–100 |
| evidence_ids | UUID[] NOT NULL DEFAULT '{}' | |
| is_overridden | BOOLEAN NOT NULL DEFAULT false | |
| override_reason | TEXT NULL | |
| overridden_by_user_id | UUID NULL FK → users(id) | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `(score_id, dimension)`.
**Check:** `value >= 0 AND value <= 100`.
**Check:** `NOT is_overridden OR (override_reason IS NOT NULL AND array_length(evidence_ids, 1) > 0)`.

---

## derived_signals
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| score_id | UUID NOT NULL FK → pbrs_scores(id) ON DELETE CASCADE | |
| key | TEXT NOT NULL | `riskLevel` / `confidenceIndex` / `automationReadiness` |
| value_text | TEXT NULL | populated when `key = 'riskLevel'` |
| value_numeric | NUMERIC(4,3) NULL | populated when `key` is `confidenceIndex` or `automationReadiness` (0–1) |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `(score_id, key)`.
**Note:** Signals are always derived — no direct write path other than the scoring engine.

---

## pbrs_passports
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| passport_id | TEXT NOT NULL | Human-readable `PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL]` |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | |
| asset_id | UUID NOT NULL FK → assets(id) | |
| assessment_id | UUID NOT NULL FK → assessments(id) | |
| score_id | UUID NOT NULL FK → pbrs_scores(id) | |
| status | TEXT NOT NULL | enum `PassportStatus` |
| score_snapshot | NUMERIC(5,2) NOT NULL | |
| grade_snapshot | TEXT NOT NULL | `A` / `B` / `C` / `Hold` |
| issued_at | TIMESTAMPTZ NULL | |
| issued_by_user_id | UUID NULL FK → users(id) | |
| valid_from | TIMESTAMPTZ NULL | |
| valid_until | TIMESTAMPTZ NULL | |
| record_hash | TEXT NOT NULL | |
| last_verified_at | TIMESTAMPTZ NULL | |
| revoked_at | TIMESTAMPTZ NULL | |
| revoked_reason | TEXT NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `passport_id`; `(assessment_id)` (one passport per assessment).
**Index:** `(workspace_id, status)`.

---

## pbrs_certifications
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| certification_id | TEXT NOT NULL | Human-readable `PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL]` |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | |
| passport_id | UUID NOT NULL FK → pbrs_passports(id) | |
| organization_id | UUID NOT NULL FK → organizations(id) | |
| tier | TEXT NOT NULL | `Platinum` / `Gold` / `Silver` / `Bronze` |
| status | TEXT NOT NULL | enum `CertificationStatus` |
| score_snapshot | NUMERIC(5,2) NOT NULL | |
| issued_date | DATE NULL | |
| expiry_date | DATE NULL | |
| granted_by_user_id | UUID NULL FK → users(id) | |
| revoked_at | TIMESTAMPTZ NULL | |
| revoked_by_user_id | UUID NULL FK → users(id) | |
| revoked_reason | TEXT NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Unique:** `certification_id`.
**Index:** `(workspace_id, status)`, `(expiry_date)` (for expiry-sweep jobs).

---

## report_templates
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| key | TEXT NOT NULL | e.g. `executive-readiness-summary` |
| name | TEXT NOT NULL | |
| description | TEXT NOT NULL | |
| scope | TEXT NOT NULL | `SingleAsset` / `Workspace` / `CertificationPortfolio` |
| output_formats | TEXT[] NOT NULL | subset of `pdf`, `html`, `csv` |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | Platform-seeded; not workspace-scoped |

**Unique:** `key`.

---

## reports
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | |
| template_id | UUID NOT NULL FK → report_templates(id) | |
| name | TEXT NOT NULL | Denormalized |
| status | TEXT NOT NULL | enum `ReportStatus` |
| asset_id | UUID NULL FK → assets(id) | |
| requested_by_user_id | UUID NOT NULL FK → users(id) | |
| requested_at | TIMESTAMPTZ NOT NULL | |
| generated_at | TIMESTAMPTZ NULL | |
| file_url | TEXT NULL | |
| format | TEXT NOT NULL | `pdf` / `html` / `csv` |
| expires_at | TIMESTAMPTZ NULL | |
| failure_reason | TEXT NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Index:** `(workspace_id, status)`, `(expires_at)` (for expiry sweep).

---

## activity_logs
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | |
| type | TEXT NOT NULL | enum `ActivityType` |
| actor_user_id | UUID NULL FK → users(id) | |
| actor_display_name | TEXT NOT NULL | Denormalized |
| summary | TEXT NOT NULL | |
| related_entity_type | TEXT NULL | |
| related_entity_id | UUID NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Index:** `(workspace_id, created_at DESC)` (feed pagination), `(related_entity_type, related_entity_id)`.

---

## notifications
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | |
| recipient_user_id | UUID NOT NULL FK → users(id) | |
| title | TEXT NOT NULL | |
| body | TEXT NOT NULL | |
| read_at | TIMESTAMPTZ NULL | |
| related_entity_type | TEXT NULL | |
| related_entity_id | UUID NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Index:** `(recipient_user_id, read_at)`.

---

## integrations
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID NOT NULL FK → workspaces(id) ON DELETE CASCADE | |
| category | TEXT NOT NULL | `DocumentSource` / `IdentityProvider` / `NotificationChannel` / `Other` |
| display_name | TEXT NOT NULL | |
| status | TEXT NOT NULL | enum `IntegrationStatus` |
| connected_by_user_id | UUID NULL FK → users(id) | |
| connected_at | TIMESTAMPTZ NULL | |
| last_sync_at | TIMESTAMPTZ NULL | |
| last_error_message | TEXT NULL | |
| created_at / updated_at / deleted_at | TIMESTAMPTZ | |

**Note:** No vendor-specific columns (e.g. OAuth tokens) are defined here — credential storage is a future, separately-reviewed decision.

---

## audit_records
Append-only. **No `deleted_at` column** — records are never removed.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID NOT NULL FK → workspaces(id) | `ON DELETE RESTRICT` — audit history must survive workspace edits |
| created_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| actor_user_id | UUID NULL FK → users(id) | |
| action | TEXT NOT NULL | e.g. `assessment.decision.approved` |
| entity_type | TEXT NOT NULL | |
| entity_id | UUID NOT NULL | |
| changes | JSONB NOT NULL | `{ field: [before, after] }` |
| context | TEXT NULL | |

**Index:** `(workspace_id, created_at DESC)`, `(entity_type, entity_id)`, `(actor_user_id)`.
**Constraint:** No `UPDATE` or `DELETE` grants for the application role at the database level — enforce via `REVOKE UPDATE, DELETE ON audit_records FROM app_role;` plus a row-level `BEFORE UPDATE/DELETE` trigger that raises an exception, as defense in depth.

---

## Entity Relationship Summary

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

# Release Notes — PHX-PLATFORM-005

**Release label:** Phoenix Platform Alpha — Evidence Traceability & Governance UX
**Task ID:** PHX-PLATFORM-005
**Type:** Frontend architecture / trust-layer maturity sprint (no backend, database, or auth added)

---

## What Changed

PHX-PLATFORM-004 introduced Evidence, ActivityLog, and AuditRecord fixtures,
but left three gaps open: `PBRSDimensionScore.evidenceIds` were empty arrays,
there was no assessment detail view to inspect evidence, and the
already-wired `getActivityLog()` / `getAuditRecords()` functions had no UI
consumer. PHX-PLATFORM-005 closes all three, making Phoenix's trust layer
(Assessment → PBRS Score → Dimension Scores → Evidence Items → Audit Trail)
visible end-to-end.

### 1. Evidence cross-linked to dimension scores (`lib/mock-fixtures/evidence.ts`, `lib/api-adapters.ts`)

- `evidence.ts` expanded from 12 to 37 `EvidenceItem` records so every one of
  the six sample assessments now has at least one evidence item per PBRS
  dimension (accuracy, compliance, brandAlignment, structure, consistency,
  completeness) — full 6×6 coverage.
- `mapSampleAssetToPBRSScoreRecord()` in `api-adapters.ts` now populates each
  `PBRSDimensionScore.evidenceIds` by filtering the evidence fixtures for
  that assessment + dimension, instead of returning an empty array. This is
  a presentation/traceability change only — dimension **values** are
  untouched, and no scoring logic was duplicated or added.

### 2. New assessment detail route (`/assessments/[assessmentId]`)

- New `AssessmentDetailViewModel` (`lib/view-models.ts`) — Asset + Assessment
  + PBRSScoreRecord, joined with the EvidenceItems, ActivityLog entries, and
  AuditRecords scoped to that specific assessment.
- New `buildAssessmentDetail(assessmentId)` adapter (`lib/api-adapters.ts`),
  which composes the relationship: it resolves the parent Asset, PBRSScore,
  and Evidence directly, then widens the activity/audit lookup to every
  entity a real backend would consider "related" to this assessment (the
  Assessment itself, its Asset, its PBRSScoreRecord, and — if issued/granted
  — its Passport and Certification), dedupes, sorts newest-first, and caps
  at 10 rows each.
- New `getAssessmentDetail(assessmentId)` API client function
  (`lib/api-client.ts`), returning `ApiResult<AssessmentDetailViewModel> |
  null`. The route calls `notFound()` when it resolves to `null`.
- Two smaller entity-scoped helpers, `getActivityForEntity(entityId)` and
  `getAuditRecordsForEntity(entityId)`, were added to both
  `api-adapters.ts` and `api-client.ts` (the client versions are thin async
  wrappers) as the named building blocks the brief asked for, and are what
  `buildAssessmentDetail()` composes internally.

### 3. New components (`apps/platform/src/components/`)

| Component | Purpose |
|---|---|
| `AssessmentHeader` | Asset name/type/department/owner/status/score/grade/risk/confidence/last-assessed |
| `AssessmentScoreSummary` | Thin wrapper around the existing `PBRSScorePanel` — no PBRS logic duplicated |
| `DimensionEvidencePanel` | Per-dimension score, weight, description, evidence count, and linked evidence cards |
| `EvidenceCard` | Single `EvidenceItem`: type, title, note/source, uploader, date, related dimension |
| `EvidenceLibrary` | All evidence for an assessment, groupable by dimension or type (client component) |
| `AuditTrailPreview` | Immutable audit rows: action, actor, entity type, change summary, timestamp |
| `ActivityTimeline` | Read-only activity rows: summary, actor, related entity, timestamp |
| `TraceabilityBadge` | Small "N evidence items" / "No evidence linked" pill used throughout |

Four new icons (`IconEvidence`, `IconHistory`, `IconLink`, `IconArrowLeft`)
were added to `components/Icons.tsx` to support these.

### 4. Navigation from the assessments list (Task 4)

- `AssessmentCard` is now a `<Link>` to `/assessments/{assessment.id}`, with
  a "View Assessment →" footer line. Card content and styling are otherwise
  unchanged.
- `AssessmentTable` links the asset name to the same route and adds a
  trailing "View →" column. Because `AssessmentTable` is shared by both
  `/assessments` (`AssessmentListItemViewModel[]`) and `/certifications`
  (`CertificationListItemViewModel[]`), and both view models carry a full
  `assessment: Assessment` object, this link works on both pages without
  any component branching.
- `AssessmentsClient`'s filters were not touched — filtering still happens
  against `statusLabel` / `department` / `riskLevel` / `simpleGrade` exactly
  as before.

### 5. Dashboard "Recent Activity" panel (Task 5)

`/dashboard` now fetches `getActivityLog(5)` alongside the existing
dashboard summary call and renders a compact `ActivityTimeline` below the
Actions panel, in the same right-hand column, using the existing card
styling.

### 6. Settings "Audit Preview" panel (Task 6)

`/settings` now fetches `getAuditRecords(5)` and renders an `AuditTrailPreview`
inside a new `SettingsPanel` titled "Audit Preview", with an inline
`AlphaNotice` reading "Full audit export is not available in Alpha." No
edit/delete affordance is rendered anywhere near it.

### 7. Activity/Audit fixture relationship fixes (Task 9)

`mock-fixtures/audit.ts` gained two records (`adt-009`, `adt-010`) so that
**every** sample assessment (`ast-001` through `ast-006`) now has at least
one directly- or indirectly-related `AuditRecord`, closing the two gaps
that existed for `ast-005` (Marketing Campaign Copy) and `ast-006` (Legal
Risk Memo). `ActivityLog` already covered all six assessments as of
PHX-PLATFORM-004 and needed no changes.

---

## What Was Preserved

- **Visual design is unchanged** everywhere except the two new additive
  panels (Dashboard, Settings) and the new detail route — confirmed via a
  Playwright pass at desktop (1440px), tablet (834px), and mobile (390px)
  across `/dashboard`, `/assessments`, `/assessments/[assessmentId]`,
  `/certifications`, `/passports`, `/reports`, and `/settings`. See
  `platform005-desktop-contact-sheet.jpg`,
  `platform005-tablet-contact-sheet.jpg`,
  `platform005-mobile-contact-sheet.jpg`.
- **PBRS six-dimension model is untouched.** `PBRS_DIMENSIONS` in
  `@phoenix/core` still defines exactly six scored dimensions (Accuracy 20%,
  Compliance 20%, Brand Alignment 15%, Structure 15%, Consistency 15%,
  Completeness 15%) plus the three derived-only signals. No dimension value
  was recalculated; only `evidenceIds` arrays were populated.
- **`apps/dashboard` and `apps/website`** were not touched by this task and
  build unaffected.
- **No real backend, database, or authentication** was introduced. Every
  new function still returns a `Promise` resolved from local fixtures; no
  `fetch()` calls were added.
- **Alpha language preserved.** The new detail route includes its own
  notice ("This assessment detail is shown using mock data. Evidence
  traceability is representative and not connected to a live backend
  yet."), matching the existing `AlphaNotice` pattern used elsewhere.

---

## Architecture Notes

- Relationship composition for the detail route lives entirely in
  `buildAssessmentDetail()` (`api-adapters.ts`) — the page component only
  calls `getAssessmentDetail()` and renders the result.
- `getActivityForEntity` / `getAuditRecordsForEntity` are intentionally
  simple exact-match filters against `relatedEntityId` / `entityId`. The
  "one assessment touches several entity ids" problem (Assessment, Asset,
  PBRSScoreRecord, and optionally Passport/Certification) is solved once,
  in `relatedEntityIdsForAssessment()`, rather than taught to every caller.
- `EvidenceCard` and `AuditTrailPreview` resolve display names via
  `ownerNameForUserId()` from `lib/mock-ids.ts` — a small id→name lookup
  table, not the denormalized `sample-data.ts` dataset. This keeps the
  "only api-client.ts/api-adapters.ts import sample-data.ts" rule intact
  while still letting components show human-readable names instead of raw
  UUIDs (see the Direct Import Check in
  `EVIDENCE_TRACEABILITY_REPORT_PHX_PLATFORM_005.md` for the full
  reasoning).
- `AssessmentScoreSummary` is a one-line wrapper around the existing
  `PBRSScorePanel` rather than a new rendering of the score — this was a
  deliberate choice to avoid a second implementation of PBRS score display
  logic, per the task's "do not duplicate PBRS logic inside components"
  constraint.

---

## Known Limitations

- Evidence fixtures remain illustrative and hand-authored, not generated
  from a real assessment workflow — shaped to satisfy the six-dimension
  contract, not to represent a specific customer's history.
- The assessment detail route has no edit affordance for evidence, activity,
  or audit data (by design — this sprint was read/traceability only).
- `EvidenceLibrary`'s group-by toggle is a small client component; it does
  not persist the user's last-selected grouping across page loads (no
  localStorage/sessionStorage is used, per the platform's constraints).
- The `/contact` form backend wiring and `@phoenix/config`'s `siteConfig`
  env-var integration remain outstanding from prior sprints and were out of
  scope here.
- The PBRS Standard Alignment Sprint (reconciling `PHX-STD-PBRS-001` to the
  six-dimension model) also remains outstanding.

---

## Next Recommended Sprint

1. Add an evidence-detail modal or expanded view for `EvidenceItem.fileUrl`
   attachments (currently shown as plain text, not a live link, since no
   file storage backend exists yet).
2. Extend `AssessmentDetailViewModel` with `AssessmentStep` data once a
   real assessment workflow view is prioritized.
3. Proceed with the previously flagged PBRS Standard Alignment Sprint and
   the `/contact` form backend wiring — both still outstanding from prior
   sprints.
4. Consider a paginated or "load more" activity/audit view once fixture
   volume grows beyond what a 10-row preview can usefully show.

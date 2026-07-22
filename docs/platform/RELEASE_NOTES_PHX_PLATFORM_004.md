# Release Notes — PHX-PLATFORM-004

**Release label:** Phoenix Platform Alpha — Entity View & Audit Fixtures
**Task ID:** PHX-PLATFORM-004
**Type:** Frontend architecture / mock-data maturity sprint (no backend, database, or auth added)

---

## What Changed

PHX-PLATFORM-003 gave the Platform Alpha a mock API client shaped like the
future backend contract, but several page-facing functions still returned
the old denormalized `PhoenixAsset` / `PhoenixPassport` / `PhoenixReport`
list-view shapes from `sample-data.ts`, and `getEvidenceItems()`,
`getActivityLog()`, and `getAuditRecords()` always returned empty results.

PHX-PLATFORM-004 closes both gaps:

### 1. New contract-aligned view models (`lib/view-models.ts`)

- `AssessmentListItemViewModel` — Asset + Assessment + PBRSScoreRecord,
  joined, with presentation fields (`simpleGrade`, `ownerName`, `riskLabel`,
  `statusLabel`).
- `PassportListItemViewModel` — PBRSPassport + Asset + Assessment +
  PBRSScoreRecord + optional PBRSCertificationRecord.
- `CertificationListItemViewModel` — PBRSCertificationRecord + PBRSPassport +
  Asset + Assessment + PBRSScoreRecord.
- `ReportListItemViewModel` — Report + optional ReportTemplate.
- `DashboardSummaryViewModel` — the PHX-PLATFORM-003 `DashboardSummary`
  read-model, with `recentAssessments` now typed as
  `AssessmentListItemViewModel[]` instead of `PhoenixAsset[]`.

These are UI read models only — no PBRS scoring logic lives here.
`score.summary` is always the exact `@phoenix/core` `PBRSScore` value.

### 2. Adapter-composed relationships (`lib/api-adapters.ts`)

Added `buildAssessmentListItems()`, `buildPassportListItems()`,
`buildCertificationListItems()`, `buildCertificationsOverview()`,
`buildEligibleAssessmentListItems()`, `buildExpiringSoonPassportListItems()`,
`buildReportListItems()`, `buildEvidenceItems()`, `buildActivityLogs()`, and
`buildAuditRecords()`. All relationship joins (asset ↔ assessment ↔ score ↔
passport ↔ certification) happen here — pages and components never assemble
these relationships themselves.

Also added `toAssessmentStatusLabel(asset, assessment)`, a small
presentation-label helper that reconstructs the platform's existing
5-value status vocabulary ("Draft", "In Review", "Business Ready",
"Certified", "Needs Improvement") from the two separate contract fields
(`Asset.status`, `Assessment.status`), so the UI's status badges render
unchanged even though the underlying data is now contract-shaped.

Mock asset owners are now attributed to distinct mock `User` records
(`lib/mock-ids.ts`) instead of collapsing every asset onto one owner —
`Asset.ownerUserId` varies per sample asset, and `ownerName` is resolved
from that id.

### 3. Refactored API client functions (`lib/api-client.ts`)

| Function | PHX-PLATFORM-003 | PHX-PLATFORM-004 |
|---|---|---|
| `getAssessments()` | `PaginatedResult<PhoenixAsset>` | `PaginatedResult<AssessmentListItemViewModel>` |
| `getPassports()` | `PaginatedResult<PhoenixPassport>` | `PaginatedResult<PassportListItemViewModel>` |
| `getCertifications()` | `{ certifiedAssets, eligibleAssets, expiringSoon }` (Phoenix* shapes) | `{ certifiedItems, eligibleItems, expiringSoon }` (view models) |
| `getReports()` | `PhoenixReport[]` | `ReportListItemViewModel[]` |
| `getRecentAssessments()` | `PhoenixAsset[]` | `AssessmentListItemViewModel[]` |
| `getDashboardSummary()` | `DashboardSummary` (recentAssessments: `PhoenixAsset[]`) | `DashboardSummaryViewModel` (recentAssessments: `AssessmentListItemViewModel[]`) |
| `getEvidenceItems(assessmentId)` | always empty | filtered, non-empty, from `mock-fixtures/evidence.ts` |
| `getActivityLog()` | always empty | non-empty, from `mock-fixtures/activity.ts` |
| `getAuditRecords()` | always empty | non-empty, from `mock-fixtures/audit.ts` |

Added optional alias functions for the naming convention requested in this
task's brief: `getAssessmentListItems()`, `getPassportListItems()`,
`getCertificationListItems()`, `getReportListItems()` — each delegates to
its corresponding primary function above rather than duplicating logic.

### 4. New Evidence / Activity / Audit fixtures (`lib/mock-fixtures/`)

- `evidence.ts` — 12 `EvidenceItem` records spread across all six sample
  assessments, covering source documents, brand guideline references,
  compliance policy notes, reviewer comments, legal source references, and
  human validation notes.
- `activity.ts` — 10 `ActivityLog` entries covering asset creation, evidence
  addition, score calculation, submission, review, decision, passport
  issuance, certification grant, and report request/generation.
- `audit.ts` — 8 `AuditRecord` entries covering asset/assessment status
  transitions, a dimension score override, passport issuance, certification
  grant, an illustrative certification revocation, and a workspace settings
  change. No update/delete helpers are exposed — the module is read-only,
  matching `AuditRecord`'s immutable, append-only design.

### 5. Component migration

`AssessmentCard`, `AssessmentTable`, `AssessmentsClient`, `PassportCard`,
`ReportCard`, and the `/certifications` page now consume the new view
models instead of `PhoenixAsset` / `PhoenixPassport` / `PhoenixReport`.
`Badges.tsx`'s `StatusBadge` now accepts a presentation-label `string` with
a neutral fallback style (rather than a closed 5-value union), and
`GradeBadge` / `RiskBadge` now type against the contract's `ReadinessGrade`
and `RiskLevel` directly.

---

## What Was Preserved

- **Visual design is unchanged.** Every visible field (asset name,
  department, score, grade, risk, status, last-assessed date, confidence
  index, owner) still renders in the same place with the same styling —
  confirmed via a Playwright visual pass at desktop (1440px), tablet
  (834px), and mobile (390px) across all six routes. See
  `platform004-desktop-contact-sheet.jpg`,
  `platform004-tablet-contact-sheet.jpg`,
  `platform004-mobile-contact-sheet.jpg`.
- **PBRS six-dimension model is untouched.** No scoring logic was
  duplicated or modified; `@phoenix/pbrs`'s `generateScore()` remains the
  single source of truth for every `PBRSScore` value embedded in the new
  view models.
- **Certification legal caution note** on `/certifications` is unchanged.
- **`apps/dashboard` and `apps/website`** were not touched by this task and
  build unaffected.
- **No real backend, database, or authentication** was introduced. Every
  new function still returns a `Promise` resolved from local fixtures.

---

## Architecture Notes

- Relationship composition (asset ↔ assessment ↔ score ↔ passport ↔
  certification) lives exclusively in `api-adapters.ts` — never in a page
  or component.
- `lib/mock-ids.ts` is a new shared module holding the fixed mock
  workspace/organization/user IDs and a small owner-name-to-id lookup, so
  `api-adapters.ts` and every file under `mock-fixtures/` can reference the
  same identifiers without a circular import between adapters and
  fixtures.
- `CertificationListItemViewModel` intentionally carries the same
  presentation fields as `AssessmentListItemViewModel` (`simpleGrade`,
  `riskLabel`, `statusLabel`, `ownerName`) so the existing `AssessmentTable`
  component can render certified-assets rows without a second table
  component.
- `getCertifications()`'s return shape changed field names
  (`certifiedAssets` → `certifiedItems`, `eligibleAssets` → `eligibleItems`)
  to signal the shift from raw sample rows to composed view models. This is
  a breaking change to that one return shape, scoped entirely within this
  Alpha build (no external consumers).

---

## Known Limitations

- Evidence/Activity/Audit fixtures are illustrative and hand-authored, not
  generated from any real assessment workflow — they are shaped to satisfy
  the `@phoenix/core` contracts, not to represent a specific customer's
  history.
- `ReportTemplate` records are synthesized on the fly in
  `buildReportListItems()` (one per `Report`) rather than modeled as a
  separate seeded catalog; a future sprint should introduce a small
  `REPORT_TEMPLATES` fixture if multiple reports need to share a template.
- Dashboard "recent activity" and Settings "audit preview" panels were
  intentionally **not** added to the UI this sprint (Task 10 was optional)
  — `getActivityLog()` / `getAuditRecords()` are wired and return data, but
  nothing in the UI calls them yet.
- `PBRSDimensionScore.evidenceIds` on the mock `PBRSScoreRecord` objects
  remain empty arrays — evidence fixtures are not yet cross-linked back into
  the score record's per-dimension `evidenceIds`. A future sprint should
  populate this linkage now that evidence fixtures exist.

---

## Next Recommended Sprint

1. Wire `getEvidenceItems()` into an assessment detail view (none exists
   yet — today's `/assessments` is list-only).
2. Add the optional dashboard "recent activity" panel and settings "audit
   preview" panel (Task 10), now that both fixtures are non-empty.
3. Cross-link `EvidenceItem.id`s into `PBRSDimensionScore.evidenceIds` for
   full audit traceability.
4. Proceed with the previously flagged PBRS Standard Alignment Sprint
   (updating `PHX-STD-PBRS-001` to the six-dimension model) and the
   `/contact` form backend wiring — both still outstanding from prior
   sprints.

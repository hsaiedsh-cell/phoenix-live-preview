# Phoenix Platform — API Contract Addendum

**Task ID:** PHX-PLATFORM-003
**Status:** Draft contract addendum — no backend implementation exists yet
**Scope:** Adds one endpoint flagged as missing during PHX-PLATFORM-002; does not modify or reopen `API_CONTRACT_PHX_PLATFORM_002.md`.

---

## 1. Background

`API_CONTRACT_PHX_PLATFORM_002.md` defines list and single-resource endpoints for
Workspaces, Assets, Assessments, PBRS Scores, Passports, Certifications, and
Reports, but did not define a dedicated read endpoint for the Platform
dashboard. Building the dashboard from six-plus separate calls (assets,
assessments, scores, passports, certifications, activity) would be
inefficient for a page that only needs aggregate figures and a short list.
This addendum closes that gap with a single denormalized read endpoint,
consistent with the API's stated conventions (`ApiResult<T>` envelope, ISO
8601 UTC dates, bearer-session auth, workspace scoping).

This addendum introduces no new persisted entities — `DashboardSummary` is a
read-model composed at request time from existing contract entities
(`Asset`, `Assessment`, `PBRSScoreRecord`), the same way `UserWorkspaceSummary`
in `user.ts` composes `User` + `WorkspaceMembership`.

---

## 2. `GET /api/workspaces/:workspaceId/dashboard-summary`

- **Purpose:** Return the aggregate figures, dimension averages, readiness
  trend, recent assessments, and suggested next actions for the Platform
  dashboard in a single call.
- **Request params:** `workspaceId` (path).
- **Request body:** none.
- **Response:** `ApiResult<DashboardSummary>`.
- **Status codes:** `200`, `403` (not a member), `404`.
- **Permission notes:** Any active `WorkspaceMembership` role, including `Viewer`.

### `DashboardSummary` shape

```ts
interface DashboardSummary {
  /** Weighted PBRS overall score, averaged across all assessed assets in the workspace. */
  overallReadinessScore: number;
  /** Count of assets that have completed at least one assessment. */
  assetsAssessed: number;
  /** Count of assets currently in Certified status. */
  certifiedAssets: number;
  /** Average PBRSScore.confidenceIndex across assessed assets, as a whole-number percentage. */
  averageConfidence: number;
  /** Count of assets whose current risk level is Medium, High, or Critical. */
  openRisks: number;
  /** Average score per PBRS dimension across all assessed assets. */
  dimensionAverages: Record<PBRSDimensionKey, number>;
  /** Illustrative time series of overall readiness score, most recent last. */
  readinessTrend: number[];
  /** The N most recently assessed assets, newest first. */
  recentAssessments: AssetAssessmentSummary[];
  /** Suggested next actions surfaced on the dashboard. */
  actionItems: DashboardActionItem[];
}

/** Denormalized joined view of one Asset + its latest Assessment + PBRSScoreRecord — avoids N+1 calls for list/dashboard rendering. */
interface AssetAssessmentSummary {
  id: string;
  name: string;
  type: AssetType;
  department: string;
  owner: string;
  status: AssetStatus;
  lastAssessed: string; // ISODate
  score: PBRSScore;      // exact @phoenix/core shape — overall, grade, tier, dimensions, confidenceIndex, riskLevel, automationReadiness
  simpleGrade: 'A' | 'B' | 'C' | 'Hold';
}

interface DashboardActionItem {
  id: string;
  label: string;
  href: string;
}
```

### Sample response

```json
{
  "data": {
    "overallReadinessScore": 83.4,
    "assetsAssessed": 6,
    "certifiedAssets": 1,
    "averageConfidence": 89,
    "openRisks": 2,
    "dimensionAverages": {
      "accuracy": 84.7,
      "compliance": 83.3,
      "brandAlignment": 79.0,
      "structure": 84.5,
      "consistency": 80.7,
      "completeness": 81.7
    },
    "readinessTrend": [72, 75, 74, 79, 81, 83, 85, 83.4],
    "recentAssessments": [
      {
        "id": "3f2c...",
        "name": "Legal Risk Memo",
        "type": "Legal Memo",
        "department": "Legal",
        "owner": "T. Rahim",
        "status": "Draft",
        "lastAssessed": "2026-07-03",
        "score": {
          "overall": 79.65,
          "grade": "C+",
          "tier": "Bronze",
          "dimensions": { "accuracy": 80, "compliance": 88, "brandAlignment": 70, "structure": 82, "consistency": 77, "completeness": 79 },
          "confidenceIndex": 0.85,
          "riskLevel": "Medium",
          "automationReadiness": 0.4
        },
        "simpleGrade": "C"
      }
    ],
    "actionItems": [
      { "id": "start-assessment", "label": "Start New Assessment", "href": "/assessments/new" },
      { "id": "review-passports", "label": "Review Passports", "href": "/passports" },
      { "id": "generate-report", "label": "Generate Report", "href": "/reports" }
    ]
  }
}
```

---

## 3. Implementation status

This endpoint is **documented only**. PHX-PLATFORM-003's mock API layer
(`apps/platform/src/lib/api-client.ts`, function `getDashboardSummary()`)
returns a `DashboardSummary`-shaped object built from local sample data via
`apps/platform/src/lib/api-adapters.ts`'s `buildDashboardSummary()`. No HTTP
request is made, and no data is persisted.

---

## 4. Non-goals

- This addendum does not alter any endpoint, entity, or enum defined in
  `API_CONTRACT_PHX_PLATFORM_002.md`.
- This addendum does not introduce authentication, a database, or a real
  backend.
- This addendum does not change the PBRS six-dimension scoring model.

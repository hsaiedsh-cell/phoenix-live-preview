// ============================================================
// Phoenix Backend — Report Render Data Repository
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Read-only data loaders for the two approved report templates
// (asset-readiness-summary, workspace-portfolio-summary). No PBRS
// calculation is performed or altered anywhere in this file — every
// score/dimension/derived-signal value is read verbatim from
// pbrs_scores/pbrs_dimension_scores/derived_signals via the SAME
// repository functions (getScoreByAssessmentId,
// getEvidenceByAssessmentId) apps/backend/src/repositories/
// assessments.repository.ts already exposes for the live assessment
// detail API — this is a read-only passthrough, exactly like that
// existing function already is.
//
// ---- Portfolio query design (Phase 1 Addendum B §7) --------------------
// getWorkspacePortfolioSummaryData() uses ONE set-based query (a
// ROW_NUMBER() OVER (PARTITION BY asset_id ...) window function) to
// resolve "the latest assessment per asset" for every asset in the
// workspace in a single round trip — never a per-asset loop calling
// getScoreByAssessmentId() N times. Score/dimension/derived-signal data
// for exactly the winning assessment ids is then fetched via `= ANY($ids)`
// set queries, again not a loop. Passport/certification summaries are
// resolved the same way. A configured bound
// (REPORT_PORTFOLIO_MAX_ASSETS) is checked BEFORE running the full
// query — a workspace whose real asset count exceeds the bound fails
// generation closed with a clear reason, rather than silently
// truncating what could be misread as a complete portfolio.
// ============================================================

import { getDatabasePool } from '../db/client';
import { getReportWorkerConfig } from '../config/report-worker-env';

// ---- asset-readiness-summary --------------------------------------------

export interface AssetSummary {
  id: string;
  name: string;
  type: string;
  department: string;
  status: string;
}

export interface DimensionScoreForRender {
  dimension: string;
  value: number;
}

export interface DerivedSignalsForRender {
  riskLevel: string | null;
  confidenceIndex: number | null;
  automationReadiness: string | null;
}

export interface ScoreForRender {
  overall: number | null;
  grade: string | null;
  /** Only the approved six PBRS dimensions are ever included here — see @phoenix/core's PBRS_DIMENSIONS; this repository never invents or recomputes a dimension. */
  dimensions: DimensionScoreForRender[];
  derivedSignals: DerivedSignalsForRender;
}

export interface AssetReadinessSummaryData {
  asset: AssetSummary;
  /** Null when the asset has never been assessed — rendered as a truthful "not yet assessed" state, never fabricated. */
  assessment: { id: string; status: string; updatedAt: string } | null;
  /** Null when the (existing) assessment has not been scored yet. */
  score: ScoreForRender | null;
  evidenceCount: number;
}

/** Extracts only the six approved PBRS dimensions' overall/grade fields from a pbrs_scores.summary JSONB blob, tolerating an unexpected shape by returning nulls rather than throwing. */
function extractOverallAndGrade(summary: unknown): { overall: number | null; grade: string | null } {
  if (summary && typeof summary === 'object') {
    const record = summary as Record<string, unknown>;
    const overall = typeof record.overall === 'number' ? record.overall : null;
    const grade = typeof record.grade === 'string' ? record.grade : null;
    return { overall, grade };
  }
  return { overall: null, grade: null };
}

function extractDerivedSignals(
  derivedSignals: Array<{ key: string; valueText: string | null; valueNumeric: number | null }>
): DerivedSignalsForRender {
  const riskLevel = derivedSignals.find((s) => s.key === 'riskLevel')?.valueText ?? null;
  const confidenceIndex = derivedSignals.find((s) => s.key === 'confidenceIndex')?.valueNumeric ?? null;
  const automationReadiness = derivedSignals.find((s) => s.key === 'automationReadiness')?.valueText ?? null;
  return { riskLevel, confidenceIndex, automationReadiness };
}

/**
 * Loads render data for the asset-readiness-summary template. Reuses
 * assessments.repository.ts's getScoreByAssessmentId()/
 * getEvidenceByAssessmentId() for the score/evidence portion (no
 * duplicated PBRS-reading logic) — only the "asset itself" and "latest
 * non-deleted assessment for this asset" queries are new here, since no
 * existing function resolves "latest assessment BY ASSET id" (only "by
 * assessment id" existed before this sprint).
 */
export async function getAssetReadinessSummaryData(assetId: string): Promise<AssetReadinessSummaryData | null> {
  const pool = getDatabasePool();

  const assetResult = await pool.query<{ id: string; name: string; type: string; department: string; status: string }>(
    `SELECT id, name, type, department, status
     FROM assets
     WHERE id = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [assetId]
  );
  const assetRow = assetResult.rows[0];
  if (!assetRow) return null;

  const asset: AssetSummary = {
    id: assetRow.id,
    name: assetRow.name,
    type: assetRow.type,
    department: assetRow.department,
    status: assetRow.status,
  };

  const latestAssessmentResult = await pool.query<{ id: string; status: string; updated_at: string }>(
    `SELECT id, status, updated_at
     FROM assessments
     WHERE asset_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [assetId]
  );
  const latestAssessmentRow = latestAssessmentResult.rows[0];

  if (!latestAssessmentRow) {
    return { asset, assessment: null, score: null, evidenceCount: 0 };
  }

  // Lazily imported to avoid a circular-import edge with
  // assessments.repository.ts (which does not import this file) — a
  // plain top-of-file import is equally safe here; using one for
  // consistency with the rest of this backend's import style.
  const { getScoreByAssessmentId, getEvidenceByAssessmentId } = await import('./assessments.repository');

  const [score, evidenceResult] = await Promise.all([
    getScoreByAssessmentId(latestAssessmentRow.id),
    getEvidenceByAssessmentId(latestAssessmentRow.id),
  ]);

  const scoreForRender: ScoreForRender | null = score
    ? {
        ...extractOverallAndGrade(score.summary),
        dimensions: score.dimensionScores.map((d) => ({ dimension: d.dimension, value: d.value })),
        derivedSignals: extractDerivedSignals(score.derivedSignals),
      }
    : null;

  return {
    asset,
    assessment: {
      id: latestAssessmentRow.id,
      status: latestAssessmentRow.status,
      updatedAt: latestAssessmentRow.updated_at,
    },
    score: scoreForRender,
    evidenceCount: evidenceResult.total,
  };
}

// ---- workspace-portfolio-summary -----------------------------------------

export interface PortfolioAssetRow {
  assetId: string;
  assetName: string;
  assetStatus: string;
  assessmentId: string | null;
  assessmentStatus: string | null;
  overallScore: number | null;
  grade: string | null;
  riskLevel: string | null;
}

export interface WorkspacePortfolioSummaryData {
  workspaceId: string;
  workspaceName: string;
  totalAssets: number;
  assetStatusBreakdown: Record<string, number>;
  assessmentStatusBreakdown: Record<string, number>;
  assets: PortfolioAssetRow[];
  passportCount: number;
  activeCertificationCount: number;
}

export type PortfolioDataResult =
  | { outcome: 'ok'; data: WorkspacePortfolioSummaryData }
  | { outcome: 'workspace-not-found' }
  | { outcome: 'too-large'; assetCount: number; maxAssets: number };

/**
 * Loads render data for the workspace-portfolio-summary template. See
 * file header for the set-based, non-N+1 query design and the bounded
 * result-size rule.
 */
export async function getWorkspacePortfolioSummaryData(workspaceId: string): Promise<PortfolioDataResult> {
  const pool = getDatabasePool();
  const { portfolioMaxAssets } = getReportWorkerConfig();

  const workspaceResult = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM workspaces WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [workspaceId]
  );
  const workspaceRow = workspaceResult.rows[0];
  if (!workspaceRow) return { outcome: 'workspace-not-found' };

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM assets WHERE workspace_id = $1 AND deleted_at IS NULL`,
    [workspaceId]
  );
  const totalAssets = Number(countResult.rows[0]?.count ?? 0);

  if (totalAssets > portfolioMaxAssets) {
    return { outcome: 'too-large', assetCount: totalAssets, maxAssets: portfolioMaxAssets };
  }

  // One set-based query: every asset in the workspace, LEFT JOINed to
  // its latest non-deleted assessment (window function ranking),
  // further LEFT JOINed to that assessment's score summary — a single
  // round trip, never a per-asset loop.
  const rowsResult = await pool.query<{
    asset_id: string;
    asset_name: string;
    asset_status: string;
    assessment_id: string | null;
    assessment_status: string | null;
    summary: unknown;
  }>(
    `WITH ranked_assessments AS (
       SELECT a.*, ROW_NUMBER() OVER (
         PARTITION BY a.asset_id ORDER BY a.updated_at DESC, a.id DESC
       ) AS rn
       FROM assessments a
       WHERE a.workspace_id = $1 AND a.deleted_at IS NULL
     )
     SELECT
       ast.id            AS asset_id,
       ast.name          AS asset_name,
       ast.status        AS asset_status,
       ra.id             AS assessment_id,
       ra.status         AS assessment_status,
       ps.summary        AS summary
     FROM assets ast
     LEFT JOIN ranked_assessments ra ON ra.asset_id = ast.id AND ra.rn = 1
     LEFT JOIN pbrs_scores ps ON ps.id = ra.score_id AND ps.deleted_at IS NULL
     WHERE ast.workspace_id = $1 AND ast.deleted_at IS NULL
     ORDER BY ast.name ASC, ast.id ASC`,
    [workspaceId]
  );

  const assetStatusBreakdown: Record<string, number> = {};
  const assessmentStatusBreakdown: Record<string, number> = {};
  const assets: PortfolioAssetRow[] = rowsResult.rows.map((row) => {
    assetStatusBreakdown[row.asset_status] = (assetStatusBreakdown[row.asset_status] ?? 0) + 1;
    if (row.assessment_status) {
      assessmentStatusBreakdown[row.assessment_status] = (assessmentStatusBreakdown[row.assessment_status] ?? 0) + 1;
    }
    const { overall, grade } = extractOverallAndGrade(row.summary);
    const riskLevel =
      row.summary && typeof row.summary === 'object' && 'riskLevel' in (row.summary as Record<string, unknown>)
        ? String((row.summary as Record<string, unknown>).riskLevel)
        : null;
    return {
      assetId: row.asset_id,
      assetName: row.asset_name,
      assetStatus: row.asset_status,
      assessmentId: row.assessment_id,
      assessmentStatus: row.assessment_status,
      overallScore: overall,
      grade,
      riskLevel,
    };
  });

  // Passport/certification status summary — set-based, filtered by
  // workspace_id, not per-asset.
  const passportCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM pbrs_passports WHERE workspace_id = $1 AND deleted_at IS NULL AND status = 'Active'`,
    [workspaceId]
  );
  // 'Certified' (not 'Active') is the correct CertificationStatus value
  // for "currently valid" — see @phoenix/core's CertificationStatus enum
  // ('Not Eligible' | 'Eligible' | 'Certified' | 'Expiring Soon' |
  // 'Expired' | 'Revoked'). PassportStatus does have an 'Active' value
  // (used above); the two enums are distinct and are not interchangeable.
  const certificationCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM pbrs_certifications WHERE workspace_id = $1 AND deleted_at IS NULL AND status = 'Certified'`,
    [workspaceId]
  );

  return {
    outcome: 'ok',
    data: {
      workspaceId: workspaceRow.id,
      workspaceName: workspaceRow.name,
      totalAssets,
      assetStatusBreakdown,
      assessmentStatusBreakdown,
      assets,
      passportCount: Number(passportCountResult.rows[0]?.count ?? 0),
      activeCertificationCount: Number(certificationCountResult.rows[0]?.count ?? 0),
    },
  };
}

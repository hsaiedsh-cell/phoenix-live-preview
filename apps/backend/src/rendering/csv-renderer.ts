// ============================================================
// Phoenix Backend — CSV Report Renderer
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// RFC-4180-style CSV. Textual cells go through csvCell() (formula-
// injection-safe quoting); numeric cells go through csvNumericCell()
// (plain unquoted numbers, never string-prefixed) — see sanitize.ts's
// header for why these must stay separate.
// ============================================================

import { csvCell, csvNumericCell, csvRow } from './sanitize';
import type { AssetReadinessSummaryData, WorkspacePortfolioSummaryData } from '../repositories/report-render-data.repository';
import type { RenderMeta } from './html-renderer';

export function renderAssetReadinessSummaryCsv(meta: RenderMeta, data: AssetReadinessSummaryData): string {
  const lines: string[] = [];
  lines.push(csvRow([csvCell('Report'), csvCell(meta.reportName)]));
  lines.push(csvRow([csvCell('Version'), csvNumericCell(meta.version)]));
  lines.push(csvRow([csvCell('Generated At'), csvCell(meta.generatedAt)]));
  lines.push(csvRow([]));
  lines.push(csvRow([csvCell('Asset Name'), csvCell('Asset Type'), csvCell('Department'), csvCell('Status')]));
  lines.push(csvRow([csvCell(data.asset.name), csvCell(data.asset.type), csvCell(data.asset.department), csvCell(data.asset.status)]));
  lines.push(csvRow([]));
  lines.push(csvRow([csvCell('Dimension'), csvCell('Value')]));
  if (data.score) {
    for (const dimension of data.score.dimensions) {
      lines.push(csvRow([csvCell(dimension.dimension), csvNumericCell(dimension.value)]));
    }
  }
  lines.push(csvRow([]));
  lines.push(csvRow([csvCell('Evidence Items'), csvNumericCell(data.evidenceCount)]));
  return lines.join('');
}

export function renderWorkspacePortfolioSummaryCsv(meta: RenderMeta, data: WorkspacePortfolioSummaryData): string {
  const lines: string[] = [];
  lines.push(csvRow([csvCell('Report'), csvCell(meta.reportName)]));
  lines.push(csvRow([csvCell('Version'), csvNumericCell(meta.version)]));
  lines.push(csvRow([csvCell('Generated At'), csvCell(meta.generatedAt)]));
  lines.push(csvRow([]));
  lines.push(csvRow([csvCell('Workspace'), csvCell(data.workspaceName)]));
  lines.push(csvRow([csvCell('Total Assets'), csvNumericCell(data.totalAssets)]));
  lines.push(csvRow([csvCell('Active Passports'), csvNumericCell(data.passportCount)]));
  lines.push(csvRow([csvCell('Certified Assets'), csvNumericCell(data.activeCertificationCount)]));
  lines.push(csvRow([]));
  lines.push(
    csvRow([
      csvCell('Asset'),
      csvCell('Asset Status'),
      csvCell('Assessment Status'),
      csvCell('Score'),
      csvCell('Grade'),
      csvCell('Risk'),
    ])
  );
  for (const asset of data.assets) {
    lines.push(
      csvRow([
        csvCell(asset.assetName),
        csvCell(asset.assetStatus),
        csvCell(asset.assessmentStatus ?? ''),
        csvNumericCell(asset.overallScore),
        csvCell(asset.grade ?? ''),
        csvCell(asset.riskLevel ?? ''),
      ])
    );
  }
  return lines.join('');
}

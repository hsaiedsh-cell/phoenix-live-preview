// ============================================================
// Phoenix Backend — HTML Report Renderer
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Server-rendered HTML string template. Every interpolated value passes
// through escapeHtml() (see sanitize.ts) — no templating-engine
// dependency needed for this scope. Missing/unavailable data renders as
// an explicit "Not available" string, never a fabricated value (task
// brief §4.6). No external network calls, no <script> content is ever
// generated.
// ============================================================

import { escapeHtml } from './sanitize';
import type { AssetReadinessSummaryData, WorkspacePortfolioSummaryData } from '../repositories/report-render-data.repository';

export interface RenderMeta {
  reportName: string;
  version: number;
  generatedAt: string;
}

const NOT_AVAILABLE = 'Not available';

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return escapeHtml(String(value));
}

function pageShell(title: string, meta: RenderMeta, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;margin:32px;}
h1{font-size:22px;margin-bottom:4px;}
h2{font-size:16px;margin-top:28px;border-bottom:1px solid #DCE5ED;padding-bottom:4px;}
table{border-collapse:collapse;width:100%;margin-top:8px;}
th,td{border:1px solid #DCE5ED;padding:6px 10px;text-align:left;font-size:13px;}
th{background:#F5F8FB;}
.meta{color:#66768A;font-size:12px;margin-bottom:16px;}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">Report: ${esc(meta.reportName)} &middot; Version ${esc(meta.version)} &middot; Generated ${esc(meta.generatedAt)}</div>
${body}
</body>
</html>`;
}

export function renderAssetReadinessSummaryHtml(meta: RenderMeta, data: AssetReadinessSummaryData): string {
  const dimensionRows = data.score
    ? data.score.dimensions
        .map((d) => `<tr><td>${esc(d.dimension)}</td><td>${esc(d.value)}</td></tr>`)
        .join('')
    : `<tr><td colspan="2">${NOT_AVAILABLE} — asset has not been scored yet.</td></tr>`;

  const body = `
<h2>Asset</h2>
<table>
<tr><th>Name</th><td>${esc(data.asset.name)}</td></tr>
<tr><th>Type</th><td>${esc(data.asset.type)}</td></tr>
<tr><th>Department</th><td>${esc(data.asset.department)}</td></tr>
<tr><th>Status</th><td>${esc(data.asset.status)}</td></tr>
</table>

<h2>Assessment</h2>
<table>
<tr><th>Assessment status</th><td>${data.assessment ? esc(data.assessment.status) : `${NOT_AVAILABLE} — this asset has not yet been assessed.`}</td></tr>
</table>

<h2>PBRS Score</h2>
<table>
<tr><th>Overall score</th><td>${data.score ? esc(data.score.overall) : NOT_AVAILABLE}</td></tr>
<tr><th>Grade</th><td>${data.score ? esc(data.score.grade) : NOT_AVAILABLE}</td></tr>
</table>

<h2>Dimensions</h2>
<table>
<tr><th>Dimension</th><th>Value</th></tr>
${dimensionRows}
</table>

<h2>Derived Signals</h2>
<table>
<tr><th>Risk level</th><td>${data.score ? esc(data.score.derivedSignals.riskLevel) : NOT_AVAILABLE}</td></tr>
<tr><th>Confidence index</th><td>${data.score ? esc(data.score.derivedSignals.confidenceIndex) : NOT_AVAILABLE}</td></tr>
<tr><th>Automation readiness</th><td>${data.score ? esc(data.score.derivedSignals.automationReadiness) : NOT_AVAILABLE}</td></tr>
</table>

<h2>Evidence</h2>
<table>
<tr><th>Evidence items</th><td>${esc(data.evidenceCount)}</td></tr>
</table>`;

  return pageShell('Asset Readiness Summary', meta, body);
}

export function renderWorkspacePortfolioSummaryHtml(meta: RenderMeta, data: WorkspacePortfolioSummaryData): string {
  const assetRows = data.assets
    .map(
      (a) =>
        `<tr><td>${esc(a.assetName)}</td><td>${esc(a.assetStatus)}</td><td>${esc(a.assessmentStatus)}</td><td>${esc(a.overallScore)}</td><td>${esc(a.grade)}</td><td>${esc(a.riskLevel)}</td></tr>`
    )
    .join('');

  const statusBreakdownRows = Object.entries(data.assetStatusBreakdown)
    .map(([status, count]) => `<tr><td>${esc(status)}</td><td>${esc(count)}</td></tr>`)
    .join('');

  const body = `
<h2>Workspace</h2>
<table>
<tr><th>Name</th><td>${esc(data.workspaceName)}</td></tr>
<tr><th>Total assets</th><td>${esc(data.totalAssets)}</td></tr>
<tr><th>Active passports</th><td>${esc(data.passportCount)}</td></tr>
<tr><th>Certified assets</th><td>${esc(data.activeCertificationCount)}</td></tr>
</table>

<h2>Asset Status Breakdown</h2>
<table>
<tr><th>Status</th><th>Count</th></tr>
${statusBreakdownRows || `<tr><td colspan="2">${NOT_AVAILABLE}</td></tr>`}
</table>

<h2>Assets</h2>
<table>
<tr><th>Asset</th><th>Asset status</th><th>Assessment status</th><th>Score</th><th>Grade</th><th>Risk</th></tr>
${assetRows || `<tr><td colspan="6">${NOT_AVAILABLE} — no assets in this workspace.</td></tr>`}
</table>`;

  return pageShell('Workspace Portfolio Summary', meta, body);
}

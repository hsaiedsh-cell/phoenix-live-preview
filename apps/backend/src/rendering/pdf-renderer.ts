// ============================================================
// Phoenix Backend — PDF Report Renderer
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// pdfkit (pure JavaScript, no Chromium/headless-browser requirement, no
// native binary compilation step — exact version pinned in
// package.json; see docs/reports/PHX_REPORTS_004_IMPLEMENTATION_REPORT.md
// for the dependency-selection rationale). A simple, honest layout —
// explicitly NOT the "final premium branded" design the task brief
// defers (§4.6).
//
// Every text value drawn is passed through sanitizeForPdfText() (see
// sanitize.ts), NOT escapeHtml() — see that file's header for why
// HTML-escaping PDF text would be a bug, not a security fix.
// ============================================================

import PDFDocument from 'pdfkit';
import { sanitizeForPdfText } from './sanitize';
import type { AssetReadinessSummaryData, WorkspacePortfolioSummaryData } from '../repositories/report-render-data.repository';
import type { RenderMeta } from './html-renderer';

const NOT_AVAILABLE = 'Not available';

function s(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  return sanitizeForPdfText(String(value));
}

/** Renders a completed pdfkit document to a Buffer. */
function collectPdfBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function drawHeading(doc: PDFKit.PDFDocument, title: string, meta: RenderMeta): void {
  doc.fontSize(20).text(sanitizeForPdfText(title));
  doc.moveDown(0.3);
  doc
    .fontSize(9)
    .fillColor('#66768A')
    .text(`Report: ${s(meta.reportName)}  |  Version ${s(meta.version)}  |  Generated ${s(meta.generatedAt)}`);
  doc.fillColor('#000000');
  doc.moveDown(1);
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.5);
  doc.fontSize(13).text(sanitizeForPdfText(title));
  doc.moveDown(0.2);
  doc.fontSize(10);
}

function drawKeyValue(doc: PDFKit.PDFDocument, key: string, value: string | number | null | undefined): void {
  doc.text(`${sanitizeForPdfText(key)}: ${s(value)}`);
}

export async function renderAssetReadinessSummaryPdf(meta: RenderMeta, data: AssetReadinessSummaryData): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50 });

  drawHeading(doc, 'Asset Readiness Summary', meta);

  drawSectionTitle(doc, 'Asset');
  drawKeyValue(doc, 'Name', data.asset.name);
  drawKeyValue(doc, 'Type', data.asset.type);
  drawKeyValue(doc, 'Department', data.asset.department);
  drawKeyValue(doc, 'Status', data.asset.status);

  drawSectionTitle(doc, 'Assessment');
  drawKeyValue(doc, 'Status', data.assessment ? data.assessment.status : `${NOT_AVAILABLE} — this asset has not yet been assessed.`);

  drawSectionTitle(doc, 'PBRS Score');
  drawKeyValue(doc, 'Overall score', data.score?.overall ?? null);
  drawKeyValue(doc, 'Grade', data.score?.grade ?? null);

  drawSectionTitle(doc, 'Dimensions');
  if (data.score && data.score.dimensions.length > 0) {
    for (const dimension of data.score.dimensions) {
      drawKeyValue(doc, dimension.dimension, dimension.value);
    }
  } else {
    doc.text(`${NOT_AVAILABLE} — asset has not been scored yet.`);
  }

  drawSectionTitle(doc, 'Derived Signals');
  drawKeyValue(doc, 'Risk level', data.score?.derivedSignals.riskLevel ?? null);
  drawKeyValue(doc, 'Confidence index', data.score?.derivedSignals.confidenceIndex ?? null);
  drawKeyValue(doc, 'Automation readiness', data.score?.derivedSignals.automationReadiness ?? null);

  drawSectionTitle(doc, 'Evidence');
  drawKeyValue(doc, 'Evidence items', data.evidenceCount);

  return collectPdfBuffer(doc);
}

export async function renderWorkspacePortfolioSummaryPdf(meta: RenderMeta, data: WorkspacePortfolioSummaryData): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 50 });

  drawHeading(doc, 'Workspace Portfolio Summary', meta);

  drawSectionTitle(doc, 'Workspace');
  drawKeyValue(doc, 'Name', data.workspaceName);
  drawKeyValue(doc, 'Total assets', data.totalAssets);
  drawKeyValue(doc, 'Active passports', data.passportCount);
  drawKeyValue(doc, 'Certified assets', data.activeCertificationCount);

  drawSectionTitle(doc, 'Asset Status Breakdown');
  const statuses = Object.entries(data.assetStatusBreakdown);
  if (statuses.length > 0) {
    for (const [status, count] of statuses) {
      drawKeyValue(doc, status, count);
    }
  } else {
    doc.text(NOT_AVAILABLE);
  }

  drawSectionTitle(doc, 'Assets');
  if (data.assets.length > 0) {
    for (const asset of data.assets) {
      doc
        .fontSize(10)
        .text(
          `${sanitizeForPdfText(asset.assetName)} — status: ${s(asset.assetStatus)}, assessment: ${s(
            asset.assessmentStatus
          )}, score: ${s(asset.overallScore)}, grade: ${s(asset.grade)}, risk: ${s(asset.riskLevel)}`
        );
    }
  } else {
    doc.text(`${NOT_AVAILABLE} — no assets in this workspace.`);
  }

  return collectPdfBuffer(doc);
}

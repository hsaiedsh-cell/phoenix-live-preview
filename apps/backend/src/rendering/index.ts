// ============================================================
// Phoenix Backend — Report Renderer Dispatcher
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Single entry point the generation service calls: given a template
// key, a format, and the already-loaded render data, produces the
// generated artifact bytes + a content type. No PBRS calculation, no
// network calls — pure in-memory rendering from already-fetched data.
// ============================================================

import {
  getAssetReadinessSummaryData,
  getWorkspacePortfolioSummaryData,
  type PortfolioDataResult,
} from '../repositories/report-render-data.repository';
import { renderAssetReadinessSummaryHtml, renderWorkspacePortfolioSummaryHtml, type RenderMeta } from './html-renderer';
import { renderAssetReadinessSummaryCsv, renderWorkspacePortfolioSummaryCsv } from './csv-renderer';
import { renderAssetReadinessSummaryPdf, renderWorkspacePortfolioSummaryPdf } from './pdf-renderer';

export type ReportFormat = 'pdf' | 'html' | 'csv';

export const CONTENT_TYPE_BY_FORMAT: Record<ReportFormat, string> = {
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

export interface RenderReportInput {
  templateKey: string;
  assetId: string | null;
  workspaceId: string;
  format: ReportFormat;
  meta: RenderMeta;
}

export type RenderReportResult =
  | { outcome: 'ok'; bytes: Buffer; contentType: string }
  | { outcome: 'asset-not-found' }
  | { outcome: 'workspace-not-found' }
  | { outcome: 'portfolio-too-large'; assetCount: number; maxAssets: number }
  | { outcome: 'unsupported-template-or-format' };

function toBuffer(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

/**
 * Loads the correct render data for `input.templateKey` and renders it
 * in `input.format`. Both approved templates
 * (asset-readiness-summary, workspace-portfolio-summary) are handled
 * here; an unrecognized template key or an unsupported
 * template/format pairing is reported as a typed outcome rather than
 * thrown, so the generation service can map it to a sanitized failure
 * reason without a raw error message leaking internals.
 */
export async function renderReport(input: RenderReportInput): Promise<RenderReportResult> {
  if (input.templateKey === 'asset-readiness-summary') {
    if (!input.assetId) return { outcome: 'unsupported-template-or-format' };
    const data = await getAssetReadinessSummaryData(input.assetId);
    if (!data) return { outcome: 'asset-not-found' };

    if (input.format === 'html') {
      return { outcome: 'ok', bytes: toBuffer(renderAssetReadinessSummaryHtml(input.meta, data)), contentType: CONTENT_TYPE_BY_FORMAT.html };
    }
    if (input.format === 'pdf') {
      return { outcome: 'ok', bytes: await renderAssetReadinessSummaryPdf(input.meta, data), contentType: CONTENT_TYPE_BY_FORMAT.pdf };
    }
    if (input.format === 'csv') {
      return { outcome: 'ok', bytes: toBuffer(renderAssetReadinessSummaryCsv(input.meta, data)), contentType: CONTENT_TYPE_BY_FORMAT.csv };
    }
    return { outcome: 'unsupported-template-or-format' };
  }

  if (input.templateKey === 'workspace-portfolio-summary') {
    const result: PortfolioDataResult = await getWorkspacePortfolioSummaryData(input.workspaceId);
    if (result.outcome === 'workspace-not-found') return { outcome: 'workspace-not-found' };
    if (result.outcome === 'too-large') {
      return { outcome: 'portfolio-too-large', assetCount: result.assetCount, maxAssets: result.maxAssets };
    }

    if (input.format === 'html') {
      return {
        outcome: 'ok',
        bytes: toBuffer(renderWorkspacePortfolioSummaryHtml(input.meta, result.data)),
        contentType: CONTENT_TYPE_BY_FORMAT.html,
      };
    }
    if (input.format === 'pdf') {
      return { outcome: 'ok', bytes: await renderWorkspacePortfolioSummaryPdf(input.meta, result.data), contentType: CONTENT_TYPE_BY_FORMAT.pdf };
    }
    if (input.format === 'csv') {
      return {
        outcome: 'ok',
        bytes: toBuffer(renderWorkspacePortfolioSummaryCsv(input.meta, result.data)),
        contentType: CONTENT_TYPE_BY_FORMAT.csv,
      };
    }
    return { outcome: 'unsupported-template-or-format' };
  }

  return { outcome: 'unsupported-template-or-format' };
}

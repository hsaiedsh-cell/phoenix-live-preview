// ============================================================
// Phoenix Platform — LiveReportsTable
// PHX-REPORTS-001 — Live Reports List (preview mode)
// ------------------------------------------------------------
// Renders previewGetReports() rows (BackendReport) for
// vercel-supabase-preview mode. Deliberately a table, not the mock
// reports page's card grid (ReportCard) — the same reasoning
// LiveCertificationsTable.tsx used to choose a table over
// AssessmentTable: a table is a cleaner fit for the flatter,
// column-oriented shape a live read-only row actually has, and this
// component intentionally does NOT reuse ReportCard, since that
// component expects the full mock ReportListItemViewModel shape
// (an optional ReportTemplate object, statusLabel/ctaLabel derived
// strings, optional certification-level fields) that this read-only
// migration's query does not return.
//
// This sprint is strictly read-only: no report generation, no
// PDF/Excel export, no scheduling action is rendered here. The CTA a
// mock ReportCard shows ("View" / "Generate" with a disabled state) is
// intentionally omitted — see the closing note below the table.
// ============================================================

import type { BackendReport } from '@/lib/real-api-client';
import { EmptyState } from './EmptyState';
import { IconReport } from './Icons';

/** Same safe-formatting convention as LiveCertificationsTable.tsx / LivePassportCard.tsx — never call .slice() on an unguarded value. */
function formatPreviewDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

interface LiveReportsTableProps {
  items: BackendReport[];
}

export function LiveReportsTable({ items }: LiveReportsTableProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconReport />}
        title="No live reports yet"
        description="Reports created for this workspace will appear here once they exist in the live database."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/60 text-left">
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Report</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Template</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Asset</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Format</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Requested by</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Requested</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Generated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60">
              <td className="px-5 py-3.5 font-semibold text-phx-navy">{item.name}</td>
              <td className="px-5 py-3.5 text-gray-600">{item.templateName}</td>
              <td className="px-5 py-3.5 text-gray-600">
                {item.assetId ? item.assetName : <span className="text-gray-400">Workspace</span>}
              </td>
              <td className="px-5 py-3.5 text-gray-600">{item.status}</td>
              <td className="px-5 py-3.5 text-gray-600 uppercase">{item.format}</td>
              <td className="px-5 py-3.5 text-gray-600">{item.requestedByDisplayName}</td>
              <td className="px-5 py-3.5 text-gray-400 text-xs">{formatPreviewDate(item.requestedAt)}</td>
              <td className="px-5 py-3.5 text-gray-400 text-xs">{formatPreviewDate(item.generatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-3 text-[11px] text-gray-500 border-t border-gray-100">
        Report generation, export, scheduling, and template management remain preview-only until their live
        workflows are implemented.
      </p>
    </div>
  );
}

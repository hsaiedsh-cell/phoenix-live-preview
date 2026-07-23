export const dynamic = 'force-dynamic';

import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { ReportCard } from '@/components/ReportCard';
import { LiveReportsTable } from '@/components/LiveReportsTable';
import { RequestReportButton } from '@/components/RequestReportButton';
import { PreviewOnlyNotice, LiveDataBadge, renderDataStatePanel } from '@/components/DataStatePanel';
import { getReports, getCurrentWorkspace } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';
import { loadReportsListData } from '@/lib/platform-data-source';

// PHX-REPORTS-001 — Live Reports Read Migration. Exact same architectural
// pattern as PHX-CERTIFICATIONS-001's certifications/page.tsx and
// PHX-PASSPORTS-001's passports/page.tsx: only vercel-supabase-preview mode
// reads live data. mock / real-dev / real-disabled / production-auth are
// all unchanged from before this sprint — apps/backend/src/routes/
// reports.ts is still a PHX-BACKEND-001 stub (every route 501s), so those
// modes have no live reports data source to read from yet.
//
// PHX-REPORTS-003 — Report Request API & State Model. Adds the one write
// action this sprint introduces: a "Request Report" button, rendered only
// in real-dev/production-auth mode (the two modes where
// apps/backend/src/routes/reports.ts's POST handler is actually reachable
// — vercel-supabase-preview has no write path for this sprint; see
// RequestReportButton.tsx's header for the full rationale, including why
// templateId comes from an interim env-configured default rather than a
// live template list). The rest of this page (mock cards, the
// vercel-supabase-preview live table below) is otherwise unchanged from
// PHX-REPORTS-001 — report generation, PDF/Excel export, scheduling, and
// template management remain unimplemented in every mode; see
// LiveReportsTable.tsx's closing note and PreviewOnlyNotice below.
export default async function ReportsPage() {
  const apiConfig = getPhoenixApiConfig();
  const workspace = await getCurrentWorkspace();

  if (apiConfig.mode !== 'vercel-supabase-preview') {
    const reports = await getReports();

    // PHX-REPORTS-003: workspaceId for the write call comes from the same
    // interim env bridges the rest of this app already uses for these two
    // modes (devWorkspaceId for real-dev, productionWorkspaceId for
    // production-auth) — no new bridge is introduced for this. Null in
    // mock/real-disabled, where RequestReportButton is not rendered at all.
    const requestReportWorkspaceId =
      apiConfig.mode === 'real-dev'
        ? apiConfig.devWorkspaceId
        : apiConfig.mode === 'production-auth'
          ? apiConfig.productionWorkspaceId
          : null;

    return (
      <div>
        <WorkspaceHeader
          eyebrow={workspace.data.name}
          title="Reports"
          description="A library of exportable readiness reports. Preview report structure ahead of full export support."
        />

        {/* No live reports endpoint exists yet for this mode; this page
            remains mock-backed, as it was before PHX-REPORTS-001. */}
        {apiConfig.mode !== 'mock' && <PreviewOnlyNotice />}

        {(apiConfig.mode === 'real-dev' || apiConfig.mode === 'production-auth') && (
          <div className="mb-6">
            <RequestReportButton
              workspaceId={requestReportWorkspaceId}
              templateId={apiConfig.defaultReportTemplateId}
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {reports.map((item) => (
            <ReportCard key={item.report.id} item={item} />
          ))}
        </div>
      </div>
    );
  }

  // vercel-supabase-preview — live report records, read directly from
  // Supabase/Postgres. See lib/preview-api-client.server.ts's
  // previewGetReports() and platform-data-source.ts's loadReportsListData().
  const result = await loadReportsListData();

  return (
    <div>
      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="Reports"
        description="Existing report records for this workspace's live backend."
      />

      <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
        Existing report records are read from Supabase/Postgres in this hosted preview. Report generation, export,
        scheduling, and template management remain preview-only until their live workflows are implemented.
      </div>

      {result.status === 'live' && result.data ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <LiveDataBadge />
            <span className="text-xs text-gray-400">{result.data.total} total</span>
          </div>
          <LiveReportsTable items={result.data.items} />
        </>
      ) : result.status !== 'mock' ? (
        renderDataStatePanel(
          result.status as 'auth-required' | 'config-missing' | 'backend-unavailable' | 'permission-denied' | 'not-found' | 'not-wired',
          result.message
        )
      ) : null}
    </div>
  );
}

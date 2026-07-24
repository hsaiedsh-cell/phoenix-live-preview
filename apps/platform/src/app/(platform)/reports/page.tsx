export const dynamic = 'force-dynamic';

import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { ReportCard } from '@/components/ReportCard';
import { LiveReportsTable } from '@/components/LiveReportsTable';
import { LiveReportsActionTable } from '@/components/LiveReportsActionTable';
import { RequestReportButton } from '@/components/RequestReportButton';
import { PreviewOnlyNotice, LiveDataBadge, renderDataStatePanel } from '@/components/DataStatePanel';
import { getReports, getCurrentWorkspace } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';
import { loadReportsListData } from '@/lib/platform-data-source';

// PHX-REPORTS-001 — Live Reports Read Migration (vercel-supabase-preview
// only, read-only, unchanged by this sprint).
//
// PHX-REPORTS-003 — Report Request API & State Model. Added the
// "Request Report" button for real-dev/production-auth.
//
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation. real-dev/production-auth now read LIVE report
// records (loadReportsListData(), widened from vercel-supabase-preview-
// only) and render an action-aware table (LiveReportsActionTable) with
// real Start/Retry/Regenerate/Download actions and bounded polling
// while Generating — see that component and ReportDetailPoller.tsx for
// the full behavior contract (no client-side role/ownership inference;
// backend remains authoritative; no fallback to mock data after a real
// failure).
//
// mock and real-disabled are UNCHANGED — still the original mock
// ReportCard grid via getReports(). vercel-supabase-preview is
// UNCHANGED — still LiveReportsTable, still read-only, no write path
// added to that mode by this sprint.
export default async function ReportsPage() {
  const apiConfig = getPhoenixApiConfig();
  const workspace = await getCurrentWorkspace();

  // ---- mock / real-disabled: unchanged mock-backed view ----
  if (apiConfig.mode === 'mock' || apiConfig.mode === 'real-disabled') {
    const reports = await getReports();

    return (
      <div>
        <WorkspaceHeader
          eyebrow={workspace.data.name}
          title="Reports"
          description="A library of exportable readiness reports. Preview report structure ahead of full export support."
        />

        {apiConfig.mode !== 'mock' && <PreviewOnlyNotice />}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {reports.map((item) => (
            <ReportCard key={item.report.id} item={item} />
          ))}
        </div>
      </div>
    );
  }

  // ---- real-dev / production-auth: live, action-aware Reports lifecycle ----
  if (apiConfig.mode === 'real-dev' || apiConfig.mode === 'production-auth') {
    // Same interim env-bridge convention every other write action on
    // this page already uses (RequestReportButton) — no new bridge
    // introduced for this sprint.
    const requestReportWorkspaceId =
      apiConfig.mode === 'real-dev' ? apiConfig.devWorkspaceId : apiConfig.productionWorkspaceId;

    const result = await loadReportsListData();

    return (
      <div>
        <WorkspaceHeader
          eyebrow={workspace.data.name}
          title="Reports"
          description="Request, generate, and download readiness reports for this workspace."
        />

        <div className="mb-6">
          <RequestReportButton
            workspaceId={requestReportWorkspaceId}
            templateId={apiConfig.defaultReportTemplateId}
          />
        </div>

        {result.status === 'live' && result.data ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <LiveDataBadge />
              <span className="text-xs text-gray-400">{result.data.total} total</span>
            </div>
            <LiveReportsActionTable items={result.data.items} />
          </>
        ) : (
          // PHX-REPORTS-004: a failed real read never silently falls
          // back to mock data — it renders the same non-data state
          // panel every other migrated page uses.
          renderDataStatePanel(
            result.status as 'auth-required' | 'config-missing' | 'backend-unavailable' | 'permission-denied' | 'not-found' | 'not-wired',
            result.message
          )
        )}
      </div>
    );
  }

  // ---- vercel-supabase-preview — live report records, read directly from
  // Supabase/Postgres. See lib/preview-api-client.server.ts's
  // previewGetReports() and platform-data-source.ts's loadReportsListData().
  // Deliberately read-only — no write path is added to this mode by
  // this sprint.
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

import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { ReportCard } from '@/components/ReportCard';
import { PreviewOnlyNotice } from '@/components/DataStatePanel';
import { getReports, getCurrentWorkspace } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';

export default async function ReportsPage() {
  const [reports, workspace] = await Promise.all([getReports(), getCurrentWorkspace()]);
  const apiConfig = getPhoenixApiConfig();

  return (
    <div>
      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="Reports"
        description="A library of exportable readiness reports. Preview report structure ahead of full export support."
      />

      {/* PHX-PLATFORM-011 — no live report endpoint exists yet; this
          page remains mock-backed in every mode, per Task 1. */}
      {apiConfig.mode !== 'mock' && <PreviewOnlyNotice />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {reports.map((item) => (
          <ReportCard key={item.report.id} item={item} />
        ))}
      </div>
    </div>
  );
}

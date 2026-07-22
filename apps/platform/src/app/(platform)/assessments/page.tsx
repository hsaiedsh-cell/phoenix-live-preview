import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { AssessmentsClient } from '@/components/AssessmentsClient';
import { LiveAssessmentsTable } from '@/components/LiveAssessmentsTable';
import { NewAssessmentAction } from '@/components/NewAssessmentAction';
import { LiveDataBadge, renderDataStatePanel } from '@/components/DataStatePanel';
import { getAssessments, getCurrentWorkspace } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';
import { loadAssessmentsListData } from '@/lib/platform-data-source';

// PHX-PLATFORM-011 — see dashboard/page.tsx's identical comment: live
// reads must not be baked in at build time.
export const dynamic = 'force-dynamic';

export default async function AssessmentsPage() {
  const apiConfig = getPhoenixApiConfig();
  const workspace = await getCurrentWorkspace();

  if (apiConfig.mode === 'mock') {
    const { items } = await getAssessments();
    return (
      <div>
        <WorkspaceHeader
          eyebrow={workspace.data.name}
          title="Assessments"
          description="Every AI-generated asset submitted for PBRS assessment, with current score, grade, and status."
          actions={<NewAssessmentAction />}
        />
        <AssessmentsClient items={items} />
      </div>
    );
  }

  // real-dev / production-auth / real-disabled. The live list endpoint
  // returns assetName/status/overallScore/grade/riskLevel/timestamps —
  // no department, and no assetId-to-department mapping is available
  // from this endpoint — so filtering by department (as AssessmentsClient
  // does for mock data) is not possible without inventing values. Status
  // is the one additional filterable field with no live equivalent UI
  // this sprint; a full filter UI parity with mock is out of scope (see
  // implementation report "Assessments List Migration").
  const result = await loadAssessmentsListData();

  return (
    <div>
      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="Assessments"
        description="Every assessment recorded in this workspace's live backend."
      />

      {result.status === 'live' && result.data ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <LiveDataBadge />
            <span className="text-xs text-gray-400">{result.data.total} total</span>
          </div>
          <LiveAssessmentsTable items={result.data.items} />
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

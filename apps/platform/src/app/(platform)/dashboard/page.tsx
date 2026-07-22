import Link from 'next/link';
import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { StatCard } from '@/components/StatCard';
import { DimensionScoreGrid } from '@/components/DimensionScoreGrid';
import { AssessmentTable } from '@/components/AssessmentTable';
import { LiveAssessmentsTable } from '@/components/LiveAssessmentsTable';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { LiveDataBadge, renderDataStatePanel } from '@/components/DataStatePanel';
import { IconTrendUp, IconClipboard, IconShieldBadge, IconReport, IconPlus } from '@/components/Icons';
import { getDashboardSummary, getCurrentWorkspace, getActivityLog } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';
import { loadDashboardData } from '@/lib/platform-data-source';

// PHX-PLATFORM-011: without this, Next.js can statically generate this
// page at build time — baking in whatever the live read returned (or a
// build-time "backend unavailable" state, if no backend was reachable
// during the build) as permanent HTML, instead of fetching fresh data
// on every request. mock mode is unaffected in behavior (fixture data
// doesn't change either way); this only matters for real-dev/
// production-auth correctness.
export const dynamic = 'force-dynamic';

const ACTION_ICONS: Record<string, React.ReactNode> = {
  'start-assessment': <IconPlus />,
  'review-passports': <IconShieldBadge />,
  'generate-report': <IconReport />,
};

export default async function DashboardPage() {
  const apiConfig = getPhoenixApiConfig();
  const workspace = await getCurrentWorkspace();

  // PHX-PLATFORM-011 — mock mode is byte-for-byte unchanged from
  // PHX-PLATFORM-009/010: same three mock calls, same layout, same
  // copy. real-dev/production-auth take the live branch below instead
  // of ever calling getDashboardSummary()/getActivityLog().
  if (apiConfig.mode === 'mock') {
    const [summary, activity] = await Promise.all([getDashboardSummary(), getActivityLog(5)]);
    const trendMax = Math.max(...summary.readinessTrend);
    const trendMin = Math.min(...summary.readinessTrend);

    return (
      <div>
        <WorkspaceHeader
          eyebrow={workspace.data.name}
          title="Dashboard"
          description="Executive overview of AI output readiness across the workspace. Sample data — Platform Alpha."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <StatCard label="Overall Readiness" value={String(summary.overallReadinessScore)} icon={<IconTrendUp />} />
          <StatCard label="Assets Assessed" value={String(summary.assetsAssessed)} icon={<IconClipboard />} />
          <StatCard label="Certified Assets" value={String(summary.certifiedAssets)} icon={<IconShieldBadge />} />
          <StatCard label="Avg. Confidence" value={`${summary.averageConfidence}%`} icon={<IconTrendUp />} />
          <StatCard label="Open Risks" value={String(summary.openRisks)} icon={<IconClipboard />} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-phx-navy">PBRS Score Overview</h2>
              <span className="text-xs text-gray-400">Average across {summary.assetsAssessed} assets</span>
            </div>
            <DimensionScoreGrid scores={summary.dimensionAverages} compact />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <h2 className="text-base font-bold text-phx-navy mb-5">Readiness Trend</h2>
            <div className="flex items-end gap-2 h-32">
              {summary.readinessTrend.map((value, i) => {
                const heightPct = trendMax === trendMin ? 50 : ((value - trendMin) / (trendMax - trendMin)) * 80 + 20;
                const isLast = i === summary.readinessTrend.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                    <div
                      className={`w-full rounded-t-sm ${isLast ? 'bg-phx-cyan' : 'bg-phx-navy/15'}`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-gray-400">
              Illustrative static trend placeholder — not a live time series.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-phx-navy">Recent Assessments</h2>
              <Link href="/assessments" className="text-xs font-semibold text-phx-cyan hover:text-phx-cyan-dark">
                View all →
              </Link>
            </div>
            <AssessmentTable items={summary.recentAssessments} compact />
          </div>

          <div>
            <h2 className="text-base font-bold text-phx-navy mb-4">Actions</h2>
            <div className="space-y-3 mb-8">
              {summary.actionItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl p-4 hover:border-phx-cyan/40 hover:shadow-sm transition-all"
                >
                  <span className="w-9 h-9 rounded-lg bg-phx-cyan/10 flex items-center justify-center text-phx-cyan flex-shrink-0">
                    {ACTION_ICONS[item.id] ?? <IconPlus />}
                  </span>
                  <span className="text-sm font-semibold text-phx-navy">{item.label}</span>
                </Link>
              ))}
            </div>

            <h2 className="text-base font-bold text-phx-navy mb-4">Recent Activity</h2>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <ActivityTimeline items={activity.items} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // real-dev / production-auth / real-disabled — live-derived summary.
  // No overall readiness score, average confidence, certified-asset
  // count, or dimension grid is shown here: the backend's assessment
  // PHX-PLATFORM-011-R1 correction: PHX-PLATFORM-011 claimed the live
  // assessments list has no score data at all — live verification found
  // that was wrong (see platform-data-source.ts's LiveDashboardData
  // comment). "Certified Assets"/"Avg. Confidence"/dimension grid are
  // still not shown: the list endpoint's overallScore/grade/riskLevel
  // are enough for a per-row score column (see LiveAssessmentsTable),
  // but not for a workspace-wide average or a PBRS dimension breakdown
  // — computing those correctly would mean paging through every
  // assessment in the workspace, not one bounded list call.
  const result = await loadDashboardData();

  return (
    <div>
      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="Dashboard"
        description="Executive overview of assessment activity across the workspace."
      />

      {result.status === 'live' && result.data ? (
        <>
          <div className="mb-4">
            <LiveDataBadge />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <StatCard label="Total Assessments" value={String(result.data.totalAssessments)} icon={<IconClipboard />} />
            <StatCard
              label="Statuses Represented"
              value={String(Object.keys(result.data.statusBreakdown).length)}
              icon={<IconShieldBadge />}
            />
            <StatCard label="Scored (this page)" value={String(result.data.scoredInPage)} icon={<IconTrendUp />} />
          </div>
          <p className="text-xs text-gray-400 mb-6">
            Workspace-wide average score, confidence, and a PBRS dimension breakdown are not shown here — computing
            those correctly requires paging through every assessment, not one bounded list call. See
            /assessments/[id] for a single scored assessment&apos;s full live detail.
          </p>

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-phx-navy">Recent Assessments</h2>
            <Link href="/assessments" className="text-xs font-semibold text-phx-cyan hover:text-phx-cyan-dark">
              View all →
            </Link>
          </div>
          <LiveAssessmentsTable items={result.data.recentAssessments} compact />
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

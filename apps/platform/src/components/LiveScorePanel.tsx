// ============================================================
// Phoenix Platform — LiveScorePanel
// PHX-PLATFORM-011 — Live Read Migration for Production Auth
// ------------------------------------------------------------
// Displays a BackendScore exactly as GET /api/assessments/:id/score
// returned it — `summary` is the exact PBRSScore JSON @phoenix/pbrs
// already computed server-side (see real-api-client.ts's
// BackendScoreSummary type). No scoring math happens here; this is
// read-only display of the six approved dimensions, using
// @phoenix/core's PBRS_DIMENSIONS for labels only.
// ============================================================

import { PBRS_DIMENSIONS } from '@phoenix/core';
import type { BackendScore } from '@/lib/real-api-client';
import { EmptyState } from './EmptyState';
import { IconClipboard } from './Icons';

export function LiveScorePanel({ score }: { score: BackendScore | null }) {
  if (!score) {
    return (
      <EmptyState
        icon={<IconClipboard />}
        title="No PBRS score available yet"
        description="This assessment has not been scored. A score will appear here once scoring completes."
      />
    );
  }

  const { summary } = score;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-3xl font-extrabold text-phx-navy tracking-tight">{summary.overall}</p>
          <p className="text-xs text-gray-400 mt-1">
            Grade {summary.grade} · {summary.tier} tier
          </p>
        </div>
        <div className="text-right text-xs text-gray-500 space-y-0.5">
          <div>Risk: {summary.riskLevel}</div>
          <div>Confidence: {Math.round(summary.confidenceIndex * 100)}%</div>
          <div>Automation readiness: {Math.round(summary.automationReadiness * 100)}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {PBRS_DIMENSIONS.map((dim) => (
          <div key={dim.key} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{dim.label}</p>
            <p className="text-lg font-bold text-phx-navy mt-1">{summary.dimensions[dim.key] ?? '—'}</p>
          </div>
        ))}
      </div>

      {score.hasOverrides && (
        <p className="mt-4 text-xs text-amber-600 font-medium">
          One or more dimension scores in this run were manually overridden.
        </p>
      )}
    </div>
  );
}

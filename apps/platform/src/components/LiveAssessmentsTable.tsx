// ============================================================
// Phoenix Platform — LiveAssessmentsTable
// PHX-PLATFORM-011    — Live Read Migration for Production Auth
// PHX-PLATFORM-011-R1 — Server-Side Production Auth Token & Live
//   Backend Verification Fix
// ------------------------------------------------------------
// Renders backend GET /api/workspaces/:workspaceId/assessments rows.
// Deliberately NOT AssessmentTable — that component requires the mock
// view model's department field, which the real list endpoint does not
// return.
//
// PHX-PLATFORM-011-R1 CORRECTION: live verification against a real,
// seeded backend found this component (and the BackendAssessment type
// it renders) used the WRONG field names — PHX-PLATFORM-011 assumed
// `id`/`title`/`created_at` (raw SQL column aliases) where the actual
// API response uses `assessmentId`/`assetName`/`createdAt`. It also
// found the list endpoint DOES return `overallScore`/`grade`/
// `riskLevel` per row (PHX-PLATFORM-011's implementation report
// incorrectly said no score data was available from this endpoint) —
// those columns are now shown, when present, rather than omitted.
// ============================================================

import Link from 'next/link';
import type { BackendAssessment } from '@/lib/real-api-client';
import { EmptyState } from './EmptyState';
import { IconClipboard } from './Icons';

interface LiveAssessmentsTableProps {
  items: BackendAssessment[];
  compact?: boolean;
}

export function LiveAssessmentsTable({ items, compact = false }: LiveAssessmentsTableProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconClipboard />}
        title="No assessments yet"
        description="Assessments created in this workspace will appear here."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/60 text-left">
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Asset</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Score</th>
            {!compact && (
              <>
                <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Risk</th>
                <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Created</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.assessmentId} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60">
              <td className="px-5 py-3.5">
                <Link
                  href={`/assessments/${item.assessmentId}`}
                  className="font-semibold text-phx-navy hover:text-phx-cyan-dark"
                >
                  {item.assetName}
                </Link>
                <span className="block text-[11px] text-gray-400">{item.assetType}</span>
              </td>
              <td className="px-5 py-3.5 text-gray-600">{item.status}</td>
              <td className="px-5 py-3.5 text-gray-600">
                {item.overallScore !== null ? `${item.overallScore} (${item.grade ?? '—'})` : 'Not yet scored'}
              </td>
              {!compact && (
                <>
                  <td className="px-5 py-3.5 text-gray-600">{item.riskLevel ?? '—'}</td>
                  <td className="px-5 py-3.5 text-gray-400 text-xs">{item.createdAt.slice(0, 10)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

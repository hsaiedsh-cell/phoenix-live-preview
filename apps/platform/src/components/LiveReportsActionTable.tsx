// ============================================================
// Phoenix Platform — LiveReportsActionTable
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// The real-dev/production-auth counterpart to LiveReportsTable.tsx
// (which stays vercel-supabase-preview's read-only table, unchanged —
// see that file's header for why it was deliberately NOT extended with
// write actions it can't actually perform in that mode). This
// component IS action-aware: each row is a ReportDetailPoller.tsx
// client component, which owns its own status/action/polling state.
//
// This file itself is a Server Component wrapper — no 'use client'
// here — it only maps server-fetched data into per-row client
// components; all interactivity lives in ReportDetailPoller.tsx.
// ============================================================

import type { BackendReport } from '@/lib/real-api-client';
import { EmptyState } from './EmptyState';
import { IconReport } from './Icons';
import { ReportDetailPoller } from './ReportDetailPoller';

interface LiveReportsActionTableProps {
  items: BackendReport[];
}

export function LiveReportsActionTable({ items }: LiveReportsActionTableProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconReport />}
        title="No reports yet"
        description="Request a report above to see it appear here."
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
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Version</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Format</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Requested</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Action</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ReportDetailPoller key={item.id} initial={item} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

import React from 'react';
import type { RiskLevel, ReadinessGrade } from '@phoenix/core';

// --- Risk Badge ---
// Accepts the contract's RiskLevel directly (Low/Medium/High/Critical) —
// same union as PBRSScoreRecord.summary.riskLevel / PBRSScore['riskLevel'].

const riskStyles: Record<RiskLevel, string> = {
  Low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  High: 'bg-orange-50 text-orange-700 border-orange-200',
  Critical: 'bg-red-50 text-red-700 border-red-200',
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${riskStyles[level]}`}>
      {level}
    </span>
  );
}

// --- Grade Badge ---
// ReadinessGrade is the contract's simplified 4-tier grade ('A'|'B'|'C'|'Hold'),
// re-exported from lib/view-models.ts as SimpleGrade for call-site clarity.

const gradeStyles: Record<ReadinessGrade, string> = {
  A: 'bg-phx-navy text-white',
  B: 'bg-phx-cyan/15 text-phx-cyan-dark',
  C: 'bg-amber-100 text-amber-800',
  Hold: 'bg-gray-200 text-gray-700',
};

export function GradeBadge({ grade }: { grade: ReadinessGrade }) {
  return (
    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-sm font-extrabold ${gradeStyles[grade]}`}>
      {grade === 'Hold' ? 'H' : grade}
    </span>
  );
}

// --- Status Badge ---
// statusLabel is now a presentation string derived by
// api-adapters.ts's toAssessmentStatusLabel() from Asset + Assessment
// contract fields, rather than the old closed AssetStatus union — so this
// map covers the known labels with a neutral fallback style for anything
// else (e.g. future Assessment/Asset statuses not yet styled here).

const statusStyles: Record<string, string> = {
  'Draft': 'bg-gray-100 text-gray-600 border-gray-200',
  'Submitted': 'bg-gray-100 text-gray-600 border-gray-200',
  'In Review': 'bg-blue-50 text-blue-700 border-blue-200',
  'Under Review': 'bg-blue-50 text-blue-700 border-blue-200',
  'Assessed': 'bg-blue-50 text-blue-700 border-blue-200',
  'Business Ready': 'bg-phx-cyan/10 text-phx-cyan-dark border-phx-cyan/30',
  'Certified': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Needs Improvement': 'bg-red-50 text-red-700 border-red-200',
  'Expired': 'bg-gray-100 text-gray-500 border-gray-200',
  'Archived': 'bg-gray-100 text-gray-500 border-gray-200',
};

const defaultStatusStyle = 'bg-gray-100 text-gray-600 border-gray-200';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${
        statusStyles[status] ?? defaultStatusStyle
      }`}
    >
      {status}
    </span>
  );
}

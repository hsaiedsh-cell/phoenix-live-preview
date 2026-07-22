import React from 'react';
import Link from 'next/link';
import type { AssessmentListItemViewModel } from '@/lib/api-client';
import { RiskBadge, GradeBadge, StatusBadge } from './Badges';

interface AssessmentCardProps {
  item: AssessmentListItemViewModel;
}

export function AssessmentCard({ item }: AssessmentCardProps) {
  const { asset, assessment, score, simpleGrade, statusLabel } = item;

  return (
    <Link
      href={`/assessments/${assessment.id}`}
      className="block bg-white border border-gray-200 rounded-xl p-6 hover:border-phx-cyan/40 hover:shadow-sm transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-base font-bold text-phx-navy">{asset.name}</h3>
          <p className="text-xs text-gray-400">{asset.type} · {asset.department}</p>
        </div>
        <GradeBadge grade={simpleGrade} />
      </div>

      <div className="flex items-center gap-2 mb-5">
        <StatusBadge status={statusLabel} />
        <RiskBadge level={score.summary.riskLevel} />
      </div>

      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-gray-100 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Score</p>
          <p className="text-sm font-bold text-phx-navy">{score.summary.overall}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Confidence</p>
          <p className="text-sm font-bold text-phx-navy">{Math.round(score.summary.confidenceIndex * 100)}%</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Assessed</p>
          <p className="text-sm font-medium text-gray-600">{(asset.lastAssessedAt ?? '').slice(0, 10)}</p>
        </div>
      </div>

      <p className="text-xs font-semibold text-phx-cyan-dark">View Assessment →</p>
    </Link>
  );
}

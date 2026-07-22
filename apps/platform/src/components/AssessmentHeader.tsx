import React from 'react';
import type { Asset, RiskLevel } from '@phoenix/core';
import { GradeBadge, RiskBadge, StatusBadge } from './Badges';
import type { SimpleGrade } from '@/lib/api-client';

interface AssessmentHeaderProps {
  asset: Asset;
  statusLabel: string;
  simpleGrade: SimpleGrade;
  riskLabel: RiskLevel;
  overallScore: number;
  confidenceIndex: number;
  ownerName: string;
  /** PHX-CERT-002 — e.g. "Eligible for PBRS Foundation" or "Not eligible — remediation required". */
  eligibilityLabel?: string;
}

/** Assessment detail header: asset name/type/department/owner/status/score/grade/risk/confidence/last-assessed. */
export function AssessmentHeader({
  asset,
  statusLabel,
  simpleGrade,
  riskLabel,
  overallScore,
  confidenceIndex,
  ownerName,
  eligibilityLabel,
}: AssessmentHeaderProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-xs font-semibold tracking-widest text-phx-cyan-dark uppercase mb-1.5">
            {asset.type} · {asset.department}
          </p>
          <h1 className="text-xl lg:text-2xl font-extrabold text-phx-navy tracking-tight">{asset.name}</h1>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={statusLabel} />
          <RiskBadge level={riskLabel} />
          <GradeBadge grade={simpleGrade} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">PBRS Score</p>
          <p className="text-sm font-bold text-phx-navy">{overallScore}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Confidence</p>
          <p className="text-sm font-bold text-phx-navy">{Math.round(confidenceIndex * 100)}%</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Owner</p>
          <p className="text-sm font-medium text-gray-600">{ownerName}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Last Assessed</p>
          <p className="text-sm font-medium text-gray-600">{(asset.lastAssessedAt ?? '').slice(0, 10)}</p>
        </div>
        {eligibilityLabel && (
          <div className="col-span-2 sm:col-span-4">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-0.5">Certification Eligibility</p>
            <p className="text-sm font-semibold text-phx-navy">{eligibilityLabel}</p>
          </div>
        )}
      </div>
    </div>
  );
}

import React from 'react';
import Link from 'next/link';
import type { AssessmentListItemViewModel, CertificationListItemViewModel } from '@/lib/api-client';
import { RiskBadge, GradeBadge, StatusBadge } from './Badges';

// PHX-CERT-002: CertificationListItemViewModel additionally carries
// certificationLevelLabel — when present, the table renders a Certification
// Level column ahead of Risk, so the /certifications certified-assets table
// leads with the client-facing Certification Level (Architecture doc §8)
// rather than showing no certification labeling at all. AssessmentTable
// remains a single shared component (no separate certifications-only table)
// so /assessments and the dashboard render unchanged.
type AssessmentTableItem = AssessmentListItemViewModel | CertificationListItemViewModel;

function hasCertificationLevel(
  item: AssessmentTableItem
): item is CertificationListItemViewModel {
  return 'certificationLevelLabel' in item;
}

interface AssessmentTableProps {
  items: AssessmentTableItem[];
  compact?: boolean;
}

export function AssessmentTable({ items, compact = false }: AssessmentTableProps) {
  const showCertificationLevel = items.length > 0 && items.every(hasCertificationLevel);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/60 text-left">
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Asset</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Department</th>
            {!compact && (
              <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Owner</th>
            )}
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Score</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Grade</th>
            {showCertificationLevel && (
              <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
                Certification Level
              </th>
            )}
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Risk</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Last Assessed</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
              <span className="sr-only">View</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => (
            <tr key={item.asset.id} className="hover:bg-gray-50/60 transition-colors">
              <td className="px-5 py-4">
                <Link href={`/assessments/${item.assessment.id}`} className="group">
                  <p className="font-semibold text-phx-navy group-hover:text-phx-cyan-dark transition-colors">
                    {item.asset.name}
                  </p>
                  <p className="text-xs text-gray-400">{item.asset.type}</p>
                </Link>
              </td>
              <td className="px-5 py-4 text-gray-600">{item.asset.department}</td>
              {!compact && <td className="px-5 py-4 text-gray-600">{item.ownerName}</td>}
              <td className="px-5 py-4 font-semibold text-phx-navy">{item.score.summary.overall}</td>
              <td className="px-5 py-4">
                <GradeBadge grade={item.simpleGrade} />
              </td>
              {showCertificationLevel && hasCertificationLevel(item) && (
                <td className="px-5 py-4 font-semibold text-phx-navy whitespace-nowrap">
                  {item.certificationLevelLabel}
                </td>
              )}
              <td className="px-5 py-4">
                <RiskBadge level={item.score.summary.riskLevel} />
              </td>
              <td className="px-5 py-4">
                <StatusBadge status={item.statusLabel} />
              </td>
              <td className="px-5 py-4 text-gray-500 whitespace-nowrap">
                {(item.asset.lastAssessedAt ?? '').slice(0, 10)}
              </td>
              <td className="px-5 py-4 whitespace-nowrap">
                <Link
                  href={`/assessments/${item.assessment.id}`}
                  className="text-xs font-semibold text-phx-cyan-dark hover:text-phx-cyan"
                >
                  View →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

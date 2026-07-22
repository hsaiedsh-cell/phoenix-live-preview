import React from 'react';
import { PBRS_DIMENSIONS } from '@phoenix/core';
import type { PBRSDimensionScore, EvidenceItem } from '@phoenix/core';
import { EvidenceCard } from './EvidenceCard';
import { TraceabilityBadge } from './TraceabilityBadge';

interface DimensionEvidencePanelProps {
  dimensionScores: PBRSDimensionScore[];
  evidenceItems: EvidenceItem[];
}

/**
 * For each of the six PBRS dimensions: name, score, weight, short
 * explanation, linked evidence count, and the evidence items supporting it.
 * No scoring logic lives here — dimension values and weights come straight
 * from @phoenix/core's PBRS_DIMENSIONS and the passed-in PBRSDimensionScore
 * records; this component only renders the evidence traceability.
 */
export function DimensionEvidencePanel({ dimensionScores, evidenceItems }: DimensionEvidencePanelProps) {
  const evidenceById = new Map(evidenceItems.map((item) => [item.id, item]));

  return (
    <div className="space-y-5">
      {PBRS_DIMENSIONS.map((dim) => {
        const dimScore = dimensionScores.find((d) => d.dimension === dim.key);
        const linkedEvidence = (dimScore?.evidenceIds ?? [])
          .map((id) => evidenceById.get(id))
          .filter((item): item is EvidenceItem => Boolean(item));

        return (
          <div key={dim.key} className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-bold text-phx-navy">{dim.label}</h3>
                  <span className="text-[10px] font-medium text-gray-400">{Math.round(dim.weight * 100)}% weight</span>
                </div>
                <p className="text-xs text-gray-500 max-w-xl">{dim.description}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-xl font-extrabold text-phx-navy">{dimScore?.value ?? '—'}</span>
                <TraceabilityBadge count={linkedEvidence.length} />
              </div>
            </div>

            {linkedEvidence.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-gray-100">
                {linkedEvidence.map((evidence) => (
                  <EvidenceCard key={evidence.id} evidence={evidence} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Phoenix Platform — LiveEvidenceList
// PHX-PLATFORM-011 — Live Read Migration for Production Auth
// ------------------------------------------------------------
// Renders GET /api/assessments/:assessmentId/evidence rows as-is.
// Deliberately not EvidenceLibrary/DimensionEvidencePanel — those
// components are built around the mock view model's dimension-score
// joins; this shows the flat evidence list the live endpoint actually
// returns (type, title, note, related dimension, links).
// ============================================================

import type { BackendEvidenceItem } from '@/lib/real-api-client';
import { EmptyState } from './EmptyState';
import { IconEvidence } from './Icons';

export function LiveEvidenceList({ items }: { items: BackendEvidenceItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconEvidence />}
        title="No evidence recorded yet"
        description="Evidence attached to this assessment will appear here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {items.map((item) => (
        <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-sm font-semibold text-phx-navy">{item.title}</p>
            <span className="text-[11px] text-gray-400 whitespace-nowrap">{item.type}</span>
          </div>
          {item.note && <p className="text-xs text-gray-500 mb-2">{item.note}</p>}
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            {item.relatedDimension && <span>{item.relatedDimension}</span>}
            {(item.fileUrl || item.externalUrl) && (
              <a
                href={item.fileUrl ?? item.externalUrl ?? '#'}
                className="text-phx-cyan hover:text-phx-cyan-dark font-medium"
                target="_blank"
                rel="noreferrer"
              >
                View source
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

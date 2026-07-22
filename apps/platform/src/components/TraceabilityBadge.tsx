import React from 'react';
import { IconEvidence } from './Icons';

interface TraceabilityBadgeProps {
  count: number;
}

/** Small pill showing how many EvidenceItems back a given dimension or assessment. */
export function TraceabilityBadge({ count }: TraceabilityBadgeProps) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border bg-gray-100 text-gray-500 border-gray-200 whitespace-nowrap">
        <IconEvidence width={12} height={12} />
        No evidence linked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border bg-phx-cyan/10 text-phx-cyan-dark border-phx-cyan/30 whitespace-nowrap">
      <IconEvidence width={12} height={12} />
      {count} evidence {count === 1 ? 'item' : 'items'}
    </span>
  );
}

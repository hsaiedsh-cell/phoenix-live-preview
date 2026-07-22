'use client';

import React, { useMemo, useState } from 'react';
import type { EvidenceItem } from '@phoenix/core';
import { EvidenceCard } from './EvidenceCard';
import { EmptyState } from './EmptyState';
import { IconEvidence } from './Icons';

const DIMENSION_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  compliance: 'Compliance',
  brandAlignment: 'Brand Alignment',
  structure: 'Structure',
  consistency: 'Consistency',
  completeness: 'Completeness',
};

type GroupBy = 'dimension' | 'type';

interface EvidenceLibraryProps {
  items: EvidenceItem[];
}

/** All evidence attached to an assessment, groupable by evidence type or related PBRS dimension. Read-only — no editing. */
export function EvidenceLibrary({ items }: EvidenceLibraryProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('dimension');

  const groups = useMemo(() => {
    const map = new Map<string, EvidenceItem[]>();
    for (const item of items) {
      const key =
        groupBy === 'dimension'
          ? item.relatedDimension
            ? (DIMENSION_LABELS[item.relatedDimension] ?? item.relatedDimension)
            : 'Unassigned'
          : item.type;
      const existing = map.get(key) ?? [];
      existing.push(item);
      map.set(key, existing);
    }
    return Array.from(map.entries());
  }, [items, groupBy]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconEvidence />}
        title="No evidence attached yet"
        description="Evidence collected for this assessment will appear here."
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xs font-semibold text-gray-500">Group by</span>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          {(['dimension', 'type'] as GroupBy[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGroupBy(option)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                groupBy === option ? 'bg-white text-phx-navy shadow-sm' : 'text-gray-500 hover:text-phx-navy'
              }`}
            >
              {option === 'dimension' ? 'Dimension' : 'Type'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {groups.map(([label, groupItems]) => (
          <div key={label}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              {label} <span className="text-gray-300 font-normal">· {groupItems.length}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {groupItems.map((item) => (
                <EvidenceCard key={item.id} evidence={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

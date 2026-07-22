import React from 'react';
import { PBRS_DIMENSIONS } from '@phoenix/core';
import type { PBRSDimensionKey } from '@phoenix/core';

interface DimensionScoreGridProps {
  scores: Record<PBRSDimensionKey, number>;
  compact?: boolean;
}

export function DimensionScoreGrid({ scores, compact = false }: DimensionScoreGridProps) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'lg:grid-cols-3' : 'lg:grid-cols-6'} gap-4`}>
      {PBRS_DIMENSIONS.map((dim) => (
        <div key={dim.key} className="rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-phx-navy">{dim.label}</p>
            <span className="text-[10px] font-medium text-gray-400">{Math.round(dim.weight * 100)}%</span>
          </div>
          <p className="text-xl font-extrabold text-phx-navy mb-2">{scores[dim.key]}</p>
          <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-phx-cyan rounded-full"
              style={{ width: `${scores[dim.key]}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

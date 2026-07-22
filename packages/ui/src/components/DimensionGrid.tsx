import React from 'react';
import type { PBRSDimension } from '@phoenix/core';

interface DimensionGridProps {
  dimensions: PBRSDimension[];
  scores?: Record<string, number>;
}

export function DimensionGrid({ dimensions, scores }: DimensionGridProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {dimensions.map((dim) => (
        <div key={dim.key} className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-phx-navy">{dim.label}</h3>
            <span className="text-xs font-semibold text-phx-cyan bg-phx-cyan/10 px-2 py-1 rounded-full">
              {Math.round(dim.weight * 100)}%
            </span>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed mb-4">{dim.description}</p>
          {scores && scores[dim.key] !== undefined && (
            <div>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                <span>Sample score</span>
                <span className="font-semibold text-phx-navy">{scores[dim.key]}</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-phx-cyan rounded-full"
                  style={{ width: `${scores[dim.key]}%` }}
                />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

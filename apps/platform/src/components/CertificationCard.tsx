import React from 'react';
import { IconAward } from './Icons';

interface CertificationCardProps {
  name: string;
  description: string;
  minScore: number;
  assetCount?: number;
}

export function CertificationCard({ name, description, minScore, assetCount }: CertificationCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-7">
      <div className="w-11 h-11 rounded-lg bg-phx-navy flex items-center justify-center text-phx-cyan mb-5">
        <IconAward />
      </div>
      <h3 className="text-lg font-bold text-phx-navy mb-1">{name}</h3>
      <p className="text-sm text-gray-600 leading-relaxed mb-4">{description}</p>
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <span className="text-xs text-gray-400">Min. score {minScore}</span>
        {assetCount !== undefined && (
          <span className="text-xs font-semibold text-phx-navy">{assetCount} asset{assetCount === 1 ? '' : 's'}</span>
        )}
      </div>
    </div>
  );
}

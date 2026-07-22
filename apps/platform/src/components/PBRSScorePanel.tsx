import React from 'react';
import type { PBRSScore } from '@phoenix/core';
import { PBRSScorePreview } from '@phoenix/ui';
import { DimensionScoreGrid } from './DimensionScoreGrid';

interface PBRSScorePanelProps {
  score: PBRSScore;
  title?: string;
}

export function PBRSScorePanel({ score, title = 'PBRS Score Overview' }: PBRSScorePanelProps) {
  return (
    <div className="space-y-5">
      {title && <h2 className="text-base font-bold text-phx-navy">{title}</h2>}
      <PBRSScorePreview score={score} />
      <DimensionScoreGrid scores={score.dimensions} />
    </div>
  );
}

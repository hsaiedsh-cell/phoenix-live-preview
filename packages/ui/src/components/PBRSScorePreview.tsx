import React from 'react';
import type { PBRSScore } from '@phoenix/core';

interface PBRSScorePreviewProps {
  score: PBRSScore;
}

export function PBRSScorePreview({ score }: PBRSScorePreviewProps) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score.overall / 100) * circumference;

  return (
    <div className="bg-phx-navy rounded-2xl p-8 border border-phx-navy-mid">
      <div className="flex flex-col sm:flex-row items-center gap-8">
        <div className="relative flex-shrink-0">
          <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
            <circle cx="70" cy="70" r="54" fill="none" stroke="var(--phx-navy-mid)" strokeWidth="10" />
            <circle
              cx="70"
              cy="70"
              r="54"
              fill="none"
              stroke="var(--phx-cyan)"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-extrabold text-white">{score.overall}</span>
            <span className="text-xs text-gray-400">Score</span>
          </div>
        </div>

        <div className="flex-1 w-full">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl font-extrabold text-white">{score.grade}</span>
            <span className="text-xs font-semibold text-phx-navy bg-phx-cyan px-2.5 py-1 rounded-full">
              {score.tier}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Confidence Index</p>
              <p className="text-sm font-semibold text-white">{Math.round(score.confidenceIndex * 100)}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Risk Level</p>
              <p className="text-sm font-semibold text-white">{score.riskLevel}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Automation Ready</p>
              <p className="text-sm font-semibold text-white">{Math.round(score.automationReadiness * 100)}%</p>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-xs text-gray-500">
        Illustrative sample score for demonstration purposes.
      </p>
    </div>
  );
}

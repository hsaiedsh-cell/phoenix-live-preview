import React from 'react';

/**
 * Compact PBRS proof visual for the homepage hero.
 * Illustrative sample values — not a live score.
 */
export function HeroPBRSProof() {
  const circumference = 2 * Math.PI * 42;
  const sampleScore = 85;
  const offset = circumference - (sampleScore / 100) * circumference;

  return (
    <div className="relative bg-white/[0.04] backdrop-blur-sm border border-white/10 rounded-2xl p-6 lg:p-7 w-full max-w-sm">
      <div className="flex items-center gap-5">
        <div className="relative flex-shrink-0">
          <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--phx-cyan)"
              strokeWidth="8"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-extrabold text-white leading-none">{sampleScore}</span>
            <span className="text-[10px] text-gray-400 mt-0.5">/ 100</span>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-phx-cyan uppercase tracking-wider">PBRS Score</p>
          <p className="text-lg font-bold text-white mt-1 leading-snug">Business Ready</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3 pt-5 border-t border-white/10">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Confidence</p>
          <p className="text-sm font-semibold text-white">91%</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Risk Level</p>
          <p className="text-sm font-semibold text-white">Low</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Certification</p>
          <p className="text-sm font-semibold text-white">Eligible</p>
        </div>
      </div>

      <p className="mt-5 text-[11px] text-gray-500 leading-relaxed">
        Illustrative sample score for demonstration purposes.
      </p>
    </div>
  );
}

import React from 'react';

/**
 * Visual flow: PBRS Score™ → PBRS Passport™ → PBRS Certification™
 */
export function PBRSFlowDiagram() {
  const stages = [
    { label: 'PBRS Score™', sub: 'Weighted 0–100 readiness score' },
    { label: 'PBRS Passport™', sub: 'Portable readiness record' },
    { label: 'PBRS Certification™', sub: 'Formal tier certification' },
  ];

  return (
    <div className="bg-phx-navy rounded-2xl p-8 lg:p-10 border border-phx-navy-mid">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-3 items-stretch">
        {stages.map((stage, i) => (
          <React.Fragment key={stage.label}>
            <div className="flex flex-col items-center text-center">
              <div
                className={`w-full rounded-xl p-5 ${
                  i === 2
                    ? 'bg-phx-cyan text-white'
                    : 'bg-phx-navy-light text-white border border-phx-navy-mid'
                }`}
              >
                <p className="text-sm font-bold">{stage.label}</p>
                <p className={`text-xs mt-1 ${i === 2 ? 'text-white/80' : 'text-gray-400'}`}>
                  {stage.sub}
                </p>
              </div>
              {i < stages.length - 1 && (
                <div className="sm:hidden flex items-center justify-center py-2" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--phx-cyan)" strokeWidth="2">
                    <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
            {i < stages.length - 1 && (
              <div className="hidden sm:flex items-center justify-center" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--phx-cyan)" strokeWidth="2">
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

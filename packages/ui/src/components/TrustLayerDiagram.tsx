import React from 'react';

export function TrustLayerDiagram() {
  const stages = [
    { label: 'AI Output', sub: 'Generated content' },
    { label: 'PBRS™ Engine', sub: 'Scored & assessed' },
    { label: 'Verified Asset', sub: 'Certified & governed' },
    { label: 'Enterprise Use', sub: 'Deployed with trust' },
  ];

  return (
    <div className="bg-phx-navy rounded-2xl p-8 lg:p-12 border border-phx-navy-mid">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-6 sm:gap-3 items-stretch">
        {stages.map((stage, i) => (
          <React.Fragment key={stage.label}>
            <div className="flex flex-col items-center text-center">
              <div
                className={`w-full rounded-xl p-5 ${
                  i === 1
                    ? 'bg-phx-cyan text-white'
                    : 'bg-phx-navy-light text-white border border-phx-navy-mid'
                }`}
              >
                <p className="text-sm font-bold">{stage.label}</p>
                <p className={`text-xs mt-1 ${i === 1 ? 'text-white/80' : 'text-gray-400'}`}>
                  {stage.sub}
                </p>
              </div>
              {i < stages.length - 1 && (
                <div className="sm:hidden flex items-center justify-center py-2" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--phx-cyan)" strokeWidth="2">
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

import React from 'react';

type PreviewKind = 'dashboard' | 'workflow' | 'passport' | 'certification';

interface ProductPreviewPanelProps {
  kind: PreviewKind;
  title: string;
  description: string;
}

function PanelChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-phx-navy border border-phx-navy-mid overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-phx-navy-mid">
        <span className="w-2 h-2 rounded-full bg-white/20" />
        <span className="w-2 h-2 rounded-full bg-white/20" />
        <span className="w-2 h-2 rounded-full bg-white/20" />
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function DashboardMock() {
  const bars = [40, 65, 52, 80, 60, 90];
  return (
    <PanelChrome>
      <div className="flex items-end justify-between gap-1.5 h-16 mb-3">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 bg-phx-cyan/70 rounded-sm" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="h-1.5 rounded-full bg-white/10" />
        <div className="h-1.5 rounded-full bg-white/10" />
        <div className="h-1.5 rounded-full bg-phx-cyan/40" />
      </div>
    </PanelChrome>
  );
}

function WorkflowMock() {
  const stages = ['Intake', 'Score', 'Review', 'Certify'];
  return (
    <PanelChrome>
      <div className="flex items-center justify-between">
        {stages.map((s, i) => (
          <React.Fragment key={s}>
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  i <= 1 ? 'bg-phx-cyan text-white' : 'bg-white/10 text-gray-400'
                }`}
              >
                {i + 1}
              </div>
              <span className="text-[9px] text-gray-400">{s}</span>
            </div>
            {i < stages.length - 1 && <div className="flex-1 h-px bg-white/10 mx-1" />}
          </React.Fragment>
        ))}
      </div>
    </PanelChrome>
  );
}

function PassportMock() {
  return (
    <PanelChrome>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-semibold text-phx-cyan uppercase tracking-wider">Passport</span>
        <span className="text-[10px] font-semibold text-white bg-phx-cyan/20 px-2 py-0.5 rounded-full">Gold</span>
      </div>
      <div className="space-y-2">
        <div className="h-1.5 rounded-full bg-white/10 w-full" />
        <div className="h-1.5 rounded-full bg-white/10 w-4/5" />
        <div className="h-1.5 rounded-full bg-white/10 w-3/5" />
      </div>
    </PanelChrome>
  );
}

function CertificationMock() {
  return (
    <PanelChrome>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-phx-cyan/20 flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--phx-cyan)" strokeWidth="2">
            <circle cx="12" cy="9" r="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.5 14L7 21l5-2.5L17 21l-1.5-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-[10px] text-gray-400">Status</p>
          <p className="text-xs font-semibold text-white">Certified — Eligible</p>
        </div>
      </div>
    </PanelChrome>
  );
}

const mocks: Record<PreviewKind, React.ComponentType> = {
  dashboard: DashboardMock,
  workflow: WorkflowMock,
  passport: PassportMock,
  certification: CertificationMock,
};

export function ProductPreviewPanel({ kind, title, description }: ProductPreviewPanelProps) {
  const Mock = mocks[kind];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <Mock />
      <h3 className="text-sm font-bold text-phx-navy mt-5 mb-1.5">{title}</h3>
      <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}

import React from 'react';

interface WorkflowStep {
  label: string;
  description: string;
  icon?: React.ReactNode;
}

interface WorkflowTimelineProps {
  steps: WorkflowStep[];
  variant?: 'dark' | 'light';
}

export function WorkflowTimeline({ steps, variant = 'light' }: WorkflowTimelineProps) {
  const isDark = variant === 'dark';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {steps.map((step, i) => (
        <div key={step.label} className="relative">
          <div
            className={`h-full rounded-xl p-6 border ${
              isDark ? 'bg-phx-navy-light border-phx-navy-mid' : 'bg-white border-gray-200'
            }`}
          >
            <div className="flex items-center gap-3 mb-4">
              <span
                className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold ${
                  isDark ? 'bg-phx-cyan/15 text-phx-cyan' : 'bg-phx-navy/5 text-phx-navy'
                }`}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className={`text-base font-bold ${isDark ? 'text-white' : 'text-phx-navy'}`}>
                {step.label}
              </h3>
            </div>
            <p className={`text-sm leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {step.description}
            </p>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`hidden lg:block absolute top-1/2 -right-3 w-6 h-px ${
                isDark ? 'bg-phx-navy-mid' : 'bg-gray-200'
              }`}
              aria-hidden="true"
            />
          )}
        </div>
      ))}
    </div>
  );
}

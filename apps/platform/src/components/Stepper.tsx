import React from 'react';

interface StepperProps {
  steps: string[];
  activeStep: number;
}

export function Stepper({ steps, activeStep }: StepperProps) {
  return (
    <ol className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-0">
      {steps.map((step, i) => {
        const stepNumber = i + 1;
        const isComplete = stepNumber < activeStep;
        const isActive = stepNumber === activeStep;
        return (
          <li key={step} className="flex items-center sm:flex-1">
            <div className="flex items-center gap-3">
              <span
                className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold flex-shrink-0 ${
                  isActive
                    ? 'bg-phx-cyan text-white'
                    : isComplete
                      ? 'bg-phx-navy text-phx-cyan'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {isComplete ? '✓' : stepNumber}
              </span>
              <span
                className={`text-sm font-medium whitespace-nowrap ${
                  isActive ? 'text-phx-navy' : isComplete ? 'text-gray-600' : 'text-gray-400'
                }`}
              >
                {step}
              </span>
            </div>
            {stepNumber < steps.length && (
              <span className="hidden sm:block flex-1 h-px bg-gray-200 mx-4" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

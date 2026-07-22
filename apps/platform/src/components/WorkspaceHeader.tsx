import React from 'react';

interface WorkspaceHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function WorkspaceHeader({ eyebrow, title, description, actions }: WorkspaceHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
      <div>
        {eyebrow && (
          <p className="text-xs font-semibold tracking-widest text-phx-cyan-dark uppercase mb-2">{eyebrow}</p>
        )}
        <h1 className="text-2xl lg:text-3xl font-extrabold text-phx-navy tracking-tight">{title}</h1>
        {description && <p className="mt-2 text-sm text-gray-500 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 flex-shrink-0">{actions}</div>}
    </div>
  );
}

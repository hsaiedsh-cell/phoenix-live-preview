import React from 'react';
import { IconAlert } from './Icons';

interface AlphaNoticeProps {
  children: React.ReactNode;
  variant?: 'default' | 'inline';
}

export function AlphaNotice({ children, variant = 'default' }: AlphaNoticeProps) {
  if (variant === 'inline') {
    return (
      <p className="flex items-start gap-2 text-xs text-gray-500">
        <IconAlert className="flex-shrink-0 mt-0.5 text-gray-400" width={14} height={14} />
        <span>{children}</span>
      </p>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <IconAlert className="flex-shrink-0 mt-0.5 text-amber-600" width={18} height={18} />
      <p className="text-sm text-amber-800 leading-relaxed">{children}</p>
    </div>
  );
}

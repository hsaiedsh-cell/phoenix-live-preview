import React from 'react';
import type { ReportListItemViewModel } from '@/lib/api-client';
import { IconReport } from './Icons';

interface ReportCardProps {
  item: ReportListItemViewModel;
}

export function ReportCard({ item }: ReportCardProps) {
  const { report, template, statusLabel, ctaLabel } = item;
  const isComingSoon = report.status !== 'Available';
  const generatedDate = report.generatedAt ? report.generatedAt.slice(0, 10) : '—';

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-7 flex flex-col">
      <div className="flex items-start justify-between mb-5">
        <div className="w-11 h-11 rounded-lg bg-phx-cyan/10 flex items-center justify-center text-phx-cyan">
          <IconReport />
        </div>
        <span
          className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            isComingSoon ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {statusLabel}
        </span>
      </div>
      <h3 className="text-base font-bold text-phx-navy mb-2">{report.name}</h3>
      <p className="text-sm text-gray-600 leading-relaxed mb-5 flex-1">{template?.description}</p>
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <span className="text-xs text-gray-400">Generated {generatedDate}</span>
        <button
          disabled={isComingSoon}
          className={`text-xs font-semibold ${
            isComingSoon ? 'text-gray-300 cursor-not-allowed' : 'text-phx-cyan hover:text-phx-cyan-dark'
          }`}
        >
          {ctaLabel} →
        </button>
      </div>
    </div>
  );
}

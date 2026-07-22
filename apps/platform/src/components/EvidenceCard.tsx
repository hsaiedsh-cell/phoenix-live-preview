import React from 'react';
import type { EvidenceItem } from '@phoenix/core';
import { ownerNameForUserId } from '@/lib/mock-ids';
import { IconEvidence } from './Icons';

const TYPE_LABELS: Record<string, string> = {
  Document: 'Document',
  Screenshot: 'Screenshot',
  Dataset: 'Dataset',
  SourceOutput: 'Source Output',
  ReviewerNote: 'Reviewer Note',
  ExternalLink: 'External Link',
  Other: 'Other',
};

const DIMENSION_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  compliance: 'Compliance',
  brandAlignment: 'Brand Alignment',
  structure: 'Structure',
  consistency: 'Consistency',
  completeness: 'Completeness',
};

interface EvidenceCardProps {
  evidence: EvidenceItem;
}

/** Single EvidenceItem: type, title, note/source, uploader, date, and related dimension. Read-only — no editing. */
export function EvidenceCard({ evidence }: EvidenceCardProps) {
  const source = evidence.note ?? evidence.externalUrl ?? evidence.fileUrl ?? '—';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-md bg-phx-cyan/10 text-phx-cyan-dark flex items-center justify-center flex-shrink-0">
            <IconEvidence width={14} height={14} />
          </span>
          <p className="text-sm font-semibold text-phx-navy truncate">{evidence.title}</p>
        </div>
        {evidence.relatedDimension && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap flex-shrink-0">
            {DIMENSION_LABELS[evidence.relatedDimension] ?? evidence.relatedDimension}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 leading-relaxed mb-3">{source}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
        <span className="font-medium text-gray-500">{TYPE_LABELS[evidence.type] ?? evidence.type}</span>
        <span>Uploaded by {ownerNameForUserId(evidence.uploadedByUserId)}</span>
        <span>{evidence.createdAt.slice(0, 10)}</span>
      </div>
    </div>
  );
}

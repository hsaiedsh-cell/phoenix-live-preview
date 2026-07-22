import React from 'react';
import type { AuditRecord } from '@phoenix/core';
import { ownerNameForUserId } from '@/lib/mock-ids';
import { EmptyState } from './EmptyState';
import { IconLock } from './Icons';
function formatPreviewDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function summarizeChanges(changes: Record<string, [unknown, unknown]>): string {
  const entries = Object.entries(changes);
  if (entries.length === 0) return 'No field-level changes recorded.';
  return entries.map(([field, [before, after]]) => `${field}: ${String(before)} → ${String(after)}`).join('; ');
}

interface AuditTrailPreviewProps {
  records: AuditRecord[];
}

/**
 * Immutable audit trail preview — action, actor, entity type, change
 * summary, and timestamp per record. No edit/delete affordance is rendered;
 * AuditRecord is append-only by design (see mock-fixtures/audit.ts).
 */
export function AuditTrailPreview({ records }: AuditTrailPreviewProps) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon={<IconLock />}
        title="No audit records yet"
        description="Immutable change records related to this item will appear here once actions are recorded."
      />
    );
  }

  return (
    <div className="space-y-3">
      {records.map((record) => (
        <div key={record.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <p className="text-sm font-semibold text-phx-navy">{record.action}</p>
            <span className="text-[11px] text-gray-400 whitespace-nowrap">{formatPreviewDate(record.createdAt)}</span>
          </div>
          <p className="text-xs text-gray-500 mb-2">{summarizeChanges(record.changes)}</p>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <span>{record.entityType}</span>
            <span aria-hidden="true">·</span>
            <span>{record.actorUserId ? ownerNameForUserId(record.actorUserId) : 'System'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

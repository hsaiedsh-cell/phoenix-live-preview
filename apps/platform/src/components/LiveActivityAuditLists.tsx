// ============================================================
// Phoenix Platform — LiveActivityAuditLists
// PHX-PLATFORM-011    — Live Read Migration for Production Auth
// PHX-PLATFORM-011-R1 — Server-Side Production Auth Token & Live
//   Backend Verification Fix
// ------------------------------------------------------------
// Renders GET /api/workspaces/:workspaceId/activity and
// .../audit-records rows. Deliberately not ActivityTimeline/
// AuditTrailPreview — those components require the mock ActivityLog /
// AuditRecord contract shapes.
//
// PHX-PLATFORM-011-R1 CORRECTION: live verification against a real,
// seeded backend found this component (and the BackendActivityItem/
// BackendAuditRecord types) used the WRONG field names throughout —
// PHX-PLATFORM-011 assumed snake_case fields (`actor_display_name`,
// `entity_type`, `created_at`) and an `action` field on activity items
// that does not exist there (activity rows have a pre-composed
// `summary` sentence and a `type` instead). Audit records have no
// `actorDisplayName` at all (only `actorUserId`, a raw id or null for
// system actions) — this component now shows that id directly (or
// "System") rather than a display name it has no way to resolve
// without an additional endpoint outside this sprint's scope.
// ============================================================

import type { BackendActivityItem, BackendAuditRecord } from '@/lib/real-api-client';
import { EmptyState } from './EmptyState';
import { IconHistory, IconLock } from './Icons';
function formatPreviewDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function LiveActivityList({ items }: { items: BackendActivityItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState icon={<IconHistory />} title="No activity yet" description="Workspace activity will appear here." />
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <span className="w-2 h-2 rounded-full bg-phx-cyan mt-1.5 flex-shrink-0" />
          <div className="flex-1 pb-3 border-b border-gray-100 last:border-b-0 last:pb-0">
            <p className="text-sm text-phx-navy">{item.summary}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {item.actorDisplayName} · {formatPreviewDate(item.createdAt)}
              {item.relatedEntityType ? ` · ${item.relatedEntityType}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LiveAuditList({ items }: { items: BackendAuditRecord[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconLock />}
        title="No audit records yet"
        description="Immutable audit records will appear here once actions are recorded."
      />
    );
  }
  return (
    <div className="space-y-3">
      {items.map((record) => (
        <div key={record.id} className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <p className="text-sm font-semibold text-phx-navy">{record.action}</p>
            <span className="text-[11px] text-gray-400 whitespace-nowrap">{formatPreviewDate(record.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-gray-400">
            <span>{record.entityType}</span>
            <span aria-hidden="true">·</span>
            {/* No display-name field exists on a live audit record — only
                a raw user id (or null for a system action). Showing a
                truncated id rather than fabricating/looking up a name. */}
            <span>{record.actorUserId ? `User ${record.actorUserId.slice(0, 8)}…` : 'System'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

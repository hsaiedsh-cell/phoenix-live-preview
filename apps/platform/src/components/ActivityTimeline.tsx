import React from 'react';
import type { ActivityLog } from '@phoenix/core';
import { EmptyState } from './EmptyState';
import { IconHistory } from './Icons';

interface ActivityTimelineProps {
  items: ActivityLog[];
}

/** Read-only workspace activity feed — summary, actor, related entity, timestamp. */
export function ActivityTimeline({ items }: ActivityTimelineProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconHistory />}
        title="No activity yet"
        description="Workspace activity related to this item will appear here."
      />
    );
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <span className="w-2 h-2 rounded-full bg-phx-cyan mt-1.5 flex-shrink-0" />
          <div className="flex-1 pb-4 border-b border-gray-100 last:border-b-0 last:pb-0">
            <p className="text-sm text-phx-navy">{item.summary}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {item.actorDisplayName} · {item.createdAt.slice(0, 10)}
              {item.relatedEntityType ? ` · ${item.relatedEntityType}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

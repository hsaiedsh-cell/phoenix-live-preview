import React from 'react';
import { getRestrictedMessage } from '@/lib/access-control';
import type { PhoenixPermission } from '@/lib/access-control';
import { IconLock } from './Icons';

interface RestrictedNoteProps {
  permission: PhoenixPermission;
}

/**
 * Muted "not available for your role" note used as a RoleGate fallback.
 * Keeps hidden sections legible rather than silently disappearing, without
 * making any real security claim.
 */
export function RestrictedNote({ permission }: RestrictedNoteProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3.5">
      <IconLock className="flex-shrink-0 mt-0.5 text-gray-400" width={14} height={14} />
      <p className="text-xs text-gray-500 leading-relaxed">{getRestrictedMessage(permission)}</p>
    </div>
  );
}

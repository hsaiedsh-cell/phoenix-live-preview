'use client';

// PHX-PLATFORM-006 — Settings currently exposes read-only fields only (no
// live edit controls), so there is nothing functional to hide for
// non-managers. This note simply clarifies who could manage these settings
// once editing exists, per PERMISSIONS_MODEL_PHX_PLATFORM_002.md
// ("Update workspace settings": Owner/Admin only).

import React from 'react';
import { usePhoenixSession } from '@/hooks/usePhoenixSession';

export function WorkspaceManagementNote() {
  const { capabilities } = usePhoenixSession();
  if (!capabilities || capabilities.canManageWorkspace) return null;

  return (
    <p className="text-[11px] text-gray-400 mt-2">
      Workspace settings shown here are read-only for your role. Owner and Admin roles can manage these settings.
    </p>
  );
}

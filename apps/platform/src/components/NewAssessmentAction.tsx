'use client';

// PHX-PLATFORM-006 — role-aware wrapper around the existing "New
// Assessment" action (previously inlined in assessments/page.tsx).
// Shows the button for roles with canCreateAssessment, otherwise a
// muted explanatory note — no new action is introduced.

import React from 'react';
import Link from 'next/link';
import { usePhoenixSession } from '@/hooks/usePhoenixSession';
import { getRestrictedMessage } from '@/lib/access-control';
import { IconPlus } from './Icons';

export function NewAssessmentAction() {
  const { capabilities } = usePhoenixSession();
  if (!capabilities) return null;

  if (!capabilities.canCreateAssessment) {
    return <p className="text-xs text-gray-400 max-w-[220px] text-right">{getRestrictedMessage('canCreateAssessment')}</p>;
  }

  return (
    <Link
      href="/assessments/new"
      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-phx-cyan text-white hover:bg-phx-cyan-dark transition-colors shadow-sm"
    >
      <IconPlus width={16} height={16} />
      New Assessment
    </Link>
  );
}

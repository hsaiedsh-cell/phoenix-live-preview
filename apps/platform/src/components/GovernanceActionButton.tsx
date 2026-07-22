'use client';

// ============================================================
// Phoenix Platform — GovernanceActionButton
// PHX-PLATFORM-007 — Passport & Certification Action Layer
// PHX-PLATFORM-008 — Session Hydration Stabilization
// ------------------------------------------------------------
// Role-aware button for a single mock governance action (issue/revoke
// passport, grant/revoke certification). Wraps ActionConfirmDialog and a
// caller-supplied async handler that returns a PhoenixActionResult.
//
// Permission gating uses the same usePhoenixSession() capabilities map
// that RoleGate.tsx reads — when the current mock role lacks the given
// permission, this renders a muted RestrictedNote instead of the button,
// consistent with the rest of the platform's role-gated UI. As with
// everywhere else in this Alpha, this is UI-only gating, not a security
// boundary — see access-control.ts and api-client.ts's file-level notes.
//
// PHX-PLATFORM-008: this used to wait for a client `mounted` flag before
// rendering anything, specifically to dodge a hydration mismatch caused
// by SessionProvider's old "resolve role immediately" initial state. Now
// that SessionProvider always starts in a neutral `loading` state on both
// server and client (see SessionProvider.tsx / mock-session.ts), that
// workaround is unnecessary — this reads `isLoading` from
// usePhoenixSession() directly instead.
// ============================================================

import React, { useState } from 'react';
import { usePhoenixSession } from '@/hooks/usePhoenixSession';
import type { PhoenixPermission } from '@/lib/access-control';
import type { PhoenixActionResult, PhoenixActionStatus } from '@/lib/action-types';
import { RestrictedNote } from './RestrictedNote';
import { ActionConfirmDialog } from './ActionConfirmDialog';

interface GovernanceActionButtonProps {
  /** Permission required to see/use this action (see access-control.ts). */
  permission: PhoenixPermission;
  /** Visible label on the trigger button, e.g. "Revoke Passport". */
  label: string;
  /** Dialog title, defaults to `label` if omitted. */
  dialogTitle?: string;
  /** Dialog description/explanation shown above the confirm action. */
  description: string;
  /** Label for the dialog's confirm button, defaults to `label`. */
  confirmLabel?: string;
  /** Whether a documented reason is required before this action can be confirmed. */
  reasonRequired?: boolean;
  reasonLabel?: string;
  /** Visual weight of the trigger button. */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Runs the actual mock action (an api-client.ts function) and returns its result. */
  onRun: (reason: string) => Promise<PhoenixActionResult>;
  /** Called after a successful (`ok: true`) action result, e.g. to close a parent panel or refresh. */
  onSuccess?: (result: PhoenixActionResult) => void;
  className?: string;
}

const VARIANT_CLASSES: Record<NonNullable<GovernanceActionButtonProps['variant']>, string> = {
  primary: 'bg-phx-cyan text-white hover:bg-phx-cyan-dark shadow-sm',
  secondary: 'border border-gray-300 text-phx-navy hover:border-phx-cyan hover:text-phx-cyan-dark',
  danger: 'border border-red-200 text-red-700 hover:bg-red-50',
};

export function GovernanceActionButton({
  permission,
  label,
  dialogTitle,
  description,
  confirmLabel,
  reasonRequired = false,
  reasonLabel,
  variant = 'secondary',
  onRun,
  onSuccess,
  className = '',
}: GovernanceActionButtonProps) {
  const { isLoading, isAuthenticated, capabilities } = usePhoenixSession();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PhoenixActionStatus>('idle');
  const [resultMessage, setResultMessage] = useState<string | undefined>(undefined);

  // While the mock session is still resolving (server render and the
  // client's first hydration pass), render nothing — a safe (fail-closed)
  // default for governance actions specifically. This is not a guess at
  // any particular role's permissions; it's the same neutral state on
  // both server and client, so there is nothing to mismatch.
  if (isLoading) return null;
  if (!isAuthenticated || !capabilities) return null;
  if (!capabilities[permission]) {
    return <RestrictedNote permission={permission} />;
  }

  function handleOpen() {
    setStatus('confirming');
    setResultMessage(undefined);
    setOpen(true);
  }

  function handleClose() {
    setOpen(false);
    setStatus('idle');
    setResultMessage(undefined);
  }

  async function handleConfirm(reason: string) {
    setStatus('submitting');
    try {
      const result = await onRun(reason);
      setResultMessage(result.message);
      setStatus(result.ok ? 'success' : 'error');
      if (result.ok) onSuccess?.(result);
    } catch {
      setStatus('error');
      setResultMessage('This mock action could not be completed. Please try again.');
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`inline-flex items-center justify-center px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className}`}
      >
        {label}
      </button>
      <ActionConfirmDialog
        open={open}
        title={dialogTitle ?? label}
        description={description}
        confirmLabel={confirmLabel ?? label}
        reasonRequired={reasonRequired}
        reasonLabel={reasonLabel}
        status={status}
        resultMessage={resultMessage}
        onConfirm={handleConfirm}
        onClose={handleClose}
      />
    </>
  );
}

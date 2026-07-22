'use client';

// ============================================================
// Phoenix Platform — ActionConfirmDialog
// PHX-PLATFORM-007 — Passport & Certification Action Layer
// ------------------------------------------------------------
// Reusable confirmation panel for mock governance actions (issue/revoke
// passport, grant/revoke certification). Renders as an inline modal
// overlay — no new heavy UI dependency is introduced; styling matches the
// existing platform card/panel conventions (rounded-xl, gray-200 borders,
// phx-navy/phx-cyan accents).
//
// This component is purely presentational + local state (open/close,
// reason text, submitting/success/error). It does not call any API
// function itself — the caller (GovernanceActionButton) passes an
// `onConfirm` handler and interprets the PhoenixActionResult.
// ============================================================

import React, { useState } from 'react';
import { IconAlert, IconClose } from './Icons';
import type { PhoenixActionStatus } from '@/lib/action-types';

interface ActionConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** When true, a non-empty reason is required before Confirm can be pressed. */
  reasonRequired?: boolean;
  reasonLabel?: string;
  status: PhoenixActionStatus;
  /** Message to show once status is 'success' or 'error'. */
  resultMessage?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

export function ActionConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  reasonRequired = false,
  reasonLabel = 'Reason',
  status,
  resultMessage,
  onConfirm,
  onClose,
}: ActionConfirmDialogProps) {
  const [reason, setReason] = useState('');

  if (!open) return null;

  const isSubmitting = status === 'submitting';
  const isDone = status === 'success' || status === 'error';
  const confirmDisabled = isSubmitting || (reasonRequired && !reason.trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-phx-navy/40 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-confirm-title"
    >
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-xl p-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 id="action-confirm-title" className="text-base font-bold text-phx-navy">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-phx-navy transition-colors flex-shrink-0"
          >
            <IconClose width={16} height={16} />
          </button>
        </div>

        {!isDone && (
          <>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">{description}</p>

            {reasonRequired && (
              <div className="mb-5">
                <label htmlFor="action-confirm-reason" className="block text-sm font-semibold text-phx-navy mb-1.5">
                  {reasonLabel}
                </label>
                <textarea
                  id="action-confirm-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Document why this action is being taken…"
                  className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-phx-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-phx-cyan/40 focus:border-phx-cyan transition-colors"
                />
                <p className="mt-1.5 text-xs text-gray-400">A documented reason is required for this action.</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:text-phx-navy transition-colors disabled:opacity-50"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={() => onConfirm(reason)}
                disabled={confirmDisabled}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-phx-cyan text-white hover:bg-phx-cyan-dark transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting…' : confirmLabel}
              </button>
            </div>
          </>
        )}

        {isDone && (
          <div className="pt-1">
            <div
              className={`flex items-start gap-2.5 rounded-lg border px-4 py-3.5 mb-5 ${
                status === 'success'
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-red-200 bg-red-50'
              }`}
            >
              <IconAlert
                className={`flex-shrink-0 mt-0.5 ${status === 'success' ? 'text-emerald-600' : 'text-red-600'}`}
                width={16}
                height={16}
              />
              <p className={`text-sm leading-relaxed ${status === 'success' ? 'text-emerald-800' : 'text-red-800'}`}>
                {resultMessage}
              </p>
            </div>
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-lg text-sm font-semibold bg-phx-navy text-white hover:bg-phx-navy-mid transition-colors shadow-sm"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

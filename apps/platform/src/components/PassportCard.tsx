'use client';

import React, { useState } from 'react';
import type { PassportListItemViewModel } from '@/lib/api-client';
import { revokePassport } from '@/lib/api-client';
import { GradeBadge } from './Badges';
import { IconQRPlaceholder } from './Icons';
import { GovernanceActionButton } from './GovernanceActionButton';

interface PassportCardProps {
  item: PassportListItemViewModel;
}

export function PassportCard({ item }: PassportCardProps) {
  const {
    passport,
    asset,
    score,
    certification,
    simpleGrade,
    certificationLevelLabel,
    internalTier,
    showInternalTier,
  } = item;

  // Mock-only, local-state revocation marker (PHX-PLATFORM-007). Nothing is
  // persisted — a page refresh reverts this. See revokePassport() in
  // api-client.ts for the file-level note on why this Alpha does not
  // hard-delete or truly mutate passport records.
  const [revokedNote, setRevokedNote] = useState<string | null>(null);
  const isMockRevoked = revokedNote !== null;

  // PHX-CERT-002 — Certification Level is the primary status line
  // (Architecture doc §9; UI Copy Guide §2). Internal Tier is optional,
  // secondary metadata gated by showInternalTier (see
  // certification-levels.ts shouldDisplayInternalTier()). PHX-CERT-003:
  // the former 70–72 gap band no longer produces a contradictory value, so
  // showInternalTier is retained purely as a context/future-governance
  // gate, not a contradiction filter.
  const primaryStatusLabel = isMockRevoked
    ? 'Revoked (Alpha mock action)'
    : certification
      ? `Certification Level: ${certificationLevelLabel}`
      : 'Pending Certification';

  return (
    <div className={`bg-phx-navy rounded-xl p-6 border ${isMockRevoked ? 'border-red-400/40' : 'border-phx-navy-mid'}`}>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-phx-cyan uppercase mb-1.5">
            {passport.passportId}
          </p>
          <h3 className="text-base font-bold text-white">{asset.name}</h3>
        </div>
        <GradeBadge grade={simpleGrade} />
      </div>

      <div className="flex items-center gap-4 py-4 border-y border-white/10">
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Score</p>
          <p className="text-lg font-extrabold text-white">{score.summary.overall}</p>
        </div>
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Status</p>
          <p className={`text-sm font-semibold ${isMockRevoked ? 'text-red-300' : 'text-phx-cyan'}`}>
            {primaryStatusLabel}
          </p>
          {certification && showInternalTier && !isMockRevoked && (
            <p className="text-[11px] text-gray-500 mt-0.5">Internal Tier: {internalTier}</p>
          )}
        </div>
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Valid Until</p>
          <p className="text-sm font-medium text-white">{(passport.validUntil ?? '').slice(0, 10)}</p>
        </div>
        <div className="text-gray-600 flex-shrink-0">
          <IconQRPlaceholder />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-500 font-mono truncate">{passport.recordHash}</p>
        <button className="text-xs font-semibold text-phx-cyan hover:text-phx-cyan-light whitespace-nowrap">
          View Passport →
        </button>
      </div>
      <p className="mt-3 text-[11px] text-gray-500">Verification portal coming soon.</p>

      {isMockRevoked ? (
        <p className="mt-4 text-[11px] text-red-300 leading-relaxed">{revokedNote}</p>
      ) : (
        <div className="mt-4 pt-4 border-t border-white/10">
          <GovernanceActionButton
            permission="canRevokePassport"
            label="Revoke Passport"
            description={`Revoke ${passport.passportId} for ${asset.name}. This is an Alpha mock action — the passport record is not deleted, and nothing is persisted after a page refresh.`}
            confirmLabel="Revoke Passport"
            reasonRequired
            reasonLabel="Revocation reason"
            variant="danger"
            onRun={(reason) => revokePassport({ passportId: passport.passportId, reason })}
            onSuccess={(result) => setRevokedNote(result.message)}
          />
        </div>
      )}
    </div>
  );
}

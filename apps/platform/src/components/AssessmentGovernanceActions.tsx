'use client';

// ============================================================
// Phoenix Platform — AssessmentGovernanceActions
// PHX-PLATFORM-007 — Passport & Certification Action Layer
// ------------------------------------------------------------
// Lightweight governance action area for the assessment detail page
// (Task 8). Placed below AssessmentScoreSummary — see
// assessments/[assessmentId]/page.tsx. Shows Issue Passport for
// eligible, not-yet-Certified assessments and Grant Certification once a
// passport exists for this asset. Both actions are mock-only; see the
// file-level notes in api-client.ts and action-types.ts.
// ============================================================

import React, { useState } from 'react';
import { issuePassport, grantCertification, PBRS_CERTIFICATION_SAFE_DISCLAIMER } from '@/lib/api-client';
import { GovernanceActionButton } from './GovernanceActionButton';

interface AssessmentGovernanceActionsProps {
  assessmentId: string;
  assetName: string;
  statusLabel: string;
  eligibleCertificationLevel?: string;
  /** Existing passport id for this asset, if one has already been issued in the sample data. */
  existingPassportId?: string;
}

export function AssessmentGovernanceActions({
  assessmentId,
  assetName,
  statusLabel,
  eligibleCertificationLevel,
  existingPassportId,
}: AssessmentGovernanceActionsProps) {
  const [passportId, setPassportId] = useState<string | undefined>(existingPassportId);
  const [issueNote, setIssueNote] = useState<string | undefined>(undefined);
  const [grantNote, setGrantNote] = useState<string | undefined>(undefined);

  const isCertified = statusLabel === 'Certified';
  const isEligible = Boolean(eligibleCertificationLevel) && eligibleCertificationLevel !== 'None';

  // Not enough mock state exists to know with certainty whether a passport
  // was already issued for every asset shape this page can render, so this
  // area shows itself whenever the assessment is eligible and not already
  // Certified — per Task 8, an Alpha preview action with clear wording is
  // acceptable rather than inventing a precise not-issued state.
  if (isCertified || !isEligible) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
      <h2 className="text-base font-bold text-phx-navy mb-1.5">Governance Actions</h2>
      <p className="text-xs text-gray-500 mb-5 max-w-2xl">
        Alpha mock workflow actions — nothing here is persisted to a real backend, and a page refresh reverts any
        change shown below.
      </p>

      <div className="flex flex-wrap items-center gap-4">
        {issueNote ? (
          <p className="text-xs text-emerald-700 leading-relaxed">{issueNote}</p>
        ) : (
          <GovernanceActionButton
            permission="canIssuePassport"
            label="Issue Passport"
            dialogTitle="Issue Passport — Alpha mock action"
            description={`Issue a PBRS Passport for ${assetName}. This is an Alpha mock action — nothing is persisted to a real backend, and a page refresh reverts it.`}
            confirmLabel="Issue Passport"
            variant="primary"
            onRun={() => issuePassport({ assessmentId })}
            onSuccess={(result) => {
              setIssueNote(result.message);
              // Mock-only: synthesize a passport reference so Grant
              // Certification can immediately follow in the same session,
              // without a real backend round-trip.
              setPassportId((prev) => prev ?? `PBRS-ACME-2026-MOCK-${assessmentId}`);
            }}
          />
        )}

        {grantNote ? (
          <p className="text-xs text-emerald-700 leading-relaxed">{grantNote}</p>
        ) : (
          <GovernanceActionButton
            permission="canGrantCertification"
            label="Grant Certification"
            description={`Grant a PBRS certification for ${assetName}${
              passportId ? `, referencing passport ${passportId}` : ''
            }. ${PBRS_CERTIFICATION_SAFE_DISCLAIMER} This is an Alpha mock action — nothing is persisted.`}
            confirmLabel="Grant Certification"
            variant="secondary"
            onRun={() => grantCertification({ passportId: passportId ?? `PBRS-ACME-2026-MOCK-${assessmentId}` })}
            onSuccess={(result) => setGrantNote(result.message)}
          />
        )}
      </div>
    </div>
  );
}

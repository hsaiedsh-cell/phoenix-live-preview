'use client';

// ============================================================
// Phoenix Platform — CertificationGovernancePanel
// PHX-PLATFORM-007 — Passport & Certification Action Layer
// ------------------------------------------------------------
// Client-side governance action area for /certifications. AssessmentTable
// and CertificationCard remain unchanged, shared, presentational
// components (Task 7 constraint: "do not redesign") — this panel is an
// additive area placed near the eligible/certified asset lists that adds
// the mock Grant/Revoke Certification actions with role gating.
//
// Certification Level naming stays primary throughout (PBRS Foundation /
// Practitioner / Enterprise); Internal Tier (Bronze/Silver/Gold/Platinum)
// is never used as a label here, consistent with certification-levels.ts.
// ============================================================

import React, { useState } from 'react';
import Link from 'next/link';
import type {
  AssessmentListItemViewModel,
  CertificationListItemViewModel,
} from '@/lib/api-client';
import { grantCertification, revokeCertification, PBRS_CERTIFICATION_SAFE_DISCLAIMER } from '@/lib/api-client';
import { GovernanceActionButton } from './GovernanceActionButton';
import { GradeBadge } from './Badges';

interface CertificationGovernancePanelProps {
  eligibleItems: AssessmentListItemViewModel[];
  /** asset.id -> passport.passportId, looked up server-side from getPassports(). */
  passportIdByAssetId: Record<string, string>;
  certifiedItems: CertificationListItemViewModel[];
}

export function CertificationGovernancePanel({
  eligibleItems,
  passportIdByAssetId,
  certifiedItems,
}: CertificationGovernancePanelProps) {
  const [grantedNotes, setGrantedNotes] = useState<Record<string, string>>({});
  const [revokedNotes, setRevokedNotes] = useState<Record<string, string>>({});

  const hasEligible = eligibleItems.length > 0;
  const hasCertified = certifiedItems.length > 0;

  if (!hasEligible && !hasCertified) return null;

  return (
    <div className="space-y-10">
      {hasEligible && (
        <div>
          <h2 className="text-base font-bold text-phx-navy mb-1.5">Eligible for Certification</h2>
          <p className="text-xs text-gray-500 mb-4 max-w-2xl">
            Assets that have reached Business Ready status and clear a Certification Level threshold, but have not
            yet been granted a certification. {PBRS_CERTIFICATION_SAFE_DISCLAIMER}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {eligibleItems.map((item) => {
              const passportId = passportIdByAssetId[item.asset.id];
              const note = grantedNotes[item.asset.id];
              return (
                <div key={item.asset.id} className="bg-white border border-gray-200 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <Link
                        href={`/assessments/${item.assessment.id}`}
                        className="text-sm font-semibold text-phx-navy hover:text-phx-cyan-dark transition-colors"
                      >
                        {item.asset.name}
                      </Link>
                      <p className="text-xs text-gray-400">{item.asset.department}</p>
                    </div>
                    <GradeBadge grade={item.simpleGrade} />
                  </div>
                  <p className="text-xs text-gray-500 mb-4">
                    Score {item.score.summary.overall} · {item.riskLabel} risk
                  </p>

                  {note ? (
                    <p className="text-[11px] text-emerald-700 leading-relaxed">{note}</p>
                  ) : passportId ? (
                    <GovernanceActionButton
                      permission="canGrantCertification"
                      label="Grant Certification"
                      description={`Grant a PBRS certification for ${item.asset.name}, referencing passport ${passportId}. ${PBRS_CERTIFICATION_SAFE_DISCLAIMER} This is an Alpha mock action — nothing is persisted after a page refresh.`}
                      confirmLabel="Grant Certification"
                      variant="primary"
                      onRun={() => grantCertification({ passportId })}
                      onSuccess={(result) => setGrantedNotes((prev) => ({ ...prev, [item.asset.id]: result.message }))}
                    />
                  ) : (
                    <p className="text-[11px] text-gray-400">
                      No passport on record yet — issue a passport from the assessment detail page first.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasCertified && (
        <div>
          <h2 className="text-base font-bold text-phx-navy mb-1.5">Certification Governance</h2>
          <p className="text-xs text-gray-500 mb-4 max-w-2xl">
            Certification revocation is restricted to the workspace Owner and requires a documented reason. This is
            an Alpha mock action — the certification record is not deleted.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {certifiedItems.map((item) => {
              const note = revokedNotes[item.asset.id];
              return (
                <div key={item.asset.id} className="bg-white border border-gray-200 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <Link
                        href={`/assessments/${item.assessment.id}`}
                        className="text-sm font-semibold text-phx-navy hover:text-phx-cyan-dark transition-colors"
                      >
                        {item.asset.name}
                      </Link>
                      <p className="text-xs text-gray-400">{item.certificationLevelLabel}</p>
                    </div>
                    <GradeBadge grade={item.simpleGrade} />
                  </div>

                  {note ? (
                    <p className="text-[11px] text-red-600 leading-relaxed">{note}</p>
                  ) : (
                    <GovernanceActionButton
                      permission="canRevokeCertification"
                      label="Revoke Certification"
                      description={`Revoke the certification for ${item.asset.name} (${item.certification.certificationId}). This is an Alpha mock action — the record is not deleted, and nothing is persisted after a page refresh.`}
                      confirmLabel="Revoke Certification"
                      reasonRequired
                      reasonLabel="Revocation reason"
                      variant="danger"
                      onRun={(reason) =>
                        revokeCertification({
                          passportId: item.passport.passportId,
                          certificationId: item.certification.certificationId,
                          reason,
                        })
                      }
                      onSuccess={(result) =>
                        setRevokedNotes((prev) => ({ ...prev, [item.asset.id]: result.message }))
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

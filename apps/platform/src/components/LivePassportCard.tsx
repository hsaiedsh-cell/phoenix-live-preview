// ============================================================
// Phoenix Platform — LivePassportCard
// PHX-PASSPORTS-001 — Live Passport Endpoint Foundation
// ------------------------------------------------------------
// Renders one previewGetPassports() row (BackendPassport) for
// vercel-supabase-preview mode. Deliberately NOT PassportCard — that
// component (a) expects the full mock PassportListItemViewModel shape
// (core Asset/Assessment/PBRSScoreRecord/PBRSCertificationRecord
// objects this live read does not construct — see BackendPassport's
// doc comment in real-api-client.ts) and (b) wires its revoke button
// to revokePassport(), which is safe to leave connected in every other
// mode (api-client.ts's revokePassport() only special-cases
// mode === 'mock'; every other mode already returns the disabled/
// "not enabled" response) but is not the clearest way to communicate
// "this action is not implemented for live data yet" — this component
// renders that as plain, inert copy instead of a clickable
// confirm-dialog button, per this sprint's "any unsupported action
// buttons must remain disabled, preview-only, or clearly
// non-persistent" instruction.
//
// certificationLevel/certificationLevelLabel/internalTier/
// showInternalTier are NOT stored columns — they are derived here from
// `item.scoreSnapshot` / `item.certificationTier` /
// `item.certificationStatus` via lib/certification-levels.ts's pure
// helpers, the single source of truth for that presentation logic (no
// PBRS scoring/threshold logic is duplicated in this file).
// ============================================================

import type { BackendPassport } from '@/lib/real-api-client';
import {
  certificationLevelFromScore,
  certificationStatusLabel,
  shouldDisplayInternalTier,
} from '@/lib/certification-levels';
import { GradeBadge } from './Badges';
import { IconQRPlaceholder } from './Icons';

/** Same safe-formatting convention as LiveAssessmentsTable.tsx / ActivityTimeline.tsx / EvidenceCard.tsx — never call .slice() on an unguarded value. */
function formatPreviewDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Narrows an arbitrary DB string to the GradeBadge-safe union, falling back to 'Hold' for any unexpected value rather than rendering a blank badge. */
function toSimpleGrade(value: string): 'A' | 'B' | 'C' | 'Hold' {
  return value === 'A' || value === 'B' || value === 'C' || value === 'Hold' ? value : 'Hold';
}

interface LivePassportCardProps {
  item: BackendPassport;
}

export function LivePassportCard({ item }: LivePassportCardProps) {
  const hasCertification = item.certificationStatus === 'Certified';
  const level = certificationLevelFromScore(item.scoreSnapshot);
  const statusLabel = certificationStatusLabel(level, hasCertification);
  const showInternalTier = Boolean(
    item.certificationTier && shouldDisplayInternalTier(item.scoreSnapshot, level, item.certificationTier)
  );
  const isRevoked = item.status === 'Revoked';

  return (
    <div
      className={`bg-phx-navy rounded-xl p-6 border ${isRevoked ? 'border-red-400/40' : 'border-phx-navy-mid'}`}
    >
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-phx-cyan uppercase mb-1.5">
            {item.passportId}
          </p>
          <h3 className="text-base font-bold text-white">{item.assetName}</h3>
        </div>
        <GradeBadge grade={toSimpleGrade(item.gradeSnapshot)} />
      </div>

      <div className="flex items-center gap-4 py-4 border-y border-white/10">
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Score</p>
          <p className="text-lg font-extrabold text-white">{item.scoreSnapshot}</p>
        </div>
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Status</p>
          <p className={`text-sm font-semibold ${isRevoked ? 'text-red-300' : 'text-phx-cyan'}`}>
            {isRevoked ? 'Revoked' : statusLabel}
          </p>
          {hasCertification && showInternalTier && !isRevoked && (
            <p className="text-[11px] text-gray-500 mt-0.5">Internal Tier: {item.certificationTier}</p>
          )}
        </div>
        <div className="flex-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Valid Until</p>
          <p className="text-sm font-medium text-white">{formatPreviewDate(item.validUntil)}</p>
        </div>
        <div className="text-gray-600 flex-shrink-0">
          <IconQRPlaceholder />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] text-gray-500 font-mono truncate">{item.recordHash}</p>
      </div>
      <p className="mt-3 text-[11px] text-gray-500">
        Public verification portal: preview-only, not yet live.
      </p>

      <div className="mt-4 pt-4 border-t border-white/10">
        <p className="text-[11px] text-gray-500 leading-relaxed">
          Passport issuing, revocation, and certification actions are preview-only for live data — no action
          is available for this record yet.
        </p>
      </div>
    </div>
  );
}

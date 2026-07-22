// ============================================================
// Phoenix Platform — PBRS Certification Level Helpers
// PHX-CERT-002 — Certification Level Implementation
// ------------------------------------------------------------
// Implements the naming architecture approved in
// PBRS_CERTIFICATION_ARCHITECTURE_PHX_CERT_001.md:
//
//   PBRS Certification Level  — client-facing, PRIMARY
//     PBRS Foundation | PBRS Practitioner | PBRS Enterprise
//
//   PBRS Internal Tier        — system-facing, SECONDARY metadata
//     Bronze | Silver | Gold | Platinum | Not Certified
//
// These are two independently-governed vocabularies (see
// Architecture doc §6.3–§6.4) that are NOT merged and NOT
// assumed to move in lockstep. This module only derives the
// client-facing Certification Level from a PBRS score and
// provides small presentation helpers — it does not touch,
// duplicate, or reimplement:
//   - the PBRS scoring model
//   - the six scored dimensions or their weights
//   - @phoenix/core's tierFromGrade() / gradeFromScore() logic
//   - CertificationTier itself (still the system of record for
//     the certification ID suffix and PBRSCertificationRecord.tier)
//
// Pure module: no import of sample-data.ts, no side effects.
// ============================================================

/** Client-facing PBRS Certification Level. Mirrors CERTIFICATION_LEVELS (sample-data.ts) thresholds. */
export type PBRSCertificationLevel =
  | 'None'
  | 'PBRS Foundation'
  | 'PBRS Practitioner'
  | 'PBRS Enterprise';

/**
 * System-facing PBRS Internal Tier. This is a presentation-layer alias of
 * the existing `CertificationTier` type from @phoenix/core (Bronze | Silver |
 * Gold | Platinum | Not Certified) — kept as a distinct exported name here so
 * certification-level call sites can express "I mean the internal tier"
 * without importing @phoenix/core just for a type alias. Values are
 * identical; this does not introduce a second source of truth.
 */
export type PBRSInternalTier = 'Not Certified' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

// --- Certification Level thresholds (unchanged, canonical — Architecture doc §6.1) ---
// Enterprise >= 92, Practitioner >= 83, Foundation >= 70, else None.
// These mirror apps/platform/src/lib/sample-data.ts's CERTIFICATION_LEVELS
// minScore values exactly and must not drift from them.

const ENTERPRISE_MIN_SCORE = 92;
const PRACTITIONER_MIN_SCORE = 83;
const FOUNDATION_MIN_SCORE = 70;

/**
 * Derives the client-facing PBRS Certification Level from a PBRS overall
 * score. Does not read or alter any dimension score, weight, or the
 * six-dimension model — operates purely on the already-computed
 * `score.summary.overall` (or equivalent) value passed in.
 */
export function certificationLevelFromScore(score: number): PBRSCertificationLevel {
  if (score >= ENTERPRISE_MIN_SCORE) return 'PBRS Enterprise';
  if (score >= PRACTITIONER_MIN_SCORE) return 'PBRS Practitioner';
  if (score >= FOUNDATION_MIN_SCORE) return 'PBRS Foundation';
  return 'None';
}

/** Short list/table-column label for a Certification Level (UI Copy Guide §2, "List/table view short labels"). */
export function certificationLevelShortLabel(level: PBRSCertificationLevel): string {
  switch (level) {
    case 'PBRS Foundation':
      return 'Foundation';
    case 'PBRS Practitioner':
      return 'Practitioner';
    case 'PBRS Enterprise':
      return 'Enterprise';
    case 'None':
    default:
      return 'Not Yet Certified';
  }
}

/**
 * Full status sentence for a Certification Level, given whether a
 * Certification has actually been granted (vs. merely eligible/scored).
 * `hasCertification` distinguishes "eligible" from "certified" — a high
 * score alone does not imply a certification has been issued.
 */
export function certificationStatusLabel(
  level: PBRSCertificationLevel,
  hasCertification: boolean
): string {
  if (!hasCertification) return 'Pending Certification';
  switch (level) {
    case 'PBRS Foundation':
      return 'PBRS Foundation Certified';
    case 'PBRS Practitioner':
      return 'PBRS Practitioner Certified';
    case 'PBRS Enterprise':
      return 'PBRS Enterprise Certified';
    case 'None':
    default:
      return 'Not Yet Certified';
  }
}

/** Whether a score clears the Foundation threshold and is eligible for any PBRS Certification Level. */
export function isCertificationLevelEligible(score: number): boolean {
  return score >= FOUNDATION_MIN_SCORE;
}

/**
 * Eligibility copy for the assessment-detail "Eligible for ___" pattern
 * (UI Copy Guide §3). Returns the exact eligibility sentence for a score,
 * independent of whether a certification has actually been granted.
 */
export function eligibilityLabelFromScore(score: number): string {
  const level = certificationLevelFromScore(score);
  if (level === 'None') return 'Not eligible — remediation required';
  return `Eligible for ${level}`;
}

/**
 * Whether the PBRS Internal Tier should be displayed alongside a
 * Certification Level on a given surface.
 *
 * PHX-CERT-003 UPDATE: the historical 70–72 Certification Level / Internal
 * Tier contradiction (Architecture doc §6.4, §9, §10; UI Copy Guide §3, §5)
 * has been resolved by lowering the Bronze internal-tier floor from 73 to
 * 70 in `@phoenix/core`'s `tierFromScore()` (see
 * `PBRS_CERTIFICATION_THRESHOLD_ADDENDUM_PHX_CERT_003.md`). A score of
 * 70–72 now derives Internal Tier `'Bronze'`, not `'Not Certified'`, so the
 * previously-contradictory pairing ("PBRS Foundation" + "Internal Tier: Not
 * Certified") can no longer occur and no band-specific suppression is
 * required.
 *
 * `score` and `internalTier` are retained as parameters — even though they
 * no longer gate a contradiction check — so call sites do not need to
 * change if a future governance decision reintroduces a band-specific rule,
 * and so this function's signature stays stable for existing callers
 * (`buildCertificationDisplay()`, `PassportCard`).
 *
 * `context` distinguishes ordinary client-facing surfaces (passports,
 * certifications page, reports) from explicit internal/admin metadata
 * surfaces — callers should pass 'internal' only for Admin/Owner-style
 * metadata components, never for the primary certification label a client
 * reads. Internal Tier remains secondary metadata only (Architecture doc
 * §9) on every surface; callers may still choose not to render it even
 * when this returns true.
 */
export function shouldDisplayInternalTier(
  score: number,
  level: PBRSCertificationLevel,
  internalTier: PBRSInternalTier | string,
  context: 'client' | 'internal' = 'client'
): boolean {
  void score;
  void level;
  void internalTier;
  void context;
  return true;
}

/** Safe, standing disclaimer required wherever a Certification Level is shown (UI Copy Guide §5; restates PBRS_STANDARD_V1_0.md §15.4). */
export const PBRS_CERTIFICATION_SAFE_DISCLAIMER =
  'PBRS Certification is a Phoenix-issued readiness classification based on the PBRS™ Standard. It is not a third-party certification, regulatory approval, government certification, or independent audit-firm attestation.';

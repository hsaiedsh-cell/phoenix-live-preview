// ============================================================
// @phoenix/core/contracts — PBRSScoreRecord, PBRSDimensionScore, DerivedSignalValue
// PHX-PLATFORM-002 — Backend Contract Definition
// ------------------------------------------------------------
// These types extend the existing PBRS v1.0 six-dimension model
// defined at the top level of @phoenix/core (PBRSDimensionKey,
// PBRSScore, PBRS_DIMENSIONS, gradeFromScore, tierFromGrade).
// They do NOT redefine the scoring model — they add the
// persistence/audit shape needed for a backend-scored assessment.
// See PBRS_SCORING_CONTRACT_PHX_PLATFORM_002.md for the full
// scoring contract.
// ============================================================

import type { PBRSDimensionKey, PBRSScore } from '../index';
import type { BaseRecord, UUID } from './common';
import type { RiskLevel } from './enums';

/**
 * PBRSDimensionScore
 * Purpose: A persisted, auditable record of a single dimension's score within
 * one assessment's scoring run — including which evidence justified it and
 * whether it was manually overridden. This is the row-level detail behind the
 * `dimensions` map on PBRSScore.
 */
export interface PBRSDimensionScore extends BaseRecord {
  scoreId: UUID;
  dimension: PBRSDimensionKey;
  /** 0–100. */
  value: number;
  /** Evidence items that justify this dimension's value. Must be non-empty if isOverridden is true. */
  evidenceIds: UUID[];
  isOverridden: boolean;
  /** Required when isOverridden is true — the reviewer's justification. */
  overrideReason?: string;
  overriddenByUserId?: UUID;
}

/**
 * DerivedSignalValue
 * Purpose: The computed value of one of the three derived signals (Risk
 * Level, Confidence Index, Automation Readiness) for a specific scoring run.
 * These are NEVER scored dimensions themselves — they are always calculated
 * from the six dimension scores. Metadata about the signals (label,
 * description) lives in @phoenix/core's `DERIVED_SIGNALS` constant; this type
 * is the per-assessment computed instance.
 */
export interface DerivedSignalValue extends BaseRecord {
  scoreId: UUID;
  key: 'riskLevel' | 'confidenceIndex' | 'automationReadiness';
  /** Risk Level: RiskLevel enum. Confidence Index / Automation Readiness: 0–1 decimal. */
  value: RiskLevel | number;
}

/**
 * PBRSScoreRecord
 * Purpose: The persisted, backend-owned wrapper around a scoring run —
 * links an Assessment to its resulting PBRSScore value object, its
 * per-dimension detail rows, and audit metadata. The `summary` field is the
 * exact PBRSScore shape already defined in @phoenix/core so the platform UI's
 * existing score-rendering components require no changes.
 * Lifecycle: see DATA_LIFECYCLE_PHX_PLATFORM_002.md and
 * PBRS_SCORING_CONTRACT_PHX_PLATFORM_002.md.
 */
export interface PBRSScoreRecord extends BaseRecord {
  assessmentId: UUID;
  /** Exact shape from @phoenix/core — overall, grade, tier, dimensions, confidenceIndex, riskLevel, automationReadiness. */
  summary: PBRSScore;
  /** Row-level detail per dimension, for audit and evidence traceability. */
  dimensionScores: PBRSDimensionScore[];
  /** Row-level detail for the three derived signals. */
  derivedSignals: DerivedSignalValue[];
  /** True if any dimension in this score was manually overridden after automated scoring. */
  hasOverrides: boolean;
  /** User/service that triggered the scoring run. Null if run by an automated pipeline. */
  scoredByUserId: UUID | null;
  /** Whether this run was produced by the automated engine or triggered manually via POST /score/run. */
  scoringMethod: 'Automated' | 'Manual';
}

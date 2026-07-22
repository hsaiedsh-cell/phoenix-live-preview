// ============================================================
// @phoenix/pbrs — PBRS Sample Data & Scoring Utilities
// ============================================================

import type { PBRSScore, PBRSDimensionKey } from '@phoenix/core';
import { gradeFromScore, tierFromScore, PBRS_DIMENSIONS } from '@phoenix/core';

// --- Sample Score for Demo/Preview ---

export const SAMPLE_PBRS_SCORE: PBRSScore = {
  overall: 87,
  grade: 'B+',
  tier: 'Gold',
  dimensions: {
    accuracy: 92,
    compliance: 88,
    brandAlignment: 85,
    structure: 90,
    consistency: 82,
    completeness: 84,
  },
  confidenceIndex: 0.91,
  riskLevel: 'Low',
  automationReadiness: 0.74,
};

// --- Scoring Utilities ---

export function calculateOverallScore(
  dimensions: Record<PBRSDimensionKey, number>
): number {
  let weighted = 0;
  for (const dim of PBRS_DIMENSIONS) {
    weighted += dimensions[dim.key] * dim.weight;
  }
  return Math.round(weighted * 100) / 100;
}

export function generateScore(
  dimensions: Record<PBRSDimensionKey, number>
): PBRSScore {
  const overall = calculateOverallScore(dimensions);
  const grade = gradeFromScore(overall);
  // PHX-CERT-003: tier is derived directly from the overall score via
  // tierFromScore(), not from the grade, so Bronze's floor (70) is
  // harmonized with certificationLevelFromScore()'s Foundation floor (70)
  // instead of inheriting gradeFromScore()'s C/C- boundary at 73. See
  // PHX_CERT_003_THRESHOLD_DECISION.md.
  const tier = tierFromScore(overall);

  const minDimScore = Math.min(...Object.values(dimensions));
  const riskLevel =
    minDimScore >= 80 ? 'Low' :
    minDimScore >= 60 ? 'Medium' :
    minDimScore >= 40 ? 'High' : 'Critical';

  const confidenceIndex = Math.min(0.99, overall / 100 + 0.05);
  const automationReadiness = overall >= 90 ? 0.85 : overall >= 80 ? 0.65 : overall >= 70 ? 0.40 : 0.15;

  return {
    overall,
    grade,
    tier,
    dimensions,
    confidenceIndex: Math.round(confidenceIndex * 100) / 100,
    riskLevel,
    automationReadiness,
  };
}

// --- Maturity Levels ---

export const PBRS_MATURITY_LEVELS = [
  {
    level: 1,
    name: 'Initial',
    description: 'AI outputs used ad-hoc with no standardized review process.',
    scoreRange: '0–59',
  },
  {
    level: 2,
    name: 'Developing',
    description: 'Basic review processes in place. Quality varies across teams.',
    scoreRange: '60–69',
  },
  {
    level: 3,
    name: 'Defined',
    description: 'Standardized assessment criteria established. Consistent scoring applied.',
    scoreRange: '70–79',
  },
  {
    level: 4,
    name: 'Managed',
    description: 'Automated validation integrated into workflows. Continuous monitoring active.',
    scoreRange: '80–89',
  },
  {
    level: 5,
    name: 'Optimized',
    description: 'Full enterprise governance. Predictive quality assurance. Auto-certification enabled.',
    scoreRange: '90–100',
  },
] as const;

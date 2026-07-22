// ============================================================
// Phoenix Platform — Sample Data (Alpha / UI Preview)
// ------------------------------------------------------------
// All records below are illustrative sample data for the
// Platform Alpha UI. Nothing here represents a real customer,
// a real assessment run, or a live scoring result.
//
// Dimension scores are hand-authored for narrative variety;
// the overall score, grade, tier, confidence index, and risk
// level are all derived from the real @phoenix/pbrs scoring
// logic (generateScore) so the six-dimension PBRS model stays
// the single source of truth — no scoring logic is duplicated
// here.
//
// This file is mock source data for the local Platform Alpha.
// UI pages should consume data through api-client.ts, not
// directly from this file.
// ============================================================

import type { PBRSDimensionKey, PBRSScore } from '@phoenix/core';
import { generateScore } from '@phoenix/pbrs';

export type AssetStatus =
  | 'Draft'
  | 'In Review'
  | 'Business Ready'
  | 'Certified'
  | 'Needs Improvement';

export type SimpleGrade = 'A' | 'B' | 'C' | 'Hold';

export interface PhoenixAsset {
  id: string;
  name: string;
  type: string;
  owner: string;
  department: string;
  status: AssetStatus;
  lastAssessed: string;
  score: PBRSScore;
  simpleGrade: SimpleGrade;
}

/** Collapse the granular PBRS letter grade into the platform's simplified 4-tier badge. */
export function toSimpleGrade(grade: PBRSScore['grade']): SimpleGrade {
  if (grade.startsWith('A')) return 'A';
  if (grade.startsWith('B')) return 'B';
  if (grade.startsWith('C')) return 'C';
  return 'Hold';
}

function score(dimensions: Record<PBRSDimensionKey, number>): PBRSScore {
  return generateScore(dimensions);
}

const rawAssets: Array<Omit<PhoenixAsset, 'score' | 'simpleGrade'> & { dimensions: Record<PBRSDimensionKey, number> }> = [
  {
    id: 'ast-001',
    name: 'Executive AI Brief',
    type: 'Executive Briefing',
    owner: 'S. Al-Farsi',
    department: 'Executive Offices',
    status: 'Certified',
    lastAssessed: '2026-06-28',
    dimensions: {
      accuracy: 96,
      compliance: 94,
      brandAlignment: 91,
      structure: 93,
      consistency: 90,
      completeness: 92,
    },
  },
  {
    id: 'ast-002',
    name: 'HR Policy Summary',
    type: 'Policy Document',
    owner: 'M. Khoury',
    department: 'Human Resources',
    status: 'Business Ready',
    lastAssessed: '2026-06-25',
    dimensions: {
      accuracy: 89,
      compliance: 90,
      brandAlignment: 82,
      structure: 87,
      consistency: 85,
      completeness: 86,
    },
  },
  {
    id: 'ast-003',
    name: 'Board Report Draft',
    type: 'Board Report',
    owner: 'S. Al-Farsi',
    department: 'Executive Offices',
    status: 'In Review',
    lastAssessed: '2026-07-01',
    dimensions: {
      accuracy: 84,
      compliance: 81,
      brandAlignment: 79,
      structure: 83,
      consistency: 78,
      completeness: 80,
    },
  },
  {
    id: 'ast-004',
    name: 'Sustainability Claims Review',
    type: 'Compliance Review',
    owner: 'R. Haddad',
    department: 'Risk & Compliance',
    status: 'Needs Improvement',
    lastAssessed: '2026-06-30',
    dimensions: {
      accuracy: 71,
      compliance: 62,
      brandAlignment: 74,
      structure: 76,
      consistency: 68,
      completeness: 65,
    },
  },
  {
    id: 'ast-005',
    name: 'Marketing Campaign Copy',
    type: 'Marketing Asset',
    owner: 'L. Nasser',
    department: 'Marketing',
    status: 'Business Ready',
    lastAssessed: '2026-06-27',
    dimensions: {
      accuracy: 88,
      compliance: 85,
      brandAlignment: 93,
      structure: 86,
      consistency: 89,
      completeness: 84,
    },
  },
  {
    id: 'ast-006',
    name: 'Legal Risk Memo',
    type: 'Legal Memo',
    owner: 'T. Rahim',
    department: 'Legal',
    status: 'Draft',
    lastAssessed: '2026-07-03',
    dimensions: {
      accuracy: 80,
      compliance: 88,
      brandAlignment: 70,
      structure: 82,
      consistency: 77,
      completeness: 79,
    },
  },
];

export const SAMPLE_ASSETS: PhoenixAsset[] = rawAssets.map((a) => {
  const s = score(a.dimensions);
  return { ...a, score: s, simpleGrade: toSimpleGrade(s.grade) };
});

// --- Passports ---

export interface PhoenixPassport {
  id: string;
  passportId: string;
  assetName: string;
  score: number;
  grade: SimpleGrade;
  certificationStatus: 'Certified' | 'Pending Certification' | 'Not Certified';
  validUntil: string;
  recordHash: string;
}

export const SAMPLE_PASSPORTS: PhoenixPassport[] = SAMPLE_ASSETS
  .filter((a) => a.status === 'Certified' || a.status === 'Business Ready')
  .map((a, i) => ({
    id: `psp-${String(i + 1).padStart(3, '0')}`,
    passportId: `PBRS-ACME-2026-${String(i + 1).padStart(4, '0')}-${a.score.tier === 'Platinum' ? 'PT' : a.score.tier === 'Gold' ? 'GD' : a.score.tier === 'Silver' ? 'SV' : 'BZ'}`,
    assetName: a.name,
    score: a.score.overall,
    grade: a.simpleGrade,
    certificationStatus: a.status === 'Certified' ? 'Certified' : 'Pending Certification',
    validUntil: '2027-06-30',
    recordHash: `0x${a.id.replace('ast-', '').padStart(4, '0')}…sample`,
  }));

// --- Certifications ---

export const CERTIFICATION_LEVELS = [
  {
    id: 'foundation',
    name: 'PBRS Foundation',
    description: 'Baseline readiness — asset meets minimum accuracy, compliance, and structural standards.',
    minScore: 70,
  },
  {
    id: 'practitioner',
    name: 'PBRS Practitioner',
    description: 'Consistent, repeatable readiness across all six PBRS dimensions.',
    minScore: 83,
  },
  {
    id: 'enterprise',
    name: 'PBRS Enterprise',
    description: 'Highest tier — board- and audit-ready output with sustained governance evidence.',
    minScore: 92,
  },
] as const;

export const CERTIFIED_ASSETS = SAMPLE_ASSETS.filter((a) => a.status === 'Certified');
export const ELIGIBLE_ASSETS = SAMPLE_ASSETS.filter(
  (a) => a.status === 'Business Ready' && a.score.overall >= 83
);
export const EXPIRING_SOON = SAMPLE_PASSPORTS.slice(0, 1);

// --- Reports ---

export interface PhoenixReport {
  id: string;
  name: string;
  description: string;
  status: 'Available' | 'Coming Soon';
  generatedDate: string;
}

export const SAMPLE_REPORTS: PhoenixReport[] = [
  {
    id: 'rpt-executive-summary',
    name: 'Executive Readiness Summary',
    description: 'A one-page rollup of overall readiness, certified assets, and open risk across the workspace.',
    status: 'Available',
    generatedDate: '2026-07-05',
  },
  {
    id: 'rpt-pbrs-assessment',
    name: 'PBRS Assessment Report',
    description: 'Full six-dimension scoring detail for a selected asset, including evidence notes.',
    status: 'Available',
    generatedDate: '2026-07-04',
  },
  {
    id: 'rpt-risk-confidence',
    name: 'Risk & Confidence Report',
    description: 'Aggregated risk levels and confidence index trends across all assessed assets.',
    status: 'Coming Soon',
    generatedDate: '—',
  },
  {
    id: 'rpt-passport-export',
    name: 'Passport Export',
    description: 'Exportable record of PBRS Passport data for audit or procurement handoff.',
    status: 'Coming Soon',
    generatedDate: '—',
  },
  {
    id: 'rpt-certification-summary',
    name: 'Certification Summary',
    description: 'Snapshot of certified, eligible, and expiring assets by certification level.',
    status: 'Coming Soon',
    generatedDate: '—',
  },
];

// --- Dashboard summary ---

export const WORKSPACE_NAME = 'Acme Enterprise Workspace';

export function averageOverallScore(): number {
  const total = SAMPLE_ASSETS.reduce((sum, a) => sum + a.score.overall, 0);
  return Math.round((total / SAMPLE_ASSETS.length) * 10) / 10;
}

export function averageConfidenceIndex(): number {
  const total = SAMPLE_ASSETS.reduce((sum, a) => sum + a.score.confidenceIndex, 0);
  return Math.round((total / SAMPLE_ASSETS.length) * 100);
}

export function openRiskCount(): number {
  return SAMPLE_ASSETS.filter((a) => a.score.riskLevel === 'Medium' || a.score.riskLevel === 'High' || a.score.riskLevel === 'Critical').length;
}

export function certifiedCount(): number {
  return SAMPLE_ASSETS.filter((a) => a.status === 'Certified').length;
}

/** Average score per PBRS dimension across all sample assets — used for the dashboard dimension overview. */
export function averageDimensionScores(): Record<PBRSDimensionKey, number> {
  const keys: PBRSDimensionKey[] = ['accuracy', 'compliance', 'brandAlignment', 'structure', 'consistency', 'completeness'];
  const result = {} as Record<PBRSDimensionKey, number>;
  for (const key of keys) {
    const total = SAMPLE_ASSETS.reduce((sum, a) => sum + a.score.dimensions[key], 0);
    result[key] = Math.round(total / SAMPLE_ASSETS.length);
  }
  return result;
}

/** Static readiness trend placeholder — illustrative, not a real time series. */
export const READINESS_TREND = [72, 75, 74, 79, 81, 83, 85, averageOverallScore()];

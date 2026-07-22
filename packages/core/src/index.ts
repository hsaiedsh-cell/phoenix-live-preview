// ============================================================
// @phoenix/core — Domain Types & Constants
// Phoenix Business Readiness Platform
// ============================================================

// --- PBRS Dimensions (v1.0 — six dimensions) ---

export type PBRSDimensionKey =
  | 'accuracy'
  | 'compliance'
  | 'brandAlignment'
  | 'structure'
  | 'consistency'
  | 'completeness';

export interface PBRSDimension {
  key: PBRSDimensionKey;
  label: string;
  description: string;
  weight: number;
}

export const PBRS_DIMENSIONS: PBRSDimension[] = [
  {
    key: 'accuracy',
    label: 'Accuracy',
    description: 'Factual correctness and data integrity of AI-generated content.',
    weight: 0.20,
  },
  {
    key: 'compliance',
    label: 'Compliance',
    description: 'Adherence to regulatory, legal, and organizational policy requirements.',
    weight: 0.20,
  },
  {
    key: 'brandAlignment',
    label: 'Brand Alignment',
    description: 'Consistency with enterprise voice, tone, and brand guidelines.',
    weight: 0.15,
  },
  {
    key: 'structure',
    label: 'Structure',
    description: 'Logical organization, formatting, and information architecture.',
    weight: 0.15,
  },
  {
    key: 'consistency',
    label: 'Consistency',
    description: 'Uniformity across outputs, terminology, and cross-document coherence.',
    weight: 0.15,
  },
  {
    key: 'completeness',
    label: 'Completeness',
    description: 'Coverage of required elements, sections, and operational fit.',
    weight: 0.15,
  },
];

// --- Derived Signals ---

export interface DerivedSignal {
  key: string;
  label: string;
  description: string;
}

export const DERIVED_SIGNALS: DerivedSignal[] = [
  {
    key: 'riskLevel',
    label: 'Risk Level',
    description: 'Aggregate risk assessment based on compliance and accuracy gaps.',
  },
  {
    key: 'confidenceIndex',
    label: 'Confidence Index',
    description: 'Statistical confidence in the overall readiness score.',
  },
  {
    key: 'automationReadiness',
    label: 'Automation Readiness',
    description: 'Degree to which the output can be auto-approved without human review.',
  },
];

// --- PBRS Score Types ---

export type PBRSGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';

export type CertificationTier = 'Platinum' | 'Gold' | 'Silver' | 'Bronze' | 'Not Certified';

export interface PBRSScore {
  overall: number;
  grade: PBRSGrade;
  tier: CertificationTier;
  dimensions: Record<PBRSDimensionKey, number>;
  confidenceIndex: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  automationReadiness: number;
}

export interface PBRSCertification {
  id: string; // PBRS-[ORG]-[YEAR]-[SEQ]-[LEVEL]
  organization: string;
  tier: CertificationTier;
  issuedDate: string;
  expiryDate: string;
  score: PBRSScore;
}

// --- Grade / Tier Mapping ---

export function gradeFromScore(score: number): PBRSGrade {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * @deprecated Since PHX-CERT-003, `PBRSScore.tier` is derived directly from
 * the overall score via `tierFromScore()`, not from this function. Retained
 * for backward compatibility (it is a pure function with no other call
 * sites in this codebase) and because it still correctly documents the
 * PBRSGrade → CertificationTier mapping for grades C+ and above. Do not
 * wire this back into `generateScore()`: it reintroduces the resolved
 * 70–72 Certification Level / Internal Tier gap (grade C- covers 70–72 and
 * mapped to 'Not Certified' here, one full letter grade below Bronze's
 * former C/C+ floor of 73). See
 * `PBRS_CERTIFICATION_THRESHOLD_ADDENDUM_PHX_CERT_003.md`.
 */
export function tierFromGrade(grade: PBRSGrade): CertificationTier {
  if (grade === 'A+' || grade === 'A') return 'Platinum';
  if (grade === 'A-' || grade === 'B+') return 'Gold';
  if (grade === 'B' || grade === 'B-') return 'Silver';
  if (grade === 'C+' || grade === 'C') return 'Bronze';
  return 'Not Certified';
}

/**
 * Derives the PBRS Internal Tier directly from the overall score (0–100).
 * This is the system of record for `PBRSScore.tier` as of PHX-CERT-003.
 *
 * Thresholds (Silver/Gold/Platinum unchanged from the original
 * `tierFromGrade()` mapping; Bronze's floor lowered from 73 to 70 to
 * harmonize with `certificationLevelFromScore()`'s Foundation floor — see
 * `PHX_CERT_003_THRESHOLD_DECISION.md`):
 *
 *   score >= 93 → Platinum
 *   score >= 87 → Gold
 *   score >= 80 → Silver
 *   score >= 70 → Bronze
 *   otherwise   → Not Certified
 *
 * Does not read or alter any dimension score, weight, or the six-dimension
 * model — operates purely on the already-computed `overall` value.
 * `gradeFromScore()` and the PBRSGrade scale are unchanged by this function
 * and continue to be used for the assessment-facing A/B/C/Hold readiness
 * grade; this function governs Internal Tier derivation only.
 */
export function tierFromScore(score: number): CertificationTier {
  if (score >= 93) return 'Platinum';
  if (score >= 87) return 'Gold';
  if (score >= 80) return 'Silver';
  if (score >= 70) return 'Bronze';
  return 'Not Certified';
}

// --- Products ---

export interface PhoenixProduct {
  id: string;
  name: string;
  tagline: string;
  problem: string;
  description: string;
  audience: string;
  value: string;
}

export const PHOENIX_PRODUCTS: PhoenixProduct[] = [
  {
    id: 'pbrs-engine',
    name: 'PBRS™ Engine',
    tagline: 'The scoring backbone.',
    problem: 'AI outputs are reviewed inconsistently, with no shared basis for comparing readiness across teams.',
    description: 'Real-time evaluation of AI outputs against the six PBRS dimensions. Generates readiness scores, risk signals, and certification recommendations.',
    audience: 'AI Governance Teams, Enterprise Architects',
    value: 'Standardized, repeatable assessment of every AI output before it enters business workflows.',
  },
  {
    id: 'phoenix-readiness',
    name: 'Phoenix Readiness™',
    tagline: 'Assess before you deploy.',
    problem: 'Organizations lack visibility into how ready their AI outputs and workflows actually are before rollout.',
    description: 'Comprehensive readiness assessment for AI outputs, workflows, and enterprise systems. Maps current state to target maturity.',
    audience: 'Chief AI Officers, Digital Transformation Leaders',
    value: 'Clear visibility into what is ready, what is not, and what needs to change.',
  },
  {
    id: 'phoenix-verify',
    name: 'Phoenix Verify™',
    tagline: 'Validate with confidence.',
    problem: 'Manual compliance checks on AI-generated content are slow, inconsistent, and hard to audit.',
    description: 'Automated validation and compliance checking of AI-generated content, data, and deliverables against enterprise standards.',
    audience: 'Internal Audit, Risk & Compliance Teams',
    value: 'Continuous compliance assurance with auditable evidence trails.',
  },
  {
    id: 'phoenix-studio',
    name: 'Phoenix Studio™',
    tagline: 'Transform and finalize.',
    problem: 'Raw AI output rarely arrives in a state that is ready to publish, ship, or present.',
    description: 'Intelligent workspace for enhancing, restructuring, and finalizing AI outputs into business-ready assets.',
    audience: 'Content Teams, Enterprise Authors',
    value: 'Bridge the gap between raw AI output and polished enterprise deliverable.',
  },
];

// --- Solutions ---

export interface PhoenixSolution {
  id: string;
  function: string;
  problem: string;
  solution: string;
  outcome: string;
}

export const PHOENIX_SOLUTIONS: PhoenixSolution[] = [
  {
    id: 'corporate-comms',
    function: 'Corporate Communications',
    problem: 'AI-drafted press releases and reports often miss brand voice or contain factual and regulatory gaps.',
    solution: 'Phoenix scores every communication for brand alignment, compliance, and accuracy before distribution.',
    outcome: 'Every external communication meets brand, regulatory, and accuracy standards.',
  },
  {
    id: 'marketing',
    function: 'Marketing',
    problem: 'AI-generated campaign content varies in quality, tone, and compliance across channels and markets.',
    solution: 'Phoenix validates marketing assets for brand consistency, compliance, and messaging coherence.',
    outcome: 'Consistent, compliant, on-brand assets that scale without sacrificing quality.',
  },
  {
    id: 'hr',
    function: 'Human Resources',
    problem: 'AI-generated job descriptions and policies risk bias, legal exposure, and inconsistent terminology.',
    solution: 'Phoenix screens HR outputs for compliance, bias indicators, and organizational consistency.',
    outcome: 'HR deliverables that are legally sound, bias-aware, and on standard.',
  },
  {
    id: 'legal',
    function: 'Legal',
    problem: 'AI-assisted contracts and legal summaries require heavy manual review for accuracy and compliance.',
    solution: 'Phoenix validates legal outputs against compliance, structural, and accuracy benchmarks.',
    outcome: 'Shorter review cycles with structured quality assurance built in.',
  },
  {
    id: 'risk-compliance',
    function: 'Risk & Compliance',
    problem: 'AI outputs in regulated workflows often lack audit trails and governance documentation.',
    solution: 'Phoenix provides end-to-end audit trails and certification records for every output.',
    outcome: 'Auditable, governed AI usage with complete evidence trails.',
  },
  {
    id: 'executive',
    function: 'Executive Offices',
    problem: 'Board materials and briefings drafted with AI often lack leadership-level precision and consistency.',
    solution: 'Phoenix applies its highest readiness standards to executive-level outputs.',
    outcome: 'Board-ready, investor-grade deliverables with certified quality.',
  },
];

// --- Principles ---

export const PHOENIX_PRINCIPLES = [
  { label: 'Evidence Before Opinion', description: 'Every assessment is grounded in measurable criteria, not subjective judgment.' },
  { label: 'Structure Before Scale', description: 'Build the right framework first. Scale follows structure.' },
  { label: 'Trust Before Automation', description: 'Automation without trust is just faster failure.' },
  { label: 'Enterprise Before Trend', description: 'We solve enterprise problems, not chase industry hype.' },
  { label: 'Build Once. Reuse Forever.', description: 'Standards, frameworks, and components designed for long-term institutional value.' },
  { label: 'Every Deliverable Becomes an Asset.', description: 'Nothing is throwaway. Every output is designed to compound.' },
] as const;

// --- Normative References ---

export const NORMATIVE_REFERENCES = [
  'ISO/IEC 42001:2023',
  'NIST AI RMF 1.0',
  'EU AI Act 2024/1689',
  'ISO 9001:2015',
  'ISO/IEC 27001:2022',
] as const;

// --- Certification ID Format ---

export function formatCertificationId(
  org: string,
  year: number,
  sequence: number,
  tier: CertificationTier
): string {
  const tierCode = tier === 'Platinum' ? 'PT' : tier === 'Gold' ? 'GD' : tier === 'Silver' ? 'SV' : 'BZ';
  return `PBRS-${org.toUpperCase()}-${year}-${String(sequence).padStart(4, '0')}-${tierCode}`;
}

// ============================================================
// Backend Contracts (PHX-PLATFORM-002)
// ------------------------------------------------------------
// Domain/API/database contract types for Phoenix Platform's
// future backend. These are TYPE-ONLY definitions — no backend,
// database, or auth implementation. See:
//   /docs/platform/API_CONTRACT_PHX_PLATFORM_002.md
//   /docs/platform/DATABASE_SCHEMA_PHX_PLATFORM_002.md
//   /docs/platform/DATA_LIFECYCLE_PHX_PLATFORM_002.md
//   /docs/platform/PBRS_SCORING_CONTRACT_PHX_PLATFORM_002.md
//   /docs/platform/PERMISSIONS_MODEL_PHX_PLATFORM_002.md
// ============================================================

export * from './contracts';

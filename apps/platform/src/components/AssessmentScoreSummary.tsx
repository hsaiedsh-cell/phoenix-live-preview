import React from 'react';
import type { PBRSScore } from '@phoenix/core';
import { PBRSScorePanel } from './PBRSScorePanel';

interface AssessmentScoreSummaryProps {
  score: PBRSScore;
}

/**
 * Assessment detail's score summary section — overall score, grade, risk,
 * confidence, automation readiness, and the six-dimension breakdown. Reuses
 * the existing PBRSScorePanel/PBRSScorePreview rather than duplicating any
 * PBRS rendering or scoring logic.
 */
export function AssessmentScoreSummary({ score }: AssessmentScoreSummaryProps) {
  return <PBRSScorePanel score={score} title="PBRS Score Summary" />;
}

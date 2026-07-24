export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { AssessmentHeader } from '@/components/AssessmentHeader';
import { AssessmentScoreSummary } from '@/components/AssessmentScoreSummary';
import { DimensionEvidencePanel } from '@/components/DimensionEvidencePanel';
import { EvidenceLibrary } from '@/components/EvidenceLibrary';
import { LiveScorePanel } from '@/components/LiveScorePanel';
import { LiveEvidenceList } from '@/components/LiveEvidenceList';
import { LiveDataBadge, renderDataStatePanel } from '@/components/DataStatePanel';
import { AuditTrailPreview } from '@/components/AuditTrailPreview';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { LiveActivityList, LiveAuditList } from '@/components/LiveActivityAuditLists';
import { AlphaNotice } from '@/components/AlphaNotice';
import { RoleGate } from '@/components/RoleGate';
import { RestrictedNote } from '@/components/RestrictedNote';
import { AssessmentGovernanceActions } from '@/components/AssessmentGovernanceActions';
import { IconArrowLeft } from '@/components/Icons';
import { getAssessmentDetail, getCurrentWorkspace, getPassports } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';
import { loadAssessmentDetailData } from '@/lib/platform-data-source';

interface AssessmentDetailPageProps {
  params: Promise<{ assessmentId: string }>;
}

export default async function AssessmentDetailPage({ params }: AssessmentDetailPageProps) {
  const { assessmentId } = await params;
  const apiConfig = getPhoenixApiConfig();
  const workspace = await getCurrentWorkspace();

  if (apiConfig.mode === 'mock') {
    const [detailResult, { items: passportItems }] = await Promise.all([
      getAssessmentDetail(assessmentId),
      getPassports(),
    ]);

    if (!detailResult) {
      notFound();
    }

    const {
      asset,
      score,
      evidenceItems,
      ownerName,
      statusLabel,
      simpleGrade,
      activityItems,
      auditRecords,
      eligibleCertificationLabel,
      eligibleCertificationLevel,
    } = detailResult.data;

    const existingPassport = passportItems.find((p) => p.asset.id === asset.id);

    return (
      <div>
        <Link
          href="/assessments"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-phx-navy mb-4 transition-colors"
        >
          <IconArrowLeft width={14} height={14} />
          Back to Assessments
        </Link>

        <WorkspaceHeader
          eyebrow={workspace.data.name}
          title="Assessment Detail"
          description="Full PBRS scoring detail, evidence traceability, and audit history for this assessment. Sample data — Platform Alpha."
        />

        <div className="mb-6">
          <AlphaNotice>
            This assessment detail is shown using mock data. Evidence traceability is representative and not
            connected to a live backend yet.
          </AlphaNotice>
        </div>

        <AssessmentHeader
          asset={asset}
          statusLabel={statusLabel}
          simpleGrade={simpleGrade}
          riskLabel={score.summary.riskLevel}
          overallScore={score.summary.overall}
          confidenceIndex={score.summary.confidenceIndex}
          ownerName={ownerName}
          eligibilityLabel={eligibleCertificationLabel}
        />

        <div className="mb-8">
          <AssessmentScoreSummary score={score.summary} />
        </div>

        <AssessmentGovernanceActions
          assessmentId={assessmentId}
          assetName={asset.name}
          statusLabel={statusLabel}
          eligibleCertificationLevel={eligibleCertificationLevel}
          existingPassportId={existingPassport?.passport.passportId}
        />

        <div className="mb-8">
          <h2 className="text-base font-bold text-phx-navy mb-4">Dimension Evidence Traceability</h2>
          <DimensionEvidencePanel dimensionScores={score.dimensionScores} evidenceItems={evidenceItems} />
        </div>

        <div className="mb-8">
          <h2 className="text-base font-bold text-phx-navy mb-4">Evidence Library</h2>
          <EvidenceLibrary items={evidenceItems} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h2 className="text-base font-bold text-phx-navy mb-4">Audit Trail Preview</h2>
            {/* PHX-PLATFORM-006 — full audit trail is Owner/Admin/Auditor only
                per PERMISSIONS_MODEL_PHX_PLATFORM_002.md "Audit Logs" section.
                Data is unchanged; only visibility is gated. */}
            <RoleGate permission="canViewAuditTrail" fallback={<RestrictedNote permission="canViewAuditTrail" />}>
              <AuditTrailPreview records={auditRecords} />
            </RoleGate>
          </div>
          <div>
            <h2 className="text-base font-bold text-phx-navy mb-4">Activity Timeline</h2>
            <ActivityTimeline items={activityItems} />
          </div>
        </div>
      </div>
    );
  }

  // real-dev / production-auth / real-disabled.
  const result = await loadAssessmentDetailData(assessmentId);

  if (result.status === 'not-found') {
    notFound();
  }

  return (
    <div>
      <Link
        href="/assessments"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-phx-navy mb-4 transition-colors"
      >
        <IconArrowLeft width={14} height={14} />
        Back to Assessments
      </Link>

      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="Assessment Detail"
        description="Live PBRS scoring detail and evidence for this assessment."
      />

      {result.status === 'live' && result.data ? (
        <>
          <div className="mb-6">
            <LiveDataBadge />
          </div>

          <div className="mb-4">
            {/* PHX-PLATFORM-011-R1: fixed — there is no `assessment.title`
                field on the live backend; the closest display name is the
                associated asset's name (see BackendAssessmentAssetSummary
                in real-api-client.ts). PHX-PLATFORM-011 had assumed a
                title field existed on the raw SQL-column-aliased shape it
                incorrectly used for BackendAssessmentDetail. */}
            <p className="text-lg font-bold text-phx-navy">{result.data.detail.asset.name}</p>
            <p className="text-sm text-gray-500">
              Status: {result.data.detail.assessment.status} · Asset type: {result.data.detail.asset.type}
            </p>
          </div>

          <div className="mb-8">
            <LiveScorePanel score={result.data.score} />
          </div>

          <div className="mb-8">
            <h2 className="text-base font-bold text-phx-navy mb-4">Evidence</h2>
            <LiveEvidenceList items={result.data.evidence} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h2 className="text-base font-bold text-phx-navy mb-4">Audit Trail</h2>
              {/* PHX-BACKEND-009B: assessment-scoped audit requires
                  audit.read (Owner/Admin/Auditor only). A 403 here is
                  isolated by loadAssessmentDetailData() — it never
                  prevents Assessment/Score/Evidence/Activity above from
                  rendering; only this section falls back to a
                  RestrictedNote. */}
              {result.data.auditAccess === 'restricted' ? (
                <RestrictedNote permission="canViewAuditTrail" />
              ) : (
                <LiveAuditList items={result.data.auditRecords} />
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-phx-navy mb-4">Activity Timeline</h2>
              <LiveActivityList items={result.data.activity} />
            </div>
          </div>
        </>
      ) : (
        renderDataStatePanel(
          result.status as 'auth-required' | 'config-missing' | 'backend-unavailable' | 'permission-denied' | 'not-wired',
          result.message
        )
      )}
    </div>
  );
}

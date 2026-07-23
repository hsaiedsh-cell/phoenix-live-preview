export const dynamic = 'force-dynamic';

import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { CertificationCard } from '@/components/CertificationCard';
import { AssessmentTable } from '@/components/AssessmentTable';
import { LiveCertificationsTable } from '@/components/LiveCertificationsTable';
import { AlphaNotice } from '@/components/AlphaNotice';
import { StatCard } from '@/components/StatCard';
import { CertificationGovernancePanel } from '@/components/CertificationGovernancePanel';
import { PreviewOnlyNotice, LiveDataBadge, renderDataStatePanel } from '@/components/DataStatePanel';
import { IconAward, IconShieldBadge, IconClipboard } from '@/components/Icons';
import { getCertifications, getPassports, getCurrentWorkspace, PBRS_CERTIFICATION_SAFE_DISCLAIMER } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';
import { loadCertificationsListData } from '@/lib/platform-data-source';

// PHX-CERTIFICATIONS-001 note on the live/preview-only split for this page:
// only the certifications LIST is live in vercel-supabase-preview mode.
// Granting, revocation, and public verification remain preview-only in
// every mode, including vercel-supabase-preview — see
// LiveCertificationsTable.tsx's header comment. mock / real-dev /
// real-disabled / production-auth are all unchanged from before this
// sprint: apps/backend/src/routes/certifications.ts is still a
// PHX-BACKEND-001 stub (every route 501s), so those modes have no live
// certifications data source to read from yet. Exact same architectural
// pattern as PHX-PASSPORTS-001's passports/page.tsx.
export default async function CertificationsPage() {
  const apiConfig = getPhoenixApiConfig();
  const workspace = await getCurrentWorkspace();

  if (apiConfig.mode !== 'vercel-supabase-preview') {
    const [certifications, { items: passportItems }] = await Promise.all([getCertifications(), getPassports()]);
    const { levels, certifiedItems, eligibleItems, expiringSoon } = certifications;

    // PHX-PLATFORM-007 — Grant Certification always references a specific
    // issued passport (see api-client.ts's grantCertification()), so eligible
    // assets are matched back to their passport id here, server-side, rather
    // than duplicating passport-lookup logic in the client governance panel.
    const passportIdByAssetId: Record<string, string> = {};
    for (const p of passportItems) {
      passportIdByAssetId[p.asset.id] = p.passport.passportId;
    }

    return (
      <div>
        <WorkspaceHeader
          eyebrow={workspace.data.name}
          title="Certifications"
          description="Phoenix-issued readiness certification levels, and which assets currently qualify."
        />

        {/* No live certifications endpoint exists yet for this mode; this
            page remains mock-backed, as it was before PHX-CERTIFICATIONS-001. */}
        {apiConfig.mode !== 'mock' && <PreviewOnlyNotice />}

        <div className="mb-8">
          <AlphaNotice>
            Certification workflows are shown for platform preview purposes only. {PBRS_CERTIFICATION_SAFE_DISCLAIMER}
          </AlphaNotice>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          <StatCard label="Certified Assets" value={String(certifiedItems.length)} icon={<IconShieldBadge />} />
          <StatCard label="Eligible Assets" value={String(eligibleItems.length)} icon={<IconClipboard />} />
          <StatCard label="Expiring Soon" value={String(expiringSoon.length)} icon={<IconAward />} />
        </div>

        <h2 className="text-base font-bold text-phx-navy mb-4">Certification Levels</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
          {levels.map((level) => (
            <CertificationCard
              key={level.id}
              name={level.name}
              description={level.description}
              minScore={level.minScore}
              assetCount={
                level.id === 'enterprise'
                  ? certifiedItems.length
                  : level.id === 'practitioner'
                    ? eligibleItems.length
                    : certifiedItems.length + eligibleItems.length
              }
            />
          ))}
        </div>

        <h2 className="text-base font-bold text-phx-navy mb-4">Certified Assets</h2>
        {certifiedItems.length > 0 ? (
          <AssessmentTable items={certifiedItems} compact />
        ) : (
          <p className="text-sm text-gray-500">No assets are currently certified.</p>
        )}

        <div className="mt-10">
          <CertificationGovernancePanel
            eligibleItems={eligibleItems}
            passportIdByAssetId={passportIdByAssetId}
            certifiedItems={certifiedItems}
          />
        </div>
      </div>
    );
  }

  // vercel-supabase-preview — live certifications list, read directly from
  // Supabase/Postgres. See lib/preview-api-client.server.ts's
  // previewGetCertifications() and platform-data-source.ts's
  // loadCertificationsListData().
  //
  // "Eligible Assets" / "Expiring Soon" stat cards, per-level asset counts
  // on the Certification Level cards, and the certification-granting
  // governance panel are all omitted in this mode — each depends on data
  // this sprint does not migrate (assessment-score-threshold matching
  // across the whole workspace for eligibility; granting is a write
  // action, preview-only per this sprint's brief). Showing a fabricated 0
  // for an unmigrated aggregate would misrepresent an unknown value as a
  // known one.
  const result = await loadCertificationsListData();
  const { levels } = await getCertifications();

  return (
    <div>
      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="Certifications"
        description="Certifications granted in this workspace's live backend."
      />

      <div className="mb-8">
        <AlphaNotice>{PBRS_CERTIFICATION_SAFE_DISCLAIMER}</AlphaNotice>
      </div>

      <h2 className="text-base font-bold text-phx-navy mb-4">Certification Levels</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-10">
        {levels.map((level) => (
          <CertificationCard key={level.id} name={level.name} description={level.description} minScore={level.minScore} />
        ))}
      </div>

      <h2 className="text-base font-bold text-phx-navy mb-4">Certified Assets</h2>

      {result.status === 'live' && result.data ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <LiveDataBadge />
            <span className="text-xs text-gray-400">{result.data.total} total</span>
          </div>
          <LiveCertificationsTable items={result.data.items} />
        </>
      ) : result.status !== 'mock' ? (
        renderDataStatePanel(
          result.status as 'auth-required' | 'config-missing' | 'backend-unavailable' | 'permission-denied' | 'not-found' | 'not-wired',
          result.message
        )
      ) : null}
    </div>
  );
}

export const dynamic = 'force-dynamic';

import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { CertificationCard } from '@/components/CertificationCard';
import { AssessmentTable } from '@/components/AssessmentTable';
import { AlphaNotice } from '@/components/AlphaNotice';
import { StatCard } from '@/components/StatCard';
import { CertificationGovernancePanel } from '@/components/CertificationGovernancePanel';
import { PreviewOnlyNotice } from '@/components/DataStatePanel';
import { IconAward, IconShieldBadge, IconClipboard } from '@/components/Icons';
import { getCertifications, getPassports, getCurrentWorkspace, PBRS_CERTIFICATION_SAFE_DISCLAIMER } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';

export default async function CertificationsPage() {
  const [certifications, { items: passportItems }, workspace] = await Promise.all([
    getCertifications(),
    getPassports(),
    getCurrentWorkspace(),
  ]);
  const apiConfig = getPhoenixApiConfig();
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

      {/* PHX-PLATFORM-011 — no live certification endpoint exists yet;
          this page remains mock-backed in every mode, per Task 1. */}
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

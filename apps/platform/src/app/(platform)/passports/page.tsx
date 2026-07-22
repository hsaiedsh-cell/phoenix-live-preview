import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { PassportCard } from '@/components/PassportCard';
import { EmptyState } from '@/components/EmptyState';
import { AlphaNotice } from '@/components/AlphaNotice';
import { PreviewOnlyNotice } from '@/components/DataStatePanel';
import { IconShieldBadge } from '@/components/Icons';
import { getPassports, getCurrentWorkspace, PBRS_CERTIFICATION_SAFE_DISCLAIMER } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';

export default async function PassportsPage() {
  const [{ items }, workspace] = await Promise.all([getPassports(), getCurrentWorkspace()]);
  const apiConfig = getPhoenixApiConfig();

  return (
    <div>
      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="PBRS Passports"
        description="Portable readiness records for assessed assets — score, grade, certification level, and validity in one place."
      />

      {/* PHX-PLATFORM-011 — no live passport endpoint exists yet; this
          page remains mock-backed in every mode, per Task 1. */}
      {apiConfig.mode !== 'mock' && <PreviewOnlyNotice />}

      {items.length > 0 && (
        <div className="mb-6">
          <AlphaNotice variant="inline">{PBRS_CERTIFICATION_SAFE_DISCLAIMER}</AlphaNotice>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<IconShieldBadge />}
          title="No passports yet"
          description="Passports are issued once an asset reaches Business Ready status."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item) => (
            <PassportCard key={item.passport.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

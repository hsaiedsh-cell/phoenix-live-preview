export const dynamic = 'force-dynamic';

import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { PassportCard } from '@/components/PassportCard';
import { LivePassportCard } from '@/components/LivePassportCard';
import { EmptyState } from '@/components/EmptyState';
import { AlphaNotice } from '@/components/AlphaNotice';
import { PreviewOnlyNotice, LiveDataBadge, renderDataStatePanel } from '@/components/DataStatePanel';
import { IconShieldBadge } from '@/components/Icons';
import { getPassports, getCurrentWorkspace, PBRS_CERTIFICATION_SAFE_DISCLAIMER } from '@/lib/api-client';
import { getPhoenixApiConfig } from '@/lib/api-config';
import { loadPassportsListData } from '@/lib/platform-data-source';

// PHX-PASSPORTS-001 note on the live/preview-only split for this page:
// only the passport LIST is live in vercel-supabase-preview mode.
// Issuing, revocation, certification actions, and public verification
// remain preview-only in every mode, including vercel-supabase-preview —
// see LivePassportCard.tsx's header comment. mock / real-dev /
// real-disabled / production-auth are all unchanged from before this
// sprint: apps/backend/src/routes/passports.ts is still a
// PHX-BACKEND-001 stub (every route 501s), so those modes have no live
// passport data source to read from yet.
export default async function PassportsPage() {
  const apiConfig = getPhoenixApiConfig();
  const workspace = await getCurrentWorkspace();

  if (apiConfig.mode !== 'vercel-supabase-preview') {
    const { items } = await getPassports();
    return (
      <div>
        <WorkspaceHeader
          eyebrow={workspace.data.name}
          title="PBRS Passports"
          description="Portable readiness records for assessed assets — score, grade, certification level, and validity in one place."
        />

        {/* No live passport endpoint exists yet for this mode; this page
            remains mock-backed, as it was before PHX-PASSPORTS-001. */}
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

  // vercel-supabase-preview — live passport list, read directly from
  // Supabase/Postgres. See lib/preview-api-client.server.ts's
  // previewGetPassports() and platform-data-source.ts's
  // loadPassportsListData().
  const result = await loadPassportsListData();

  return (
    <div>
      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="PBRS Passports"
        description="Portable readiness records for assessed assets — score, grade, certification level, and validity in one place."
      />

      {result.status === 'live' && result.data ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <LiveDataBadge />
            <span className="text-xs text-gray-400">{result.data.total} total</span>
          </div>

          <div className="mb-6 space-y-2">
            <AlphaNotice variant="inline">
              Live passport records are read from Supabase/Postgres in this hosted preview. Passport issuing,
              revocation, and public verification remain preview-only until their live endpoints are implemented.
            </AlphaNotice>
            {result.data.items.length > 0 && (
              <AlphaNotice variant="inline">{PBRS_CERTIFICATION_SAFE_DISCLAIMER}</AlphaNotice>
            )}
          </div>

          {result.data.items.length === 0 ? (
            <EmptyState
              icon={<IconShieldBadge />}
              title="No live passports yet"
              description="Passports issued in this workspace will appear here once they exist in the live database."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {result.data.items.map((item) => (
                <LivePassportCard key={item.id} item={item} />
              ))}
            </div>
          )}
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

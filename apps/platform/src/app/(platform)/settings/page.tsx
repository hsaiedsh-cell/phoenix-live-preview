import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { SettingsPanel } from '@/components/SettingsPanel';
import { AlphaNotice } from '@/components/AlphaNotice';
import { AuditTrailPreview } from '@/components/AuditTrailPreview';
import { LiveActivityList, LiveAuditList } from '@/components/LiveActivityAuditLists';
import { RoleGate } from '@/components/RoleGate';
import { RestrictedNote } from '@/components/RestrictedNote';
import { WorkspaceManagementNote } from '@/components/WorkspaceManagementNote';
import { LiveDataBadge, renderDataStatePanel } from '@/components/DataStatePanel';
import { getWorkspaceSettings, getAuditRecords } from '@/lib/api-client';
import { getPhoenixApiConfig, describePhoenixApiMode } from '@/lib/api-config';
import { resolveProductionAuthState, getServerAuthConfigStatus } from '@/lib/auth/platform-auth.server';
import { loadSettingsActivityAuditData } from '@/lib/platform-data-source';
import { PBRS_DIMENSIONS } from '@phoenix/core';

// PHX-PLATFORM-011 — see dashboard/page.tsx's identical comment. Note:
// production-auth mode was already effectively dynamic here (Clerk's
// auth() call forces it), but real-dev was not — this closes that gap.
export const dynamic = 'force-dynamic';

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-gray-100 last:border-b-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-phx-navy text-right">{value}</span>
    </div>
  );
}

function ToggleRow({ label, description, enabled }: { label: string; description: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-gray-100 last:border-b-0">
      <div>
        <p className="text-sm font-medium text-phx-navy">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
      </div>
      <span
        className={`inline-flex items-center flex-shrink-0 w-10 h-6 rounded-full p-0.5 ${
          enabled ? 'bg-phx-cyan justify-end' : 'bg-gray-200 justify-start'
        }`}
      >
        <span className="w-5 h-5 rounded-full bg-white shadow-sm" />
      </span>
    </div>
  );
}

export default async function SettingsPage() {
  const [settings, audit] = await Promise.all([getWorkspaceSettings(), getAuditRecords(5)]);
  const apiConfig = getPhoenixApiConfig();
  const apiModeLabel = describePhoenixApiMode(apiConfig);
  const isProdAuth = apiConfig.mode === 'production-auth';
  const authState = isProdAuth ? await resolveProductionAuthState() : null;
  // R1 — three-part server config status (publishable key, backend URL,
  // CLERK_SECRET_KEY). Only meaningful/computed in production-auth mode;
  // getServerAuthConfigStatus() itself is safe to call in any mode (it
  // never throws), but we only display it when relevant.
  const serverAuthConfig = isProdAuth ? getServerAuthConfigStatus() : null;

  // PHX-PLATFORM-011 (Task 7) — live activity/audit for real-dev/
  // production-auth. Fetched unconditionally (the function itself
  // returns { status: 'mock' } immediately in mock mode) so the
  // Audit Preview panel below can render either the mock preview or
  // this live result without a page-level mode branch beyond the one
  // check needed to pick which JSX to render.
  const liveActivityAudit = await loadSettingsActivityAuditData();

  // Human-readable "Auth state" line per Issue 1's required values:
  // "config missing / signed out / signed in" (mock/real-dev/real-disabled
  // show a distinct, unambiguous "not applicable" line instead).
  const authStateLabel = !isProdAuth
    ? `not available in ${apiConfig.mode} mode`
    : authState?.mode === 'config-missing'
      ? 'config missing'
      : authState?.mode === 'signed-out'
        ? 'signed out'
        : authState?.mode === 'signed-in'
          ? 'signed in'
          : 'unknown';

  return (
    <div>
      <WorkspaceHeader
        eyebrow={settings.workspaceName}
        title="Settings"
        description="Workspace configuration, scoring profile, and preferences."
      />

      <div className="mb-8">
        <AlphaNotice>
          Settings shown below are for preview purposes only in this Alpha build. Changes made here are not saved.
        </AlphaNotice>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SettingsPanel title="Workspace" description="General workspace identity and access.">
          <ReadOnlyField label="Workspace name" value={settings.workspaceName} />
          <ReadOnlyField label="Environment" value={settings.environment} />
          <ReadOnlyField label="Primary contact" value={settings.primaryContact} />
          <WorkspaceManagementNote />
        </SettingsPanel>

        <SettingsPanel title="Scoring Profile" description="The PBRS model version applied to this workspace.">
          <ReadOnlyField label="PBRS Score™ Model" value={settings.pbrsModelVersion} />
          <div className="pt-2 space-y-2">
            {PBRS_DIMENSIONS.map((dim) => (
              <div key={dim.key} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{dim.label}</span>
                <span className="font-semibold text-phx-navy">{Math.round(dim.weight * 100)}%</span>
              </div>
            ))}
          </div>
        </SettingsPanel>

        <SettingsPanel title="Notification Preferences" description="Alerts for assessment and certification events.">
          {settings.notificationPreferences.map((pref) => (
            <ToggleRow key={pref.key} label={pref.label} description={pref.description} enabled={pref.enabled} />
          ))}
        </SettingsPanel>

        <SettingsPanel title="Brand Profile" description="Brand alignment reference used in scoring.">
          <ReadOnlyField label="Voice & tone guide" value={settings.brandProfile.voiceToneGuide} />
          <ReadOnlyField label="Terminology glossary" value={settings.brandProfile.terminologyGlossary} />
        </SettingsPanel>

        <SettingsPanel title="Data Retention" description="How long assessment records are retained.">
          <ReadOnlyField label="Assessment history" value={settings.dataRetention.assessmentHistory} />
          <ReadOnlyField label="Passport records" value={settings.dataRetention.passportRecords} />
        </SettingsPanel>
      </div>

      {/* PHX-PLATFORM-009/010/010-R1 — internal-only API runtime indicator.
          Not a production readiness claim; helps QA confirm which mode a
          given build is running in. R1: never exposes CLERK_SECRET_KEY's
          VALUE — only a computed boolean ("configured: yes/no") via
          getServerAuthConfigStatus(), which reads process.env.CLERK_SECRET_KEY
          server-side and returns booleans only. See
          lib/auth/platform-auth.server.ts. */}
      <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500 space-y-1.5">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              apiConfig.mode === 'mock'
                ? 'bg-gray-300'
                : isProdAuth && serverAuthConfig && !serverAuthConfig.fullyConfigured
                  ? 'bg-red-400'
                  : apiConfig.isMisconfigured
                    ? 'bg-red-400'
                    : 'bg-amber-300'
            }`}
          />
          <span>
            API mode: <span className="font-medium text-gray-600">{apiModeLabel}</span>
          </span>
        </div>
        {apiConfig.baseUrl && (
          <div>
            Backend URL: <span className="font-medium text-gray-600">{apiConfig.baseUrl}</span>
          </div>
        )}
        {isProdAuth && serverAuthConfig && (
          <>
            <div>
              Backend URL configured:{' '}
              <span className="font-medium text-gray-600">{serverAuthConfig.backendUrlConfigured ? 'yes' : 'no'}</span>
            </div>
            <div>
              Clerk publishable key configured:{' '}
              <span className="font-medium text-gray-600">
                {serverAuthConfig.publishableKeyConfigured ? 'yes' : 'no'}
              </span>
            </div>
            <div>
              Clerk server key configured:{' '}
              <span className="font-medium text-gray-600">{serverAuthConfig.secretKeyConfigured ? 'yes' : 'no'}</span>
            </div>
          </>
        )}
        <div>
          Auth state: <span className="font-medium text-gray-600">{authStateLabel}</span>
        </div>
        <div>
          Data source (activity/audit):{' '}
          <span className="font-medium text-gray-600">{liveActivityAudit.status}</span>
        </div>
        <div className="text-gray-400">{apiConfig.statusDescription}</div>
        {isProdAuth && serverAuthConfig && !serverAuthConfig.fullyConfigured && (
          <div className="text-red-500 font-medium">
            Warning: production-auth is missing required configuration ({serverAuthConfig.missing.join(', ')}). No
            auth()/currentUser() call is made while configuration is incomplete.
          </div>
        )}
        {apiConfig.mode === 'real-dev' && (
          <div className="text-amber-600 font-medium">
            Warning: real-dev uses an unauthenticated dev header and must never be used in production.
          </div>
        )}
        {isProdAuth && authState?.mode === 'signed-in' && (
          <div className="text-amber-600 font-medium">
            Note: the Workspace/Scoring/Notification/Brand/Retention panels above are still mock-backed preview
            settings — only Activity/Audit below reads the live backend.
          </div>
        )}
      </div>

      <div className="mt-6">
        <SettingsPanel title="Audit Preview" description="Latest immutable audit records across the workspace.">
          {apiConfig.mode === 'mock' ? (
            // PHX-PLATFORM-006 — full audit trail restricted to
            // Owner/Admin/Auditor per PERMISSIONS_MODEL_PHX_PLATFORM_002.md.
            // Unchanged from PHX-PLATFORM-006/010-R1.
            <RoleGate permission="canViewAuditTrail" fallback={<RestrictedNote permission="canViewAuditTrail" />}>
              <AuditTrailPreview records={audit.items} />
              <div className="pt-2">
                <AlphaNotice variant="inline">Full audit export is not available in Alpha.</AlphaNotice>
              </div>
            </RoleGate>
          ) : liveActivityAudit.status === 'live' && liveActivityAudit.data ? (
            // PHX-PLATFORM-011 (Task 7) — real-dev/production-auth: the
            // backend's own audit.read permission check (not the mock
            // session's canViewAuditTrail) is what gates this data; a
            // 403 from the backend surfaces as 'permission-denied' below,
            // not as this branch.
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <LiveDataBadge />
                <span className="text-xs text-gray-400">
                  {liveActivityAudit.data.activity.length} activity · {liveActivityAudit.data.auditRecords.length}{' '}
                  audit records
                </span>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Activity</h3>
                <LiveActivityList items={liveActivityAudit.data.activity} />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Audit Records</h3>
                <LiveAuditList items={liveActivityAudit.data.auditRecords} />
              </div>
            </div>
          ) : (
            renderDataStatePanel(
              liveActivityAudit.status as
                | 'auth-required'
                | 'config-missing'
                | 'backend-unavailable'
                | 'permission-denied'
                | 'not-found'
                | 'not-wired',
              liveActivityAudit.message
            )
          )}
        </SettingsPanel>
      </div>
    </div>
  );
}

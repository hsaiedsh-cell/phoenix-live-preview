// ============================================================
// Phoenix Platform — ProductionAuthGate
// PHX-PLATFORM-010    — Clerk Platform Auth Integration
// PHX-PLATFORM-010-R1 — Clerk Config Gate & Mock Data Transparency Fix
// ------------------------------------------------------------
// production-auth-mode counterpart to AuthGate.tsx. AuthGate.tsx
// continues to handle mock/real-dev exactly as before (mock session,
// UI-only gate, "Alpha" framing). This component is only rendered
// when getPlatformAuthMode() === 'production-auth' — see
// (platform)/layout.tsx, which picks between AuthGate and this
// component based on mode so neither file needs an internal branch
// for the other's behavior.
//
// Unlike AuthGate, this IS meant to reflect a real (Clerk) session
// state — not a mock one — though it still does not itself enforce
// backend authorization; the backend's OidcJwtActorResolver
// (PHX-AUTH-002) is the actual enforcement point. This component's
// job is only to avoid ever rendering platform data/UI when there is
// no signed-in Clerk session or when Clerk/backend config is missing,
// per this sprint's "protected routes do not silently show mock data
// in production-auth" acceptance criterion.
//
// Server Component — resolves session state via
// lib/auth/platform-auth.server.ts. R1: config-missing now reflects
// getServerAuthConfigStatus()'s three-part check (publishable key,
// backend URL, CLERK_SECRET_KEY) rather than only the client-safe
// isMisconfigured flag — see platform-auth.server.ts's file header for
// the full before/after. Missing CLERK_SECRET_KEY is never conflated
// with signed-out.
//
// R1 Issue 2 fix: the signed-in branch now renders
// MockDataTransparencyBanner above children, since page data migration
// off mock-api-client.ts is not complete this sprint (see
// PHX_PLATFORM_010_R1_IMPLEMENTATION_REPORT.md). The banner is only
// ever reached via this component, so it can never appear in mock or
// real-dev mode, and never in the config-missing/signed-out states
// (no platform data is rendered in those states to be transparent
// about).
// ============================================================

import Link from 'next/link';
import { resolveProductionAuthState } from '@/lib/auth/platform-auth.server';
import { MockDataTransparencyBanner } from './MockDataTransparencyBanner';
import { IconLock } from './Icons';

function GateShell({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-phx-surface flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
        <div className="mx-auto mb-5 w-12 h-12 rounded-full bg-phx-navy/5 flex items-center justify-center text-phx-navy">
          <IconLock width={20} height={20} />
        </div>
        <h1 className="text-lg font-extrabold text-phx-navy tracking-tight mb-2">{title}</h1>
        <p className="text-sm text-gray-500 mb-6">{description}</p>
        {children}
      </div>
    </div>
  );
}

export async function ProductionAuthGate({ children }: { children: React.ReactNode }) {
  const state = await resolveProductionAuthState();

  if (state.mode === 'config-missing') {
    return (
      <GateShell
        title="Production auth is not configured"
        description={`This deployment is set to production-auth mode, but required configuration is missing: ${state.missing.join(', ')}. No platform data is shown until this is resolved — this mode never falls back to mock data.`}
      />
    );
  }

  if (state.mode === 'signed-out') {
    return (
      <GateShell
        title="Sign in required"
        description="This deployment is running in production-auth (Clerk) mode. Sign in to access Phoenix Platform."
      >
        <Link
          href="/login"
          className="inline-flex items-center justify-center px-6 py-3 rounded-lg text-sm font-semibold bg-phx-cyan text-white hover:bg-phx-cyan-dark transition-colors shadow-sm"
        >
          Go to Sign In
        </Link>
      </GateShell>
    );
  }

  // state.mode === 'signed-in' (or 'not-applicable', unreachable here since
  // (platform)/layout.tsx only renders this component in production-auth
  // mode). Role/workspace membership are resolved separately, DB-side, by
  // the backend — this gate only confirms a Clerk identity exists for the
  // request. R1: prepend the mock-data transparency banner — see file
  // header.
  return (
    <>
      <MockDataTransparencyBanner />
      {children}
    </>
  );
}

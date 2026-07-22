// ============================================================
// Phoenix Platform — PreviewAuthGate
// PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter
// ------------------------------------------------------------
// vercel-supabase-preview-mode counterpart to ProductionAuthGate.tsx.
// Only rendered when getPlatformAuthMode() === 'vercel-supabase-preview'
// — see (platform)/layout.tsx.
//
// Same fail-closed shape as ProductionAuthGate: config-missing and
// signed-out both render an explanatory shell with no platform data
// underneath; only a confirmed Clerk session renders children (with
// PreviewModeBanner prepended). Role/workspace membership are NOT
// resolved here — that happens per-read, DB-side, in
// preview-api-client.server.ts — this gate only confirms a Clerk
// identity exists for the request, exactly like ProductionAuthGate.
// ============================================================

import Link from 'next/link';
import { resolvePreviewSessionState, getPreviewAuthConfigStatus } from '@/lib/auth/preview-auth.server';
import { PreviewModeBanner } from './PreviewModeBanner';
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

export async function PreviewAuthGate({ children }: { children: React.ReactNode }) {
  const state = await resolvePreviewSessionState();

  if (state.mode === 'config-missing') {
    const status = getPreviewAuthConfigStatus();
    return (
      <GateShell
        title="Preview deployment is not configured"
        description={`This deployment is set to vercel-supabase-preview mode, but required configuration is missing: ${status.missing.join(', ')}. No platform data is shown until this is resolved — this mode never falls back to mock data.`}
      />
    );
  }

  if (state.mode === 'signed-out') {
    return (
      <GateShell
        title="Sign in required"
        description="This deployment is running in vercel-supabase-preview (Clerk + Supabase) mode. Sign in to access Phoenix Platform."
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

  // state.mode === 'signed-in' (or 'not-applicable', unreachable here —
  // (platform)/layout.tsx only renders this component in
  // vercel-supabase-preview mode). Phoenix-user mapping and
  // role/workspace permission checks happen per-read, DB-side, in
  // preview-api-client.server.ts — a signed-in Clerk session with no
  // linked Phoenix user still surfaces auth-required on each data panel,
  // it is not treated as authorized here.
  return (
    <>
      <PreviewModeBanner />
      {children}
    </>
  );
}

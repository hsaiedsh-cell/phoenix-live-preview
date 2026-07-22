'use client';

// ============================================================
// Phoenix Platform — ClerkSignInPanel
// PHX-PLATFORM-010 — Clerk Platform Auth Integration
// ------------------------------------------------------------
// Renders Clerk's hosted <SignIn /> component when Clerk is
// configured, or a controlled "config missing" panel otherwise —
// never a broken/blank screen. Sign-up is intentionally not offered
// here (routeless=false with no sign-up link surfaced) per this
// sprint's "sign-in only; sign-up disabled or documented as not
// configured" instruction; enabling public sign-up is deferred to a
// future customer-onboarding sprint.
//
// Client Component: Clerk's <SignIn /> component requires the
// browser. The parent /login/page.tsx (a Server Component) only
// renders this when apiConfig.mode === 'production-auth', keeping the
// Clerk client bundle out of the mock/real-dev login path entirely.
// ============================================================

import { SignIn } from '@clerk/nextjs';
import { AlphaNotice } from '@/components/AlphaNotice';
import type { PhoenixApiConfig } from '@/lib/api-config';

export function ClerkSignInPanel({ apiConfig }: { apiConfig: PhoenixApiConfig }) {
  if (!apiConfig.clerkConfigured || apiConfig.isMisconfigured) {
    return (
      <div className="bg-white border border-red-200 rounded-2xl p-8 shadow-sm text-center">
        <h1 className="text-lg font-extrabold text-red-700 tracking-tight mb-2">Sign-in is not configured</h1>
        <p className="text-sm text-gray-600">
          This deployment is running in {apiConfig.mode} mode, but Clerk is not fully configured
          (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY, plus{' '}
          {apiConfig.mode === 'vercel-supabase-preview'
            ? 'PHOENIX_DATABASE_URL'
            : 'NEXT_PUBLIC_PHOENIX_BACKEND_URL'}
          ). No sign-in form can be shown until this is resolved — this mode never falls back to the mock login
          screen.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <SignIn
          routing="hash"
          signUpUrl="/login"
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'shadow-none border-none p-2',
            },
          }}
        />
      </div>
      <div className="mt-6">
        <AlphaNotice variant="inline">
          This deployment is running in {apiConfig.mode} (Clerk) mode. Sign-up is not enabled — accounts are
          provisioned by a Phoenix administrator, not through public self-service, in this release.
        </AlphaNotice>
      </div>
    </div>
  );
}

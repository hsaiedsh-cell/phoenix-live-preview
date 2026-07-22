// ============================================================
// Phoenix Platform — ClerkProviderShell
// PHX-PLATFORM-010 — Clerk Platform Auth Integration
// PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter
// ------------------------------------------------------------
// Thin conditional wrapper around @clerk/nextjs's ClerkProvider.
// Renders a plain passthrough (no Clerk import touched at all) in
// every mode except 'production-auth' and 'vercel-supabase-preview',
// so:
//   - mock / real-dev / real-disabled builds never require
//     NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY or any Clerk env var.
//   - Clerk's client-side script/hooks are never mounted for a
//     build that isn't using Clerk, avoiding any risk of this
//     sprint's change breaking the existing mock/real-dev UI.
//
// In either Clerk-backed mode, if the publishable key is missing this
// renders a controlled inline error instead of letting ClerkProvider
// throw an unhandled exception at the root of the app — consistent
// with "missing key produces controlled error only in a Clerk-backed
// mode" (Task 2, PHX-PLATFORM-010).
// ============================================================

import { getPhoenixApiConfig } from '@/lib/api-config';

// NOTE: @clerk/nextjs is imported dynamically inside the
// production-auth branch of the server component below (via a
// same-file conditional require path is not possible in a Server
// Component with static ESM imports, so this file imports it
// statically — see docs/platform/PHX_PLATFORM_010_IMPLEMENTATION_REPORT.md,
// "Static vs dynamic Clerk import trade-off", for why a static import
// here is acceptable: @clerk/nextjs's ClerkProvider does not itself
// throw at *module-evaluation* time when unconfigured — only when
// rendered without a publishableKey and without
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set. The guard below prevents it
// from ever being rendered in that state.
import { ClerkProvider } from '@clerk/nextjs';

const CLERK_BACKED_MODES = ['production-auth', 'vercel-supabase-preview'] as const;

export function ClerkProviderShell({ children }: { children: React.ReactNode }) {
  const config = getPhoenixApiConfig();

  if (!(CLERK_BACKED_MODES as readonly string[]).includes(config.mode)) {
    return <>{children}</>;
  }

  if (!config.clerkPublishableKey) {
    return (
      <div className="min-h-screen bg-phx-surface flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center bg-white border border-red-200 rounded-2xl p-8 shadow-sm">
          <h1 className="text-lg font-extrabold text-red-700 tracking-tight mb-2">Auth configuration error</h1>
          <p className="text-sm text-gray-600">
            NEXT_PUBLIC_PHOENIX_API_MODE is set to {config.mode}, but NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing.
            This deployment cannot show platform data until Clerk is configured — {config.mode} never falls back to
            mock mode automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={config.clerkPublishableKey}
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || '/login'}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || '/login'}
      afterSignInUrl={process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL || '/dashboard'}
      afterSignUpUrl={process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL || '/dashboard'}
    >
      {children}
    </ClerkProvider>
  );
}

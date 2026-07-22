import type { Metadata } from 'next';
import { siteConfig } from '@phoenix/config';
import { SessionProvider } from '@/components/SessionProvider';
import { ClerkProviderShell } from '@/components/ClerkProviderShell';
import './globals.css';

export const metadata: Metadata = {
  title: `Phoenix Platform — ${siteConfig.tagline}`,
  description: 'Phoenix Platform Alpha — assessments, PBRS passports, certifications, and readiness reports for AI-generated business outputs.',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-phx-surface text-phx-navy">
        {/*
          PHX-PLATFORM-006 — mock session context for the whole app (login,
          platform shell, and any future routes). Mock-only: no real auth
          provider is connected. See lib/mock-session.ts.

          PHX-PLATFORM-010 — ClerkProviderShell wraps children in
          @clerk/nextjs's ClerkProvider ONLY when the resolved API mode is
          'production-auth' (see lib/api-config.ts) — it is a no-op passthrough
          in mock/real-dev/real-disabled, so those modes never require Clerk
          env vars and never load Clerk's client script. SessionProvider
          (the mock session) still wraps everything unconditionally: mock/
          real-dev pages that call usePhoenixSession() keep working exactly
          as before even when Clerk is also mounted for an unrelated route.
        */}
        <ClerkProviderShell>
          <SessionProvider>{children}</SessionProvider>
        </ClerkProviderShell>
      </body>
    </html>
  );
}

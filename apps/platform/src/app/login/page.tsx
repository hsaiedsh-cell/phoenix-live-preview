import Link from 'next/link';
import { AlphaNotice } from '@/components/AlphaNotice';
import { LoginRoleSelector } from '@/components/LoginRoleSelector';
import { IconLock } from '@/components/Icons';
import { getPhoenixApiConfig } from '@/lib/api-config';
import { ClerkSignInPanel } from '@/components/ClerkSignInPanel';

function PhoenixMark() {
  return (
    <svg width="36" height="41" viewBox="0 0 1731 1978" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M154 130L1259 130L1602 473V1015L1259 1358H639V1978H154V1258L639 773H1136L1259 1015L1136 1258H639V773L154 1258V130Z"
        fill="var(--phx-navy)"
        fillRule="evenodd"
      />
      <rect x="154" y="1633" width="345" height="345" fill="var(--phx-cyan)" />
    </svg>
  );
}

export default function LoginPage() {
  // PHX-PLATFORM-010 — production-auth mode renders Clerk's hosted sign-in
  // instead of the mock login form below. mock/real-dev are completely
  // unchanged from PHX-PLATFORM-006/008 — this branch is checked first and
  // returns early so neither path affects the other.
  // PHX-DEPLOY-004C — vercel-supabase-preview is also Clerk-backed (see
  // ClerkProviderShell.tsx) and renders the same hosted sign-in panel.
  const apiConfig = getPhoenixApiConfig();
  if (apiConfig.mode === 'production-auth' || apiConfig.mode === 'vercel-supabase-preview') {
    return (
      <div className="min-h-screen bg-phx-surface flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Link href="/" aria-label="Phoenix home">
              <PhoenixMark />
            </Link>
          </div>
          <ClerkSignInPanel apiConfig={apiConfig} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-phx-surface flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/" aria-label="Phoenix home">
            <PhoenixMark />
          </Link>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          <div className="text-center mb-7">
            <span className="inline-flex items-center text-[11px] font-semibold tracking-wide text-phx-cyan-dark bg-phx-cyan/10 px-2.5 py-1 rounded-full uppercase mb-3">
              Platform Alpha · Mock Authentication
            </span>
            <h1 className="text-xl font-extrabold text-phx-navy tracking-tight">Sign in to Phoenix Platform</h1>
            <p className="mt-2 text-sm text-gray-500">
              Access assessments, passports, certifications, and readiness reports.
            </p>
          </div>

          <form className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-phx-navy mb-1.5">
                Work email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-phx-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-phx-cyan/40 focus:border-phx-cyan transition-colors"
              />
              <p className="mt-1 text-[11px] text-gray-400">UI preview only — this field is not validated.</p>
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-phx-navy mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-phx-navy placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-phx-cyan/40 focus:border-phx-cyan transition-colors"
              />
              <p className="mt-1 text-[11px] text-gray-400">UI preview only — this field is not validated.</p>
            </div>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs text-gray-400">or preview as a role</span>
              </div>
            </div>

            <LoginRoleSelector />

            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs text-gray-400">or</span>
              </div>
            </div>

            <button
              type="button"
              disabled
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold border border-gray-200 text-gray-400 cursor-not-allowed"
            >
              <IconLock width={16} height={16} />
              Continue with Enterprise SSO (not connected)
            </button>
          </form>
        </div>

        <div className="mt-6">
          <AlphaNotice variant="inline">
            Platform Alpha — no production authentication is connected yet. This screen uses a mock session only;
            picking a role above (or just continuing) signs you in as that mock user for this browser.
          </AlphaNotice>
        </div>
      </div>
    </div>
  );
}

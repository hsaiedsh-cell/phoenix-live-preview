// ============================================================
// Phoenix Platform — DataStatePanel
// PHX-PLATFORM-011 — Live Read Migration for Production Auth
// ------------------------------------------------------------
// One shared, calm, on-brand panel for every non-data state a migrated
// live read surface can be in (auth-required / config-missing /
// backend-unavailable / permission-denied / not-wired). Pages render
// this instead of the page's normal content when
// lib/platform-data-source.ts's LiveResult.status is anything other
// than 'mock' or 'live' — never a blank screen, never mock data
// standing in silently for a failed live read.
// ============================================================

import Link from 'next/link';
import { IconAlert, IconLock } from './Icons';

interface DataStatePanelProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; href: string };
  tone?: 'neutral' | 'warning';
}

export function DataStatePanel({ icon, title, description, action, tone = 'neutral' }: DataStatePanelProps) {
  return (
    <div
      className={`rounded-xl border p-6 text-center ${
        tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div
        className={`mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center ${
          tone === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-phx-navy/5 text-phx-navy'
        }`}
      >
        {icon ?? <IconAlert width={18} height={18} />}
      </div>
      <h3 className="text-sm font-bold text-phx-navy mb-1.5">{title}</h3>
      <p className="text-sm text-gray-500 max-w-md mx-auto">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="inline-flex items-center justify-center mt-4 px-5 py-2.5 rounded-lg text-sm font-semibold bg-phx-cyan text-white hover:bg-phx-cyan-dark transition-colors"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Backend unreachable, or returned an error other than auth/permission (e.g. DB unavailable, 500). */
export function BackendUnavailablePanel({ message }: { message?: string }) {
  return (
    <DataStatePanel
      icon={<IconAlert width={18} height={18} />}
      title="Backend unavailable"
      description={message ?? 'The Phoenix backend could not be reached. Live data cannot be shown right now.'}
      tone="warning"
    />
  );
}

/** No Clerk session token was available for this request (production-auth only — real-dev never reaches this state). */
export function AuthRequiredPanel({ message }: { message?: string }) {
  return (
    <DataStatePanel
      icon={<IconLock width={18} height={18} />}
      title="Sign-in required"
      description={message ?? 'Sign in to view this live data.'}
      action={{ label: 'Go to Sign In', href: '/login' }}
    />
  );
}

/** Signed in, but the current identity lacks the backend permission (e.g. audit.read) for this data. */
export function PermissionDeniedPanel({ message }: { message?: string }) {
  return (
    <DataStatePanel
      icon={<IconLock width={18} height={18} />}
      title="Permission required"
      description={
        message ?? 'Your account does not have permission to view this data. Contact a workspace Owner or Admin.'
      }
    />
  );
}

/** real-dev or production-auth is missing required config (workspace id, backend URL, etc.) for this section. */
export function ConfigMissingPanel({ message }: { message?: string }) {
  return (
    <DataStatePanel
      icon={<IconAlert width={18} height={18} />}
      title="Live data not configured"
      description={message ?? 'This section requires additional configuration before live data can be shown.'}
      tone="warning"
    />
  );
}

/**
 * A page/section whose backend endpoint does not exist yet
 * (passports/certifications/reports this sprint). Rendered inline,
 * above the existing mock-backed content — never a full-page
 * replacement, since the page still legitimately shows preview data.
 */
export function PreviewOnlyNotice({ label = 'Preview-only' }: { label?: string }) {
  return (
    <div className="mb-6 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
      <IconAlert width={14} height={14} />
      <span>
        <span className="font-semibold text-gray-600">{label}.</span> This page&apos;s live backend endpoint is not
        available yet — the data shown below is mock-backed, not real workspace data.
      </span>
    </div>
  );
}

/** Small inline badge for a page/section that IS rendering live backend data. */
export function LiveDataBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Live backend data
    </span>
  );
}

/** The requested entity does not exist (404) in the live backend. */
export function NotFoundPanel({ message }: { message?: string }) {
  return (
    <DataStatePanel
      icon={<IconAlert width={18} height={18} />}
      title="Not found"
      description={message ?? 'This item could not be found in the live backend.'}
    />
  );
}

/**
 * Renders the correct panel for any non-data DataSourceStatus (mock/live
 * excluded — callers render their normal content for those). Centralizes
 * the status→panel mapping so pages don't each re-implement the switch.
 */
export function renderDataStatePanel(
  status:
    | 'auth-required'
    | 'config-missing'
    | 'backend-unavailable'
    | 'permission-denied'
    | 'not-found'
    | 'not-wired',
  message?: string
) {
  switch (status) {
    case 'auth-required':
      return <AuthRequiredPanel message={message} />;
    case 'permission-denied':
      return <PermissionDeniedPanel message={message} />;
    case 'not-found':
      return <NotFoundPanel message={message} />;
    case 'config-missing':
      return <ConfigMissingPanel message={message} />;
    case 'not-wired':
      return <ConfigMissingPanel message={message ?? 'real-disabled mode does not read from a live backend.'} />;
    case 'backend-unavailable':
    default:
      return <BackendUnavailablePanel message={message} />;
  }
}

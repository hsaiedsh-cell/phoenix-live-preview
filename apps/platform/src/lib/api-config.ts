// ============================================================
// Phoenix Platform — API Runtime Configuration
// PHX-PLATFORM-009 — Backend Integration Readiness Layer
// PHX-LIVE-001    — Platform Live Integration Readiness (added 'real-dev')
// PHX-PLATFORM-010 — Clerk Platform Auth Integration
// PHX-PLATFORM-011 — Live Read Migration for Production Auth (added
//   productionWorkspaceId, an interim env-based workspace resolution
//   bridge for production-auth reads — see field doc comment below) (added 'production-auth')
// PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter (added
//   'vercel-supabase-preview': a Clerk-authenticated mode that reads
//   Supabase/Postgres directly, server-side, with no separate Express
//   backend host. Reuses productionWorkspaceId as its workspace-scope
//   bridge — see that field's doc comment, now updated to cover both
//   modes. Reuses clerkPublishableKey/clerkConfigured unchanged. Never
//   reads or exposes PHOENIX_DATABASE_URL here — that var is
//   server-only and is checked by lib/auth/preview-auth.server.ts's
//   getPreviewAuthConfigStatus(), mirroring how CLERK_SECRET_KEY is
//   handled for production-auth in lib/auth/platform-auth.server.ts.)
// ------------------------------------------------------------
// Resolves the runtime API mode Phoenix Platform is running in. This
// module does not itself call a backend or a Clerk SDK — it only
// decides which client / auth boundary the rest of the app routes
// through.
//
// Modes:
//   mock            Default. All data access goes through
//                    mock-api-client.ts / sample-data.ts. Always
//                    works, no env vars required.
//   real-dev         Calls the real Phoenix backend using the
//                    development-only X-Phoenix-User-Id header (no
//                    auth of any kind). Requires
//                    NEXT_PUBLIC_PHOENIX_BACKEND_URL and
//                    NEXT_PUBLIC_PHOENIX_DEV_USER_ID. Local/dev only —
//                    see PHX-LIVE-001.
//   real-disabled    Real backend mode requested but intentionally
//                    disabled. Preserved from PHX-PLATFORM-009 for any
//                    caller still checking for it.
//   production-auth  PHX-PLATFORM-010: Clerk-backed hosted auth mode.
//                    Requires Clerk publishable/secret keys and a
//                    backend URL. Sends `Authorization: Bearer <token>`
//                    to the backend, never X-Phoenix-User-Id. Missing
//                    config fails closed (isMisconfigured) — it never
//                    silently falls back to mock or real-dev.
//
// PHX-PLATFORM-010 note: nothing here is itself a security boundary —
// it is a build/runtime configuration switch, read only from
// NEXT_PUBLIC_* environment variables (safe to expose to the client;
// CLERK_SECRET_KEY is read only server-side, see lib/auth/platform-auth.server.ts,
// and is never surfaced through this module).
// ============================================================

export type PhoenixApiMode = 'mock' | 'real-dev' | 'real-disabled' | 'production-auth' | 'vercel-supabase-preview';

export interface PhoenixApiConfig {
  /** Resolved runtime mode. */
  mode: PhoenixApiMode;
  /** Configured backend base URL, if any was provided via env. Null when unset. */
  baseUrl: string | null;
  /** Request timeout a real client should use. */
  timeoutMs: number;
  /** Milliseconds mock-api-client.ts's mockDelay() should wait, when non-zero. */
  mockLatencyMs: number;
  /** True only when mode === 'real-dev' or mode === 'production-auth'. */
  realApiEnabled: boolean;

  // ---- real-dev (PHX-LIVE-001) ----
  /** Dev-only seed workspace id, real-dev mode only. */
  devWorkspaceId: string | null;
  /** Dev-only seed user id sent as X-Phoenix-User-Id, real-dev mode only. */
  devUserId: string | null;

  // ---- production-auth (PHX-PLATFORM-010) ----
  /** Clerk publishable key, production-auth mode only. Safe to expose (NEXT_PUBLIC_*). */
  clerkPublishableKey: string | null;
  /** Whether Clerk env config (publishable key) is present. Does not check CLERK_SECRET_KEY (server-only). */
  clerkConfigured: boolean;

  // ---- production-auth workspace resolution (PHX-PLATFORM-011, interim) ----
  /**
   * PHX-PLATFORM-011: interim, explicitly-temporary workspace id used to
   * scope workspace-level backend reads (assessments/activity/audit) in
   * production-auth mode. The backend does not yet expose a
   * "workspaces for the authenticated identity" endpoint (that is
   * PHX-AUTH-001's "workspace membership resolution from authenticated
   * identity" future work) — until it does, this env var is the only way
   * production-auth mode can know which workspace to query. Null when
   * unset; callers must treat that as "workspace not resolved" (a
   * config-missing-shaped state), never guess or fall back to a mock
   * workspace id.
   *
   * PHX-DEPLOY-004C: 'vercel-supabase-preview' mode reuses this exact
   * field/env var for the same reason — it also has no "workspaces for
   * the authenticated identity" endpoint to call (there is no Express
   * endpoint at all in this mode; see lib/preview-api-client.server.ts).
   */
  productionWorkspaceId: string | null;
  /**
   * PHX-REPORTS-003: interim, explicitly-temporary default report
   * template id, used only by RequestReportButton.tsx to know which
   * templateId to send to POST /api/workspaces/:workspaceId/reports.
   * The backend has no "list report templates" endpoint yet (GET
   * .../reports itself is still a PHX-BACKEND-001 stub — see
   * apps/backend/src/routes/reports.ts — let alone a templates-only
   * listing endpoint, which is out of this sprint's scope entirely),
   * so there is nothing live the frontend could otherwise read a
   * template choice from. Mirrors the same interim-bridge pattern as
   * devWorkspaceId/devUserId (real-dev) and productionWorkspaceId
   * (production-auth/vercel-supabase-preview) above: null when unset,
   * and callers must treat that as "not configured" (an inert,
   * disabled button state — never a fabricated/guessed template id).
   * real-dev and production-auth only; not read in any other mode.
   */
  defaultReportTemplateId: string | null;
  /** True when a mode requiring config (real-dev, production-auth) is missing required env vars. */
  isMisconfigured: boolean;
  /** Human-readable label for the current mode, used by the Settings runtime indicator. */
  modeLabel: string;
  /** Short human-readable status/warning description for the Settings runtime indicator. */
  statusDescription: string;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MOCK_LATENCY_MS = 0;

type PublicEnvName =
  | 'NEXT_PUBLIC_PHOENIX_API_MODE'
  | 'NEXT_PUBLIC_PHOENIX_BACKEND_URL'
  | 'NEXT_PUBLIC_PHOENIX_API_BASE_URL'
  | 'NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID'
  | 'NEXT_PUBLIC_PHOENIX_DEV_USER_ID'
  | 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'
  | 'NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID'
  | 'NEXT_PUBLIC_PHOENIX_DEFAULT_REPORT_TEMPLATE_ID';

/**
 * Reads an approved NEXT_PUBLIC_* variable through static property access.
 * Next.js replaces these references in browser bundles at build time; dynamic
 * process.env[name] access works on the server but resolves empty in the client.
 */
function readEnv(name: PublicEnvName): string | undefined {
  try {
    const value = (() => {
      switch (name) {
        case 'NEXT_PUBLIC_PHOENIX_API_MODE':
          return process.env.NEXT_PUBLIC_PHOENIX_API_MODE;
        case 'NEXT_PUBLIC_PHOENIX_BACKEND_URL':
          return process.env.NEXT_PUBLIC_PHOENIX_BACKEND_URL;
        case 'NEXT_PUBLIC_PHOENIX_API_BASE_URL':
          return process.env.NEXT_PUBLIC_PHOENIX_API_BASE_URL;
        case 'NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID':
          return process.env.NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID;
        case 'NEXT_PUBLIC_PHOENIX_DEV_USER_ID':
          return process.env.NEXT_PUBLIC_PHOENIX_DEV_USER_ID;
        case 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':
          return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
        case 'NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID':
          return process.env.NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID;
        case 'NEXT_PUBLIC_PHOENIX_DEFAULT_REPORT_TEMPLATE_ID':
          return process.env.NEXT_PUBLIC_PHOENIX_DEFAULT_REPORT_TEMPLATE_ID;
      }
    })();
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the requested mode from NEXT_PUBLIC_PHOENIX_API_MODE.
 * Unset / unrecognized values fail safe to 'mock'. This is the ONLY
 * function in this file that decides which mode is active — every
 * other export derives from its result.
 */
function resolveApiMode(): PhoenixApiMode {
  const requested = readEnv('NEXT_PUBLIC_PHOENIX_API_MODE')?.toLowerCase();

  if (requested === 'real-dev') return 'real-dev';
  if (requested === 'real-disabled') return 'real-disabled';
  if (requested === 'production-auth' || requested === 'clerk-auth') return 'production-auth';
  if (requested === 'vercel-supabase-preview') return 'vercel-supabase-preview';
  // Covers unset, 'mock', 'real' (PHX-PLATFORM-009's old requested-but-disabled
  // path), and any unrecognized value — fail safe to mock.
  return 'mock';
}

/**
 * Returns the resolved Phoenix Platform API runtime configuration.
 * Safe to call from Server Components, Client Components, and plain
 * modules — reads only NEXT_PUBLIC_* env vars (and, implicitly,
 * whether CLERK_SECRET_KEY-dependent server code will later fail —
 * this function itself never reads that secret var), no I/O.
 */
export function getPhoenixApiConfig(): PhoenixApiConfig {
  const mode = resolveApiMode();

  const baseUrl =
    readEnv('NEXT_PUBLIC_PHOENIX_BACKEND_URL')?.replace(/\/$/, '') ??
    readEnv('NEXT_PUBLIC_PHOENIX_API_BASE_URL') ??
    null;

  const devWorkspaceId = readEnv('NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID') ?? null;
  const devUserId = readEnv('NEXT_PUBLIC_PHOENIX_DEV_USER_ID') ?? null;

  const clerkPublishableKey = readEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY') ?? null;
  const clerkConfigured = Boolean(clerkPublishableKey);
  const productionWorkspaceId = readEnv('NEXT_PUBLIC_PHOENIX_PRODUCTION_WORKSPACE_ID') ?? null;
  const defaultReportTemplateId = readEnv('NEXT_PUBLIC_PHOENIX_DEFAULT_REPORT_TEMPLATE_ID') ?? null;

  let isMisconfigured = false;
  let modeLabel: string;
  let statusDescription: string;

  if (mode === 'mock') {
    modeLabel = 'Mock';
    statusDescription = 'Using in-memory fixture data. No backend connection.';
  } else if (mode === 'real-disabled') {
    modeLabel = 'Real Disabled';
    statusDescription = 'Real backend mode is configured but disabled.';
  } else if (mode === 'real-dev') {
    isMisconfigured = !baseUrl || !devUserId;
    if (isMisconfigured) {
      const missing: string[] = [];
      if (!baseUrl) missing.push('NEXT_PUBLIC_PHOENIX_BACKEND_URL');
      if (!devUserId) missing.push('NEXT_PUBLIC_PHOENIX_DEV_USER_ID');
      modeLabel = 'Real Dev (Misconfigured)';
      statusDescription = `Real-dev mode requires: ${missing.join(', ')}.`;
    } else {
      modeLabel = 'Real Dev';
      statusDescription = `Connected to backend at ${baseUrl}. Dev user: ${devUserId ? devUserId.slice(0, 8) + '…' : 'none'}. No auth — dev header only.`;
    }
  } else if (mode === 'production-auth') {
    isMisconfigured = !baseUrl || !clerkConfigured;
    if (isMisconfigured) {
      const missing: string[] = [];
      if (!clerkConfigured) missing.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (and CLERK_SECRET_KEY)');
      if (!baseUrl) missing.push('NEXT_PUBLIC_PHOENIX_BACKEND_URL');
      modeLabel = 'Production Auth (Config Missing)';
      statusDescription = `production-auth mode requires: ${missing.join(', ')}. This mode does not fall back to mock or real-dev.`;
    } else {
      modeLabel = 'Production Auth (Clerk)';
      statusDescription = `Connected to backend at ${baseUrl}. Bearer token attached per request from the active Clerk session.`;
    }
  } else {
    // vercel-supabase-preview (PHX-DEPLOY-004C). No baseUrl is used or
    // required in this mode — there is no separate Express backend host;
    // reads go straight to Supabase/Postgres from server-side code (see
    // lib/preview-api-client.server.ts). This client-safe check only
    // covers clerkConfigured (the NEXT_PUBLIC_* publishable key) — the
    // server-only PHOENIX_DATABASE_URL and CLERK_SECRET_KEY checks live
    // in lib/auth/preview-auth.server.ts's getPreviewAuthConfigStatus(),
    // exactly mirroring how production-auth splits its client-safe vs.
    // server-only config checks.
    isMisconfigured = !clerkConfigured;
    if (isMisconfigured) {
      modeLabel = 'Vercel + Supabase Preview (Config Missing)';
      statusDescription =
        'vercel-supabase-preview mode requires: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (and CLERK_SECRET_KEY, PHOENIX_DATABASE_URL — checked server-side). This mode does not fall back to mock or real-dev.';
    } else {
      modeLabel = 'Vercel + Supabase Preview (Clerk)';
      statusDescription =
        'Reading Supabase/Postgres directly from server-side code. No separate backend host. Clerk session required for every protected read.';
    }
  }

  return {
    mode,
    baseUrl: mode === 'mock' || mode === 'vercel-supabase-preview' ? null : baseUrl,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    mockLatencyMs: DEFAULT_MOCK_LATENCY_MS,
    realApiEnabled: mode === 'real-dev' || mode === 'production-auth' || mode === 'vercel-supabase-preview',
    devWorkspaceId: mode === 'real-dev' ? devWorkspaceId : null,
    devUserId: mode === 'real-dev' ? devUserId : null,
    clerkPublishableKey:
      mode === 'production-auth' || mode === 'vercel-supabase-preview' ? clerkPublishableKey : null,
    clerkConfigured,
    productionWorkspaceId:
      mode === 'production-auth' || mode === 'vercel-supabase-preview' ? productionWorkspaceId : null,
    defaultReportTemplateId: mode === 'real-dev' || mode === 'production-auth' ? defaultReportTemplateId : null,
    isMisconfigured,
    modeLabel,
    statusDescription,
  };
}

/**
 * Singleton config resolved once at module load. Safe for Next.js
 * server/client — reads only NEXT_PUBLIC_* env vars.
 */
export const API_CONFIG: PhoenixApiConfig = getPhoenixApiConfig();

/** Human-readable label for the resolved mode, used by the Settings API mode indicator. */
export function describePhoenixApiMode(config: PhoenixApiConfig = getPhoenixApiConfig()): string {
  return config.modeLabel;
}

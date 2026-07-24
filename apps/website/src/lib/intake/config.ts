// ============================================================
// Intake configuration loader — server-only
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Centralizes every environment variable the intake system needs so
// that:
//   1. no route handler or adapter reads process.env directly, and
//   2. a single place documents which vars are public (safe to ship
//      to the browser via NEXT_PUBLIC_*) versus server-only secrets.
//
// This module must never be imported from a 'use client' component.
// ============================================================

function requireServerEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Intentionally generic: never echoes which deployment/env this
    // is, only that server configuration is incomplete. Full detail
    // goes to structured server logs via the caller, not the thrown
    // message shown to any client.
    throw new Error(`Missing required server environment variable: ${name}`);
  }
  return value;
}

function optionalServerEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const publicConfig = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://phoenixops.ai',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'hello@phoenixops.ai',
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '',
} as const;

// Lazily read server secrets only when a server code path actually
// needs them, so `next build`/`next lint`/`tsc --noEmit` never fail
// in an environment that has no secrets configured yet (e.g. this
// sprint's local development and CI gates, which never invoke these
// functions).
export const serverConfig = {
  get databaseUrl(): string {
    return requireServerEnv('INTAKE_DATABASE_URL');
  },
  get intakeHashSecret(): string {
    return requireServerEnv('INTAKE_HASH_SECRET');
  },
  get turnstileSecretKey(): string {
    return requireServerEnv('TURNSTILE_SECRET_KEY');
  },
  get resendApiKey(): string {
    return requireServerEnv('RESEND_API_KEY');
  },
  get intakeFromEmail(): string {
    return process.env.INTAKE_FROM_EMAIL || 'hello@phoenixops.ai';
  },
  get intakeInternalToEmail(): string {
    return process.env.INTAKE_INTERNAL_TO_EMAIL || 'hello@phoenixops.ai';
  },
  get supabaseUrl(): string {
    return requireServerEnv('SUPABASE_URL');
  },
  get supabaseServiceRoleKey(): string {
    return requireServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  },
  get supabaseIntakeBucket(): string {
    return process.env.SUPABASE_INTAKE_BUCKET || 'private-intake-uploads';
  },
  get sentryDsn(): string | undefined {
    return optionalServerEnv('SENTRY_DSN');
  },
  // Shared secret required on the two internal-only routes
  // (/api/intake/:id/finalize and /api/intake/:id/upload-session).
  // These are never called from browser code — only from the
  // operations CLI (apps/website/scripts/ops/intake-ops.ts). This
  // repo explicitly excludes a new admin UI from scope, so a shared
  // operator secret is the minimum viable protection until a real
  // authenticated ops surface is built in a later sprint.
  get intakeOpsSecret(): string {
    return requireServerEnv('INTAKE_OPS_SECRET');
  },
} as const;


export const CURRENT_PRIVACY_VERSION = '2026-07-24-draft-1';
export const CURRENT_TERMS_VERSION = '2026-07-24-draft-1';

export const RATE_LIMITS = {
  perIpPerHour: 5,
  perEmailPerHour: 3,
  duplicateIdempotencyWindowMinutes: 15,
} as const;

export const UPLOAD_LIMITS = {
  maxFiles: 5,
  maxFileSizeBytes: 20 * 1024 * 1024, // 20 MB
  maxTotalSizeBytes: 60 * 1024 * 1024, // 60 MB
  tokenExpiryHours: 24,
  allowedContentTypes: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'text/plain',
  ] as const,
} as const;

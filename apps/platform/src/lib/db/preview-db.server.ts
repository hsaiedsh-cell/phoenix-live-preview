// ============================================================
// Phoenix Platform — Preview Database Client (server-only)
// PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter
// ------------------------------------------------------------
// Thin wrapper around a lazily-created `pg.Pool`, used ONLY by
// vercel-supabase-preview mode (lib/preview-api-client.server.ts) to
// read Supabase/Postgres directly from server-side Next.js code, since
// this mode has no separate Express backend host.
//
// Mirrors apps/backend/src/db/client.ts's shape deliberately (same
// lazy-pool, same "never log the connection string" discipline) so the
// two database access points stay easy to compare — this file is NOT
// a copy of that module (it lives in a different app/runtime and reads
// a different, platform-scoped env var), but the design is intentionally
// the same.
//
// ---- Server-only boundary --------------------------------------------
// This module must NEVER be imported from a 'use client' component or
// from any file reachable from one. Next.js's server/client module
// graph already prevents `pg` (a Node-only package) from being bundled
// into client code as long as no client component imports this file
// (directly or transitively) — the only importer is
// lib/preview-api-client.server.ts, itself only imported by
// lib/platform-data-source.ts, itself only called from Server
// Component pages (see that file's header). As defense in depth, this
// module also throws immediately if it is somehow evaluated in a
// browser context (`typeof window !== 'undefined'`), so a future
// accidental client import fails loudly at module-eval time instead of
// silently bundling a Postgres connection string toward the browser.
//
// PHOENIX_DATABASE_URL is deliberately NOT named DATABASE_URL — Vercel
// (and some Postgres-as-a-service integrations) auto-injects a
// DATABASE_URL env var of its own in some setups, and this file must
// never accidentally pick that up instead of the explicitly-configured
// Supabase connection string. This env var is read ONLY here (and in
// lib/auth/preview-auth.server.ts's config-status check, which reads
// only its presence, never its value) — never through api-config.ts,
// which is the client-safe NEXT_PUBLIC_* surface.
// ============================================================

import { Pool } from 'pg';

if (typeof window !== 'undefined') {
  throw new Error(
    '[preview-db.server] This module must never be evaluated in a browser context. ' +
      'It was imported from client code — this is a server/client boundary violation.'
  );
}

let pool: Pool | undefined;
let poolConnectionString: string | undefined;

/** Reads PHOENIX_DATABASE_URL, trimmed. Returns undefined if unset/blank. Never logs the value. */
function readPreviewDatabaseUrl(): string | undefined {
  const value = process.env.PHOENIX_DATABASE_URL;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** True only when PHOENIX_DATABASE_URL is set. Safe to call anywhere server-side — never throws, never returns the value. */
export function isPreviewDatabaseConfigured(): boolean {
  return Boolean(readPreviewDatabaseUrl());
}

/**
 * Lazily creates (once per server process) and returns the shared
 * pg.Pool for preview reads. Throws if PHOENIX_DATABASE_URL is unset —
 * callers (lib/preview-api-client.server.ts) must check
 * isPreviewDatabaseConfigured() first via
 * lib/auth/preview-auth.server.ts's getPreviewAuthConfigStatus() and
 * throw a typed RealApiConfigError before ever calling this.
 */
export function getPreviewDatabasePool(): Pool {
  const connectionString = readPreviewDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      'PHOENIX_DATABASE_URL is not set. getPreviewDatabasePool() must not be called before ' +
        'getPreviewAuthConfigStatus().fullyConfigured is confirmed true.'
    );
  }

  if (pool && poolConnectionString !== connectionString) {
    void pool.end().catch(() => undefined);
    pool = undefined;
  }

  if (!pool) {
    // Supabase's pooled connection endpoints (both the transaction-mode
    // "pooler" port and a direct connection) work fine with `pg`'s own
    // Pool on top — Supabase does not require a special client. SSL is
    // required by Supabase's hosted Postgres; `rejectUnauthorized:
    // false` matches Supabase's own connection examples for serverless
    // clients that do not ship the full CA bundle (the connection is
    // still encrypted — this only skips certificate-chain verification,
    // a standard, documented trade-off for serverless/edge Postgres
    // clients connecting to a managed provider).
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
    poolConnectionString = connectionString;
  }

  return pool;
}

/** Closes the shared pool, if one was created. Safe to call multiple times. Exposed for QA/test teardown. */
export async function closePreviewDatabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
    poolConnectionString = undefined;
  }
}

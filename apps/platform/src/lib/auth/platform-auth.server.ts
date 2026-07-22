// ============================================================
// Phoenix Platform — Platform Auth Boundary (server-side)
// PHX-PLATFORM-010    — Clerk Platform Auth Integration
// PHX-PLATFORM-010-R1 — Clerk Config Gate & Mock Data Transparency Fix
// ------------------------------------------------------------
// Server Component / server-only counterpart to
// platform-auth.client.ts. Used by ProductionAuthGate and any future
// server-rendered route that needs to know "is there a signed-in
// Clerk user for this request?" without reaching into @clerk/nextjs
// directly from page code.
//
// Only ever imported from Server Components / server-only modules —
// never from a 'use client' file. Client code uses
// platform-auth.client.ts instead.
//
// Never trusts any role/workspace/org claim from Clerk — this file
// returns at most a Clerk user id + basic profile fields for display
// (email, name), exactly mirroring the backend's OidcJwtActorResolver
// contract (PHX-AUTH-002): the provider is an identity source only.
// Role/workspace membership continue to come from the Phoenix backend
// (DB-derived), not from anything returned here.
//
// ---- R1 fix: CLERK_SECRET_KEY is now part of the fail-closed gate ----
// that meant a deployment with NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and
// NEXT_PUBLIC_PHOENIX_BACKEND_URL set but CLERK_SECRET_KEY missing was
// NOT detected as misconfigured here — resolveProductionAuthState() would
// proceed straight to calling @clerk/nextjs/server's auth(), which (absent
// a secret key) either throws or behaves unpredictably depending on SDK
// version, and the surrounding try/catch collapsed that into the SAME
// 'signed-out' result as an ordinary "no session yet" case — silently
// treating a broken deployment as merely logged-out.
//
// getServerAuthConfigStatus() below is the fix: it checks all three
// required vars — publishable key, backend URL (both client-safe, read
// from api-config.ts), AND CLERK_SECRET_KEY (server-only, read directly
// from process.env here and NEVER returned, logged, or exposed — only a
// boolean "is it set" is produced) — BEFORE resolveProductionAuthState()
// or getServerBackendToken() ever imports @clerk/nextjs/server. Missing
// CLERK_SECRET_KEY now short-circuits to 'config-missing', the same as a
// missing publishable key or backend URL, and auth()/currentUser() are
// never called in that state.
// ============================================================

import { getPhoenixApiConfig } from '../api-config';

export interface ServerAuthConfigStatus {
  /** From api-config.ts — client-safe, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY presence. */
  publishableKeyConfigured: boolean;
  /** Server-only — CLERK_SECRET_KEY presence. The value itself is never read into this object. */
  secretKeyConfigured: boolean;
  /** From api-config.ts — NEXT_PUBLIC_PHOENIX_BACKEND_URL presence. */
  backendUrlConfigured: boolean;
  /** True only when all three of the above are true. */
  fullyConfigured: boolean;
  /** Human-readable names of whichever required vars are missing, for display/error text only. */
  missing: string[];
}

/**
 * True only when CLERK_SECRET_KEY is set to a non-empty value. Reads the
 * var directly (server-only module — never imported from a 'use client'
 * file) and returns a boolean ONLY. The secret's value is never assigned
 * to a variable that outlives this function, returned, logged, or placed
 * in any object passed to a Client/Server Component prop.
 */
function isServerClerkSecretConfigured(): boolean {
  try {
    const value = process.env.CLERK_SECRET_KEY;
    return typeof value === 'string' && value.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolves the full production-auth configuration gate — publishable key,
 * backend URL, AND server secret key — regardless of caller. Safe to call
 * in any mode (returns all-true-shaped trivia outside production-auth is
 * not meaningful, so callers should still check getPlatformAuthMode()
 * first; this function itself does not branch on mode because both of
 * this file's callers already do).
 */
export function getServerAuthConfigStatus(): ServerAuthConfigStatus {
  const config = getPhoenixApiConfig();
  const publishableKeyConfigured = Boolean(config.clerkPublishableKey);
  const backendUrlConfigured = Boolean(config.baseUrl);
  const secretKeyConfigured = isServerClerkSecretConfigured();

  const missing: string[] = [];
  if (!publishableKeyConfigured) missing.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
  if (!backendUrlConfigured) missing.push('NEXT_PUBLIC_PHOENIX_BACKEND_URL');
  if (!secretKeyConfigured) missing.push('CLERK_SECRET_KEY');

  return {
    publishableKeyConfigured,
    secretKeyConfigured,
    backendUrlConfigured,
    fullyConfigured: publishableKeyConfigured && backendUrlConfigured && secretKeyConfigured,
    missing,
  };
}

export type ProductionAuthState =
  | { mode: 'not-applicable' }
  | { mode: 'config-missing'; missing: string[] }
  | { mode: 'signed-out' }
  | { mode: 'signed-in'; clerkUserId: string; email: string | null };

/**
 * Resolves the current production-auth session state for a Server
 * Component. Safe to call in any mode — returns 'not-applicable'
 * immediately outside production-auth so callers don't need their own
 * mode branch first.
 *
 * R1: the config-missing check now goes through getServerAuthConfigStatus()
 * (publishable key + backend URL + CLERK_SECRET_KEY) instead of only
 * api-config.ts's client-safe isMisconfigured. @clerk/nextjs/server is
 * dynamically imported ONLY after fullyConfigured is confirmed true —
 * missing CLERK_SECRET_KEY now returns 'config-missing' and never reaches
 * auth()/currentUser(), so it can no longer be conflated with an ordinary
 * signed-out session.
 */
export async function resolveProductionAuthState(): Promise<ProductionAuthState> {
  const config = getPhoenixApiConfig();

  if (config.mode !== 'production-auth') {
    return { mode: 'not-applicable' };
  }

  const serverStatus = getServerAuthConfigStatus();
  if (!serverStatus.fullyConfigured) {
    return { mode: 'config-missing', missing: serverStatus.missing };
  }

  try {
    // Dynamic import: only reached once publishable key, backend URL, AND
    // CLERK_SECRET_KEY are all confirmed present — @clerk/nextjs/server's
    // own env validation never runs against an incomplete configuration,
    // and never runs at all in mock/real-dev.
    const { auth, currentUser } = await import('@clerk/nextjs/server');
    const { userId } = await auth();

    if (!userId) {
      return { mode: 'signed-out' };
    }

    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? null;

    return { mode: 'signed-in', clerkUserId: userId, email };
  } catch (err) {
    // Reachable only for a genuine Clerk SDK/runtime error with a FULLY
    // CONFIGURED setup (e.g. transient network issue reaching Clerk) —
    // config-missing is now handled above and never falls through to
    // here. Still fails safe to signed-out rather than a 500, but this is
    // no longer the path a missing CLERK_SECRET_KEY takes.
    console.error('[platform-auth.server] Failed to resolve Clerk session:', err);
    return { mode: 'signed-out' };
  }
}

/**
 * Server-side counterpart to platform-auth.client.ts's
 * getBackendAuthHeaders(), for any future server-side fetch to the
 * Phoenix backend (e.g. a server action or route handler) made on
 * behalf of the signed-in user. Not yet called from any server
 * fetch this sprint — real-api-client.ts's realFetch() runs
 * client-side; this export exists so a future server-side caller
 * has a ready-made, consistent seam instead of importing
 * @clerk/nextjs/server directly.
 *
 * R1: same config-gate fix as resolveProductionAuthState() — checks
 * getServerAuthConfigStatus().fullyConfigured before importing
 * @clerk/nextjs/server, so a missing CLERK_SECRET_KEY returns a clear
 * config-missing reason rather than an ambiguous SDK error.
 */
export async function getServerBackendToken(): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const config = getPhoenixApiConfig();
  if (config.mode !== 'production-auth') {
    return { ok: false, reason: `getServerBackendToken() called outside production-auth mode ('${config.mode}').` };
  }

  const serverStatus = getServerAuthConfigStatus();
  if (!serverStatus.fullyConfigured) {
    return { ok: false, reason: `production-auth is misconfigured. Missing: ${serverStatus.missing.join(', ')}.` };
  }

  try {
    const { auth } = await import('@clerk/nextjs/server');
    const { getToken } = await auth();
    const token = await getToken({ template: 'phoenix-backend' });
    if (!token) {
      return { ok: false, reason: 'No active Clerk session for this request.' };
    }
    return { ok: true, token };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unknown error retrieving Clerk token.' };
  }
}

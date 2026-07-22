// ============================================================
// Phoenix Platform — Platform Auth Boundary (client-side)
// PHX-PLATFORM-010 — Clerk Platform Auth Integration
// ------------------------------------------------------------
// Single seam responsible for answering "what bearer token (if any)
// should this request carry?" so no page/component calls the Clerk
// SDK directly. real-api-client.ts is the only caller of
// getBackendAuthHeaders() today; a future sprint wiring more pages to
// real reads should also go through this file rather than importing
// @clerk/nextjs itself.
//
// Behavior by mode (see api-config.ts):
//   mock / real-dev    Never calls Clerk. Always resolves { ok: false }
//                       immediately — callers in these modes should not
//                       be asking for a bearer token in the first place
//                       (real-api-client.ts only calls this from its
//                       production-auth branch), but this file fails
//                       safe regardless of who calls it.
//   production-auth    Uses Clerk's client-side session helper
//                       (`window.Clerk.session.getToken()`, exposed by
//                       ClerkProvider once loaded) to obtain a fresh
//                       session token. Returns { ok: false } if no
//                       Clerk session exists (signed out) or the SDK
//                       has not finished loading — callers must treat
//                       that as "not signed in", never substitute a
//                       cached/mock value.
//
// No token is ever written to localStorage/sessionStorage here or
// anywhere else in the platform app — Clerk's own in-memory/cookie
// session handling is used as-is; this file never persists a token
// itself.
// ============================================================

import { getPhoenixApiConfig } from '../api-config';

export type AuthHeaderResult = { ok: true; token: string } | { ok: false; reason: string };

/**
 * Minimal shape of the pieces of the Clerk client SDK this file relies on.
 * Declared locally (rather than importing @clerk/nextjs's types) so this
 * file type-checks even in a build where @clerk/nextjs is not installed —
 * see docs/platform/PHX_PLATFORM_010_IMPLEMENTATION_REPORT.md, "Clerk as
 * an optional dependency at the type level".
 */
interface MinimalClerkWindow {
  Clerk?: {
    session?: {
      getToken: (options?: { template?: string }) => Promise<string | null>;
    } | null;
  };
}

/**
 * Resolves the bearer token real-api-client.ts should attach for the
 * current request, or a typed reason it could not. NEVER throws — every
 * failure path is a normal { ok: false } return so callers can branch
 * without try/catch.
 */
export async function getBackendAuthHeaders(): Promise<AuthHeaderResult> {
  const config = getPhoenixApiConfig();

  if (config.mode !== 'production-auth') {
    return { ok: false, reason: `getBackendAuthHeaders() called outside production-auth mode ('${config.mode}').` };
  }

  if (typeof window === 'undefined') {
    // Server-side call in production-auth mode — server code should use
    // platform-auth.server.ts's getServerBackendToken() instead, which
    // reads the request's Clerk session via @clerk/nextjs/server. This
    // client helper only works in the browser.
    return { ok: false, reason: 'getBackendAuthHeaders() (client) called outside the browser.' };
  }

  const clerkWindow = window as unknown as MinimalClerkWindow;
  const session = clerkWindow.Clerk?.session;

  if (!session) {
    return { ok: false, reason: 'No active Clerk session (signed out, or Clerk has not finished loading).' };
  }

  try {
    const token = await session.getToken();
    if (!token) {
      return { ok: false, reason: 'Clerk session present but returned no token.' };
    }
    return { ok: true, token };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unknown error retrieving Clerk token.' };
  }
}

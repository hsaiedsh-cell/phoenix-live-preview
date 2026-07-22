// ============================================================
// Phoenix Platform — Platform Auth Boundary (shared entrypoint)
// PHX-PLATFORM-010 — Clerk Platform Auth Integration
// ------------------------------------------------------------
// Re-exports the platform auth mode + isomorphic helpers that are
// safe to import from either a Server or Client Component. Anything
// that needs the Clerk SDK specifically must import
// platform-auth.server.ts (server-only) or platform-auth.client.ts
// (client-only) directly, per Next.js's server/client module
// boundary — see those files' headers for why the split exists.
// ============================================================

import { getPhoenixApiConfig, type PhoenixApiMode } from '../api-config';

export type { AuthHeaderResult } from './platform-auth.client';
export type { ProductionAuthState, ServerAuthConfigStatus } from './platform-auth.server';

/** Resolves which platform auth mode is currently active. Isomorphic — safe anywhere. */
export function getPlatformAuthMode(): PhoenixApiMode {
  return getPhoenixApiConfig().mode;
}

/** True only when the platform is running in Clerk-backed production-auth mode. */
export function isProductionAuthMode(): boolean {
  return getPlatformAuthMode() === 'production-auth';
}

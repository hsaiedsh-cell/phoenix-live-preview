// ============================================================
// Phoenix Platform — Next.js Middleware
// PHX-PLATFORM-011-R1 — Clerk session detection
// PHX-DEPLOY-003-R1 — Middleware mode safety fix
// PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter (no change
//   needed here: this file's clerkConfigured check already depends
//   only on the two Clerk env vars, not on which mode requested them,
//   so vercel-supabase-preview gets the same clerkMiddleware() session
//   detection production-auth already gets, automatically, and the
//   same safe pass-through when Clerk isn't configured.)
// ------------------------------------------------------------
// clerkMiddleware()'s matcher below intentionally covers nearly every
// route (so Clerk session detection is available wherever
// production-auth needs it). PHX-DEPLOY-003's runtime QA found that
// invoking clerkMiddleware() unconditionally means EVERY matched route
// 500s with "@clerk/nextjs: Missing publishableKey" / "Missing
// secretKey" whenever those env vars are absent — including in `mock`
// and `real-dev` API modes, which have nothing to do with Clerk at all.
// That is a real regression against this file's own requirement ("does
// not break mock mode", "does not break real-dev mode").
//
// Fix: only construct and invoke clerkMiddleware() when BOTH required
// Clerk env vars are present. Otherwise, export a plain pass-through
// middleware that never imports/calls any Clerk SDK code — so mock and
// real-dev deployments (which typically have neither var set) never
// attempt any Clerk network call and never crash, regardless of which
// API mode is selected.
//
// This does NOT weaken production-auth's fail-closed behavior:
// - If NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set but CLERK_SECRET_KEY is
//   NOT (a partial/broken Clerk config), this middleware falls back to
//   pass-through — Clerk session detection is simply unavailable at the
//   middleware layer. That is safe because the actual "is production-auth
//   usable" decision is made downstream, per-request, by
//   platform-auth.server.ts's getServerAuthConfigStatus() /
//   resolveProductionAuthState(), which independently checks all three
//   required vars (publishable key, backend URL, secret key) and
//   returns an explicit 'config-missing' state — never treating a
//   missing var as "signed out" or "mock". This middleware skipping
//   Clerk does not change that: the page-level gate (ProductionAuthGate)
//   still fails closed exactly as before.
// - If both vars ARE present, clerkMiddleware() runs exactly as it did
//   before this fix, with the same matcher, so real Clerk session
//   detection is unchanged for a properly-configured deployment.
//
// See PHX_DEPLOY_003_R1_BLOCKER_RESOLUTION_REPORT.md for the full
// before/after and the QA that confirms mock/real-dev no longer crash.
// ============================================================

import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextMiddleware } from 'next/server';

/**
 * True only when both Clerk env vars required to construct
 * clerkMiddleware() without throwing are present and non-empty. Read
 * once at module load — these are deployment-time env vars, not
 * per-request state, so re-checking per request would add no value.
 */
const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() && process.env.CLERK_SECRET_KEY?.trim()
);

/** Pass-through middleware — no Clerk SDK code is imported or executed via this path. */
const passthroughMiddleware: NextMiddleware = () => NextResponse.next();

export default clerkConfigured ? clerkMiddleware() : passthroughMiddleware;

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};

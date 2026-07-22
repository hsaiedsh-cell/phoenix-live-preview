// ============================================================
// Phoenix Backend — Auth Identity Repository
// PHX-AUTH-002 — Hosted Auth Vendor Decision & Production Resolver
// ------------------------------------------------------------
// Maps a VerifiedExternalIdentity (see src/auth/token-verifier.ts) to a
// Phoenix users.id, per docs/auth/PHX_AUTH_001_IMPLEMENTATION_PLAN.md
// §1 Mapping Rules:
//   1. Try (provider, external_subject) first — the durable key.
//   2. If no identity row exists, try matching an existing users.email
//      — ONLY when the verified identity's emailVerified is true — and
//      link it (insert an auth_identities row) rather than creating a
//      new user.
//   3. Never auto-create a new Phoenix user here — an unmatched
//      identity is the caller's (actor-resolver.ts's) job to turn into
//      401 AUTH_REQUIRED with the documented "no Phoenix user is linked"
//      message.
//   4. Never assign or infer workspace membership from any provider
//      claim — this module only ever returns a userId; workspace_users
//      remains the sole source of role/membership, resolved downstream
//      by request-actor.ts exactly as before this sprint.
//   5. A race between two concurrent first-time-login requests linking
//      the same (provider, external_subject) is resolved via the
//      unique index (uq_auth_identities_provider_subject) + ON
//      CONFLICT DO NOTHING + re-select, not via application-level
//      locking.
//
// No ORM — raw parameterized SQL only, consistent with every other
// repository in this backend.
// ============================================================

import type { PoolClient } from 'pg';
import { getDatabasePool } from '../db/client';
import { withTransaction } from '../db/transaction';
import type { VerifiedExternalIdentity } from '../auth/token-verifier';

export type IdentityMappingResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'no_matching_user' | 'ambiguous_match' };

interface AuthIdentityRow {
  user_id: string;
}

/**
 * Looks up an existing linked identity by (provider, external_subject).
 * Returns the linked Phoenix userId, or null if no such link exists
 * yet. Does not touch `users` or attempt email matching — see
 * resolveUserIdForIdentity() for the full mapping flow.
 */
async function findLinkedUserId(
  provider: string,
  externalSubject: string,
  client?: PoolClient
): Promise<string | null> {
  const runner = client ?? getDatabasePool();
  const result = await runner.query<AuthIdentityRow>(
    `SELECT user_id
     FROM auth_identities
     WHERE provider = $1 AND external_subject = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [provider, externalSubject]
  );
  return result.rows[0]?.user_id ?? null;
}

/**
 * Finds candidate existing `users` rows by verified email, for the
 * interim (provider, external_subject)-unlinked case. Only ever called
 * when the verified identity's emailVerified is true (enforced by
 * token-verifier.ts before this repository is reached at all — see
 * actor-resolver.ts's OidcJwtActorResolver). Returns every match (there
 * should be at most one, given users.email's existing unique index —
 * see db/migrations/0001_initial_schema.sql — but this function does
 * not assume that invariant silently; see resolveUserIdForIdentity()'s
 * "ambiguous_match" handling).
 */
async function findUsersByVerifiedEmail(email: string, client?: PoolClient): Promise<string[]> {
  const runner = client ?? getDatabasePool();
  const result = await runner.query<{ id: string }>(
    `SELECT id
     FROM users
     WHERE email = $1 AND deleted_at IS NULL`,
    [email]
  );
  return result.rows.map((row) => row.id);
}

/** Inserts a new auth_identities row linking `userId` to the verified identity. */
async function linkIdentity(
  userId: string,
  identity: VerifiedExternalIdentity,
  client: PoolClient
): Promise<void> {
  await client.query(
    `INSERT INTO auth_identities (user_id, provider, external_subject, email, email_verified, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (provider, external_subject) WHERE deleted_at IS NULL DO NOTHING`,
    [userId, identity.provider, identity.subject, identity.email, identity.emailVerified]
  );
}

/** Updates last_seen_at (and email, in case it changed at the provider) for an existing link. */
async function touchIdentity(
  provider: string,
  externalSubject: string,
  email: string,
  client?: PoolClient
): Promise<void> {
  const runner = client ?? getDatabasePool();
  await runner.query(
    `UPDATE auth_identities
     SET last_seen_at = now(), email = $3, updated_at = now()
     WHERE provider = $1 AND external_subject = $2 AND deleted_at IS NULL`,
    [provider, externalSubject, email]
  );
}

/**
 * Resolves `identity` (already signature/issuer/audience/expiry/
 * email_verified-verified by token-verifier.ts) to a Phoenix userId,
 * per the mapping rules in this file's header. This is the only
 * database-adjacent work OidcJwtActorResolver performs — it never
 * queries `workspace_users` or any role/permission table itself; that
 * remains request-actor.ts's job, unchanged, after this function
 * returns a userId.
 *
 * Returns:
 *   - { ok: true, userId } — either an existing link (touched/updated)
 *     or a newly-created link to a pre-existing `users` row matched by
 *     verified email.
 *   - { ok: false, reason: 'no_matching_user' } — no (provider,
 *     subject) link and no `users` row with this verified email. Per
 *     mapping rule 3, no new Phoenix user is created here.
 *   - { ok: false, reason: 'ambiguous_match' } — more than one `users`
 *     row shares this email (should not happen given the schema's
 *     unique index, but handled explicitly rather than assumed away —
 *     see mapping rule 5's sibling case for identity resolution).
 */
export async function resolveUserIdForIdentity(
  identity: VerifiedExternalIdentity
): Promise<IdentityMappingResult> {
  // Fast path: identity already linked — no transaction needed for a
  // read-then-update that only ever touches one row keyed by the
  // unique (provider, external_subject) index.
  const existingUserId = await findLinkedUserId(identity.provider, identity.subject);
  if (existingUserId) {
    await touchIdentity(identity.provider, identity.subject, identity.email);
    return { ok: true, userId: existingUserId };
  }

  // No existing link: attempt first-time email-based matching and
  // link creation inside a transaction, so a concurrent first login
  // from the same identity cannot create two rows — the unique index
  // plus ON CONFLICT DO NOTHING makes this safe even under a race.
  return withTransaction(async (client) => {
    // Re-check inside the transaction in case a concurrent request
    // already linked this identity between the fast-path read above
    // and acquiring this transaction.
    const raceWinnerUserId = await findLinkedUserId(identity.provider, identity.subject, client);
    if (raceWinnerUserId) {
      await touchIdentity(identity.provider, identity.subject, identity.email, client);
      return { ok: true, userId: raceWinnerUserId };
    }

    const candidates = await findUsersByVerifiedEmail(identity.email, client);
    if (candidates.length === 0) {
      return { ok: false, reason: 'no_matching_user' };
    }
    if (candidates.length > 1) {
      // Should be unreachable given users.email's unique index, but
      // fails closed rather than silently picking one.
      return { ok: false, reason: 'ambiguous_match' };
    }

    const [userId] = candidates;
    await linkIdentity(userId, identity, client);
    return { ok: true, userId };
  });
}

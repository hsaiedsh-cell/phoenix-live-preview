-- ============================================================
-- Phoenix Backend — Migration 0002: Auth Identities
-- PHX-AUTH-002 — Hosted Auth Vendor Decision & Production Resolver
-- ------------------------------------------------------------
-- Durable mapping from a verified external identity (provider +
-- external_subject, i.e. the provider's JWT `sub` claim) to a Phoenix
-- `users` row. This is the schema gap PHX-AUTH-001's ADR/Implementation
-- Plan documented as "proposed, not implemented" (§1, Schema Gaps) —
-- this migration closes it via the "preferred safer path" (a dedicated
-- auth_identities table) rather than adding external_provider/
-- external_subject/email_verified columns directly to `users`, so that
-- a future user can hold more than one linked external identity (e.g.
-- adding enterprise SSO after starting with the MVP provider) without
-- another schema change.
--
-- Does not change PBRS scoring, PBRS dimensions, certification/tier
-- thresholds, or any other table's columns. Does not touch `users` or
-- `workspace_users` — role/workspace membership remain fully owned by
-- workspace_users, exactly as documented in PHX-AUTH-001's Identity
-- Model mapping rules.
--
-- Follows this repo's existing conventions (see 0001_initial_schema.sql):
-- UUID PK via gen_random_uuid() (pgcrypto, already enabled by 0001),
-- CITEXT for the case-insensitive email column (citext, already
-- enabled by 0001), created_at/updated_at/deleted_at on every table,
-- partial unique indexes scoped to `WHERE deleted_at IS NULL`.
-- ============================================================

CREATE TABLE auth_identities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider          TEXT NOT NULL, -- e.g. 'clerk' — matches PHOENIX_AUTH_PROVIDER
  external_subject  TEXT NOT NULL, -- the provider's JWT `sub` claim
  email             CITEXT NOT NULL,
  email_verified    BOOLEAN NOT NULL DEFAULT false,
  last_seen_at      TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ NULL
);

-- One active identity per (provider, external_subject) — this is the
-- durable lookup key auth-identity.repository.ts's findByExternalIdentity()
-- uses first, before any email-based matching.
CREATE UNIQUE INDEX uq_auth_identities_provider_subject
  ON auth_identities (provider, external_subject)
  WHERE deleted_at IS NULL;

-- Supports "does this Phoenix user already have a linked identity"
-- lookups and cascading soft-delete bookkeeping.
CREATE INDEX idx_auth_identities_user_id ON auth_identities (user_id);

-- Supports the interim email-based matching path (PHX-AUTH-001 Identity
-- Model rule 2) — only ever consulted when no (provider, subject) row
-- exists yet, and only for verified (email_verified=true) identities.
CREATE INDEX idx_auth_identities_email ON auth_identities (email) WHERE deleted_at IS NULL;

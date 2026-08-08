-- ============================================================
-- Phoenix Backend — Migration 0008: Controlled Onboarding Invitations
-- PHX-LAUNCH-002-R5
-- ============================================================

CREATE TABLE onboarding_invitations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  membership_id            UUID NOT NULL REFERENCES workspace_users(id) ON DELETE RESTRICT,
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash               CHAR(64) NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'Issued',
  expires_at               TIMESTAMPTZ NOT NULL,
  issued_by_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supersedes_invitation_id UUID NULL REFERENCES onboarding_invitations(id) ON DELETE RESTRICT,
  accepted_at              TIMESTAMPTZ NULL,
  revoked_at               TIMESTAMPTZ NULL,
  revoked_by_user_id       UUID NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_onboarding_invitation_token_hash
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_onboarding_invitation_status
    CHECK (status IN ('Issued', 'Accepted', 'Revoked', 'Expired')),
  CONSTRAINT chk_onboarding_invitation_expiry
    CHECK (expires_at > created_at),
  CONSTRAINT chk_onboarding_invitation_state
    CHECK (
      (status = 'Issued' AND accepted_at IS NULL AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
      OR (status = 'Accepted' AND accepted_at IS NOT NULL AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
      OR (status = 'Revoked' AND accepted_at IS NULL AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
      OR (status = 'Expired' AND accepted_at IS NULL AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
    ),
  CONSTRAINT chk_onboarding_invitation_not_self_superseding
    CHECK (supersedes_invitation_id IS NULL OR supersedes_invitation_id <> id)
);

CREATE UNIQUE INDEX uq_onboarding_invitations_token_hash
  ON onboarding_invitations (token_hash);
CREATE UNIQUE INDEX uq_onboarding_invitations_live_membership
  ON onboarding_invitations (membership_id) WHERE status = 'Issued';
CREATE INDEX idx_onboarding_invitations_workspace_created
  ON onboarding_invitations (workspace_id, created_at DESC);
CREATE INDEX idx_onboarding_invitations_expiry
  ON onboarding_invitations (expires_at) WHERE status = 'Issued';

CREATE TABLE onboarding_invitation_deliveries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id  UUID NOT NULL REFERENCES onboarding_invitations(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL DEFAULT 'Pending',
  attempt_count  INTEGER NOT NULL DEFAULT 0,
  provider_code  TEXT NULL,
  last_error_code TEXT NULL,
  sent_at        TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_onboarding_delivery_status
    CHECK (status IN ('Pending', 'Sent', 'Failed')),
  CONSTRAINT chk_onboarding_delivery_attempts
    CHECK (attempt_count BETWEEN 0 AND 10),
  CONSTRAINT chk_onboarding_delivery_sent
    CHECK ((status = 'Sent' AND sent_at IS NOT NULL) OR (status <> 'Sent' AND sent_at IS NULL)),
  CONSTRAINT chk_onboarding_delivery_codes
    CHECK (
      (provider_code IS NULL OR char_length(provider_code) BETWEEN 1 AND 50)
      AND (last_error_code IS NULL OR char_length(last_error_code) BETWEEN 1 AND 100)
    )
);

CREATE UNIQUE INDEX uq_onboarding_delivery_invitation
  ON onboarding_invitation_deliveries (invitation_id);
CREATE INDEX idx_onboarding_delivery_pending
  ON onboarding_invitation_deliveries (status, created_at) WHERE status IN ('Pending', 'Failed');

CREATE FUNCTION enforce_onboarding_invitation_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'onboarding invitations cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'Issued' THEN
      RAISE EXCEPTION 'new onboarding invitations must start as Issued';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'Issued' THEN
    RAISE EXCEPTION 'terminal onboarding invitations are immutable';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.issued_by_user_id IS DISTINCT FROM OLD.issued_by_user_id
    OR NEW.supersedes_invitation_id IS DISTINCT FROM OLD.supersedes_invitation_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'immutable onboarding invitation fields cannot change';
  END IF;

  IF NEW.status NOT IN ('Accepted', 'Revoked', 'Expired') THEN
    RAISE EXCEPTION 'invalid onboarding invitation transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_onboarding_invitation_lifecycle
BEFORE INSERT OR UPDATE OR DELETE ON onboarding_invitations
FOR EACH ROW EXECUTE FUNCTION enforce_onboarding_invitation_lifecycle();

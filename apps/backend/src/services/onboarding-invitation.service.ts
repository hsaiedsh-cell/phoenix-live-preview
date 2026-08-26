import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction';

export class OnboardingInvitationError extends Error {
  constructor(public readonly reason: 'not_found' | 'conflict' | 'expired') {
    super('The onboarding invitation cannot be used in its current state.');
    this.name = 'OnboardingInvitationError';
  }
}

interface InvitationRow {
  id: string; workspace_id: string; membership_id: string; user_id: string;
  status: 'Issued' | 'Accepted' | 'Revoked' | 'Expired'; expires_at: string;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function audit(client: PoolClient, row: InvitationRow, actor: string | null, action: string, before: string, after: string): Promise<void> {
  await client.query(
    `INSERT INTO audit_records(workspace_id,actor_user_id,action,entity_type,entity_id,changes,context)
     VALUES($1,$2,$3,'OnboardingInvitation',$4,$5::jsonb,NULL)`,
    [row.workspace_id, actor, action, row.id, JSON.stringify({ status: [before, after] })]
  );
}

async function issueWithClient(client: PoolClient, membershipId: string, expiresInHours: number, operatorId: string, supersedes: string | null) {
  const membership = await client.query<{ workspace_id: string; user_id: string; status: string }>(
    `SELECT workspace_id,user_id,status FROM workspace_users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [membershipId]
  );
  const member = membership.rows[0];
  if (!member) throw new OnboardingInvitationError('not_found');
  if (member.status !== 'Invited') throw new OnboardingInvitationError('conflict');
  await client.query(
    `UPDATE onboarding_invitations SET status='Expired',updated_at=now()
     WHERE membership_id=$1 AND status='Issued' AND expires_at <= now()`, [membershipId]
  );
  const token = randomBytes(32).toString('base64url');
  const inserted = await client.query<InvitationRow>(
    `INSERT INTO onboarding_invitations
     (workspace_id,membership_id,user_id,token_hash,expires_at,issued_by_user_id,supersedes_invitation_id)
     VALUES($1,$2,$3,$4,now()+($5::text||' hours')::interval,$6,$7)
     RETURNING id,workspace_id,membership_id,user_id,status,expires_at`,
    [member.workspace_id, membershipId, member.user_id, tokenHash(token), expiresInHours, operatorId, supersedes]
  );
  const row = inserted.rows[0];
  if (!row) throw new OnboardingInvitationError('conflict');
  await client.query('INSERT INTO onboarding_invitation_deliveries(invitation_id) VALUES($1)', [row.id]);
  await audit(client, row, operatorId, 'onboarding.invitation.issued', 'none', 'Issued');
  return { invitationId: row.id, membershipId, workspaceId: row.workspace_id, expiresAt: row.expires_at, token };
}

export function issueOnboardingInvitation(membershipId: string, expiresInHours: number, operatorId: string) {
  return withTransaction((client) => issueWithClient(client, membershipId, expiresInHours, operatorId, null));
}

export function revokeOnboardingInvitation(invitationId: string, operatorId: string) {
  return withTransaction(async (client) => {
    const result = await client.query<InvitationRow>(
      `SELECT id,workspace_id,membership_id,user_id,status,expires_at FROM onboarding_invitations WHERE id=$1 FOR UPDATE`, [invitationId]
    );
    const row = result.rows[0];
    if (!row) throw new OnboardingInvitationError('not_found');
    if (row.status !== 'Issued') throw new OnboardingInvitationError('conflict');
    await client.query(
      `UPDATE onboarding_invitations SET status='Revoked',revoked_at=now(),revoked_by_user_id=$2,updated_at=now() WHERE id=$1`,
      [row.id, operatorId]
    );
    await audit(client, row, operatorId, 'onboarding.invitation.revoked', 'Issued', 'Revoked');
    return { invitationId: row.id, status: 'Revoked' as const };
  });
}

export function reissueOnboardingInvitation(invitationId: string, expiresInHours: number, operatorId: string) {
  return withTransaction(async (client) => {
    const result = await client.query<InvitationRow>(
      `SELECT id,workspace_id,membership_id,user_id,status,expires_at FROM onboarding_invitations WHERE id=$1 FOR UPDATE`, [invitationId]
    );
    const row = result.rows[0];
    if (!row) throw new OnboardingInvitationError('not_found');
    if (row.status !== 'Issued' && row.status !== 'Expired' && row.status !== 'Revoked') throw new OnboardingInvitationError('conflict');
    if (row.status === 'Issued') {
      await client.query(`UPDATE onboarding_invitations SET status='Revoked',revoked_at=now(),revoked_by_user_id=$2,updated_at=now() WHERE id=$1`, [row.id, operatorId]);
      await audit(client, row, operatorId, 'onboarding.invitation.revoked', 'Issued', 'Revoked');
    }
    return issueWithClient(client, row.membership_id, expiresInHours, operatorId, row.id);
  });
}

export function acceptOnboardingInvitation(token: string) {
  return withTransaction(async (client) => {
    const result = await client.query<InvitationRow>(
      `SELECT id,workspace_id,membership_id,user_id,status,expires_at FROM onboarding_invitations WHERE token_hash=$1 FOR UPDATE`, [tokenHash(token)]
    );
    const row = result.rows[0];
    if (!row) throw new OnboardingInvitationError('not_found');
    if (row.status !== 'Issued') throw new OnboardingInvitationError('conflict');
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await client.query(`UPDATE onboarding_invitations SET status='Expired',updated_at=now() WHERE id=$1`, [row.id]);
      await audit(client, row, null, 'onboarding.invitation.expired', 'Issued', 'Expired');
      return { invitationId: row.id, workspaceId: row.workspace_id, membershipId: row.membership_id, status: 'Expired' as const };
    }
    const membership = await client.query<{ status: string; user_id: string; workspace_id: string }>(
      `SELECT status,user_id,workspace_id FROM workspace_users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [row.membership_id]
    );
    const member = membership.rows[0];
    if (!member || member.status !== 'Invited' || member.user_id !== row.user_id || member.workspace_id !== row.workspace_id) {
      throw new OnboardingInvitationError('conflict');
    }
    await client.query(`UPDATE workspace_users SET status='Active',updated_at=now() WHERE id=$1`, [row.membership_id]);
    await client.query(`UPDATE onboarding_invitations SET status='Accepted',accepted_at=now(),updated_at=now() WHERE id=$1`, [row.id]);
    await audit(client, row, row.user_id, 'onboarding.invitation.accepted', 'Issued', 'Accepted');
    return { invitationId: row.id, workspaceId: row.workspace_id, membershipId: row.membership_id, status: 'Accepted' as const };
  });
}

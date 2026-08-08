import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTransaction } from '../db/transaction';
import type { IntakeProvisioningCommand } from '../validation/schemas/intake-provisioning.schemas';

const SOURCE_SYSTEM = 'phoenix_public_intake';

export class IntakeProvisioningConflictError extends Error {
  constructor(public readonly reason: 'fingerprint' | 'service_account' | 'membership' | 'identifier_exhausted') {
    super('The intake request cannot be provisioned in its current state.');
    this.name = 'IntakeProvisioningConflictError';
  }
}

export interface IntakeProvisioningResult {
  outcome: 'created' | 'replayed';
  handoffId: string;
  organizationId: string;
  workspaceId: string;
  primaryUserId: string;
  membershipId: string;
  assessmentId: null;
}

interface HandoffRow {
  id: string;
  source_payload_fingerprint: string;
  status: 'Processing' | 'Completed';
  organization_id: string | null;
  workspace_id: string | null;
  primary_user_id: string | null;
  membership_id: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function fingerprintIntakeProvisioningCommand(command: IntakeProvisioningCommand): string {
  return sha256(JSON.stringify({
    sourceReference: command.sourceReference.trim(),
    sourceStatus: command.sourceStatus.trim(),
    requestType: command.requestType,
    company: command.company.trim(),
    firstName: command.firstName.trim(),
    lastName: command.lastName.trim(),
    workEmail: command.workEmail.trim().toLowerCase(),
  }));
}

function sourceHash(sourceKey: string, attempt: number): string {
  return sha256(attempt === 0 ? sourceKey : `${sourceKey}:${attempt}`);
}

async function createOrganization(client: PoolClient, command: IntakeProvisioningCommand, sourceKey: string): Promise<string> {
  for (let attempt = 0; attempt <= 16; attempt += 1) {
    const orgCode = `PHX${sourceHash(sourceKey, attempt).slice(0, 9).toUpperCase()}`;
    const result = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, org_code, primary_contact_email, industry)
       VALUES ($1, $2, $3, NULL) ON CONFLICT DO NOTHING RETURNING id`,
      [command.company, orgCode, command.workEmail]
    );
    if (result.rows[0]) return result.rows[0].id;
  }
  throw new IntakeProvisioningConflictError('identifier_exhausted');
}

function companyStem(company: string): string {
  const stem = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  return stem || 'workspace';
}

async function createWorkspace(client: PoolClient, organizationId: string, company: string, sourceKey: string): Promise<string> {
  for (let attempt = 0; attempt <= 16; attempt += 1) {
    const slug = `${companyStem(company)}-${sourceHash(sourceKey, attempt).slice(0, 8)}`;
    const result = await client.query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`,
      [organizationId, `${company} Private Beta`, slug]
    );
    if (result.rows[0]) return result.rows[0].id;
  }
  throw new IntakeProvisioningConflictError('identifier_exhausted');
}

async function resolvePrimaryUser(client: PoolClient, command: IntakeProvisioningCommand): Promise<string> {
  const existing = await client.query<{ id: string; platform_role: string }>(
    `SELECT id, platform_role FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [command.workEmail]
  );
  if (existing.rows[0]) {
    if (existing.rows[0].platform_role === 'ServiceAccount') throw new IntakeProvisioningConflictError('service_account');
    return existing.rows[0].id;
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO users (email, display_name, platform_role, avatar_url, last_login_at)
     VALUES ($1, $2, 'StandardUser', NULL, NULL)
     ON CONFLICT DO NOTHING RETURNING id`,
    [command.workEmail, `${command.firstName} ${command.lastName}`]
  );
  if (created.rows[0]) return created.rows[0].id;

  const winner = await client.query<{ id: string; platform_role: string }>(
    `SELECT id, platform_role FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [command.workEmail]
  );
  if (!winner.rows[0] || winner.rows[0].platform_role === 'ServiceAccount') {
    throw new IntakeProvisioningConflictError('service_account');
  }
  return winner.rows[0].id;
}

export async function provisionIntakeWorkspace(
  command: IntakeProvisioningCommand,
  operatorUserId: string
): Promise<IntakeProvisioningResult> {
  const normalized = { ...command, workEmail: command.workEmail.toLowerCase() };
  const fingerprint = fingerprintIntakeProvisioningCommand(normalized);
  const sourceKey = `${SOURCE_SYSTEM}:${normalized.sourceReference}`;

  return withTransaction(async (client) => {
    const inserted = await client.query<HandoffRow>(
      `INSERT INTO intake_workspace_handoffs
       (source_system, source_reference, source_request_type, source_payload_fingerprint, status, created_by_user_id)
       VALUES ($1, $2, $3, $4, 'Processing', $5)
       ON CONFLICT DO NOTHING
       RETURNING id, source_payload_fingerprint, status, organization_id, workspace_id, primary_user_id, membership_id`,
      [SOURCE_SYSTEM, normalized.sourceReference, normalized.requestType, fingerprint, operatorUserId]
    );

    let handoff = inserted.rows[0];
    if (!handoff) {
      const existing = await client.query<HandoffRow>(
        `SELECT id, source_payload_fingerprint, status, organization_id, workspace_id, primary_user_id, membership_id
         FROM intake_workspace_handoffs WHERE source_system = $1 AND source_reference = $2 FOR UPDATE`,
        [SOURCE_SYSTEM, normalized.sourceReference]
      );
      handoff = existing.rows[0];
      if (!handoff || handoff.source_payload_fingerprint !== fingerprint) throw new IntakeProvisioningConflictError('fingerprint');
      if (handoff.status === 'Completed' && handoff.organization_id && handoff.workspace_id && handoff.primary_user_id && handoff.membership_id) {
        return {
          outcome: 'replayed', handoffId: handoff.id, organizationId: handoff.organization_id,
          workspaceId: handoff.workspace_id, primaryUserId: handoff.primary_user_id,
          membershipId: handoff.membership_id, assessmentId: null,
        };
      }
      throw new IntakeProvisioningConflictError('fingerprint');
    }

    const organizationId = await createOrganization(client, normalized, sourceKey);
    const workspaceId = await createWorkspace(client, organizationId, normalized.company, sourceKey);
    const primaryUserId = await resolvePrimaryUser(client, normalized);
    const membership = await client.query<{ id: string }>(
      `INSERT INTO workspace_users (workspace_id, user_id, role, status, invited_by_user_id)
       VALUES ($1, $2, 'Owner', 'Invited', $3) ON CONFLICT DO NOTHING RETURNING id`,
      [workspaceId, primaryUserId, operatorUserId]
    );
    if (!membership.rows[0]) throw new IntakeProvisioningConflictError('membership');

    await client.query(
      `INSERT INTO audit_records (workspace_id, actor_user_id, action, entity_type, entity_id, changes, context)
       VALUES ($1, $2, 'workspace.provisioned_from_intake', 'Workspace', $1, $3::jsonb, $4)`,
      [workspaceId, operatorUserId, JSON.stringify({ status: [null, 'provisioned'] }), JSON.stringify({
        sourceSystem: SOURCE_SYSTEM, sourceReference: normalized.sourceReference, requestType: normalized.requestType,
      })]
    );

    await client.query(
      `UPDATE intake_workspace_handoffs SET status = 'Completed', organization_id = $2, workspace_id = $3,
       primary_user_id = $4, membership_id = $5, completed_at = now(), updated_at = now() WHERE id = $1`,
      [handoff.id, organizationId, workspaceId, primaryUserId, membership.rows[0].id]
    );

    return {
      outcome: 'created', handoffId: handoff.id, organizationId, workspaceId,
      primaryUserId, membershipId: membership.rows[0].id, assessmentId: null,
    };
  });
}

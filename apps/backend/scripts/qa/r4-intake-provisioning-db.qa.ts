import { getDatabasePool, closeDatabasePool } from '../../src/db/client';
import {
  IntakeProvisioningConflictError,
  provisionIntakeWorkspace,
} from '../../src/services/intake-workspace-provisioning.service';

const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';
let passed = 0;
function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

async function count(table: string): Promise<number> {
  const allowed = new Set(['organizations', 'workspaces', 'users', 'workspace_users', 'audit_records', 'intake_workspace_handoffs']);
  if (!allowed.has(table)) throw new Error('Invalid QA table.');
  const result = await getDatabasePool().query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table}`);
  return Number(result.rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const pool = getDatabasePool();
  await pool.query(
    `INSERT INTO users (id, email, display_name, platform_role)
     VALUES ($1, 'operator@r4.qa', 'R4 Operator', 'SuperAdmin')`,
    [OPERATOR_ID]
  );

  const command = {
    sourceReference: 'PHX-R4-QA-001', sourceStatus: 'accepted', requestType: 'assessment' as const,
    company: 'R4 Example Company', firstName: 'Primary', lastName: 'Owner', workEmail: 'owner@r4.qa',
  };
  const created = await provisionIntakeWorkspace(command, OPERATOR_ID);
  check(created.outcome === 'created', 'first command creates the handoff');
  check(created.assessmentId === null, 'assessment creation remains deferred');

  const membership = await pool.query<{ role: string; status: string; invited_by_user_id: string }>(
    'SELECT role, status, invited_by_user_id FROM workspace_users WHERE id = $1', [created.membershipId]
  );
  check(membership.rows[0]?.role === 'Owner' && membership.rows[0]?.status === 'Invited', 'primary membership is invited Owner');
  check(membership.rows[0]?.invited_by_user_id === OPERATOR_ID, 'membership attribution uses the authenticated operator');

  const audit = await pool.query<{ action: string; context: string }>(
    'SELECT action, context FROM audit_records WHERE workspace_id = $1', [created.workspaceId]
  );
  check(audit.rows.length === 1 && audit.rows[0]?.action === 'workspace.provisioned_from_intake', 'one provisioning audit record commits');
  check(Object.keys(JSON.parse(audit.rows[0]?.context ?? '{}')).sort().join(',') === 'requestType,sourceReference,sourceSystem', 'audit context contains exactly the approved source fields');

  const beforeReplay = await Promise.all(['organizations', 'workspaces', 'users', 'workspace_users', 'audit_records'].map(count));
  const replayed = await provisionIntakeWorkspace(command, OPERATOR_ID);
  const afterReplay = await Promise.all(['organizations', 'workspaces', 'users', 'workspace_users', 'audit_records'].map(count));
  check(replayed.outcome === 'replayed' && replayed.workspaceId === created.workspaceId, 'same fingerprint replays stored identifiers');
  check(JSON.stringify(beforeReplay) === JSON.stringify(afterReplay), 'replay creates no tenant or audit records');

  let fingerprintConflict = false;
  try {
    await provisionIntakeWorkspace({ ...command, company: 'Changed Company' }, OPERATOR_ID);
  } catch (error) {
    fingerprintConflict = error instanceof IntakeProvisioningConflictError && error.reason === 'fingerprint';
  }
  check(fingerprintConflict, 'different payload for one source returns fingerprint conflict');

  await pool.query(
    `INSERT INTO users (email, display_name, platform_role) VALUES ('service@r4.qa', 'R4 Service', 'ServiceAccount')`
  );
  const handoffsBeforeRollback = await count('intake_workspace_handoffs');
  const organizationsBeforeRollback = await count('organizations');
  let serviceConflict = false;
  try {
    await provisionIntakeWorkspace({ ...command, sourceReference: 'PHX-R4-QA-SERVICE', workEmail: 'service@r4.qa' }, OPERATOR_ID);
  } catch (error) {
    serviceConflict = error instanceof IntakeProvisioningConflictError && error.reason === 'service_account';
  }
  check(serviceConflict, 'ServiceAccount cannot become customer Owner');
  check(await count('intake_workspace_handoffs') === handoffsBeforeRollback && await count('organizations') === organizationsBeforeRollback,
    'ServiceAccount conflict rolls back ledger and tenant writes');

  const concurrent = { ...command, sourceReference: 'PHX-R4-QA-CONCURRENT', workEmail: 'concurrent@r4.qa' };
  const results = await Promise.all([
    provisionIntakeWorkspace(concurrent, OPERATOR_ID),
    provisionIntakeWorkspace(concurrent, OPERATOR_ID),
  ]);
  check(results.map((result) => result.outcome).sort().join(',') === 'created,replayed', 'concurrent duplicate has one creator and one replay');
  check(results[0].workspaceId === results[1].workspaceId, 'concurrent duplicate returns one workspace identity');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed.`);
  // eslint-disable-next-line no-console
  console.log('RESULT: PHX-LAUNCH-002-R4 DATABASE TRANSACTION QA PASSED');
}

void main().finally(() => closeDatabasePool());

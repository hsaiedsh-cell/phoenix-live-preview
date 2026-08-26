import { getDatabasePool, closeDatabasePool } from '../../src/db/client';

let passed = 0;
function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

async function rejects(statement: string, values: unknown[] = []): Promise<boolean> {
  try {
    await getDatabasePool().query(statement, values);
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  const pool = getDatabasePool();
  const operator = '11111111-1111-4111-8111-111111111111';
  const customer = '22222222-2222-4222-8222-222222222222';
  await pool.query(`INSERT INTO users (id,email,display_name,platform_role) VALUES
    ($1,'operator@r5.qa','Operator','SuperAdmin'),($2,'customer@r5.qa','Customer','StandardUser')`, [operator, customer]);
  const org = await pool.query<{ id: string }>("INSERT INTO organizations(name,org_code) VALUES('R5 QA','PHXR5QA00001') RETURNING id");
  const workspace = await pool.query<{ id: string }>("INSERT INTO workspaces(organization_id,name,slug) VALUES($1,'R5 QA','r5-qa') RETURNING id", [org.rows[0]?.id]);
  const membership = await pool.query<{ id: string }>("INSERT INTO workspace_users(workspace_id,user_id,role,status,invited_by_user_id) VALUES($1,$2,'Owner','Invited',$3) RETURNING id", [workspace.rows[0]?.id, customer, operator]);
  const hashOne = 'a'.repeat(64);
  const invitation = await pool.query<{ id: string }>(
    `INSERT INTO onboarding_invitations(workspace_id,membership_id,user_id,token_hash,expires_at,issued_by_user_id)
     VALUES($1,$2,$3,$4,now()+interval '24 hours',$5) RETURNING id`,
    [workspace.rows[0]?.id, membership.rows[0]?.id, customer, hashOne, operator]
  );
  check(Boolean(invitation.rows[0]?.id), 'invitation starts in Issued state');
  await pool.query('INSERT INTO onboarding_invitation_deliveries(invitation_id) VALUES($1)', [invitation.rows[0]?.id]);
  check((await pool.query("SELECT 1 FROM onboarding_invitation_deliveries WHERE invitation_id=$1 AND status='Pending'", [invitation.rows[0]?.id])).rowCount === 1,
    'issuance can create one pending delivery record');
  check(await rejects(
    `INSERT INTO onboarding_invitations(workspace_id,membership_id,user_id,token_hash,expires_at,issued_by_user_id)
     VALUES($1,$2,$3,$4,now()+interval '24 hours',$5)`,
    [workspace.rows[0]?.id, membership.rows[0]?.id, customer, 'b'.repeat(64), operator]
  ), 'one membership cannot have two live invitations');
  check(await rejects("UPDATE onboarding_invitations SET token_hash=$2 WHERE id=$1", [invitation.rows[0]?.id, 'c'.repeat(64)]),
    'token hash is immutable');
  await pool.query("UPDATE onboarding_invitations SET status='Accepted',accepted_at=now(),updated_at=now() WHERE id=$1", [invitation.rows[0]?.id]);
  check(await rejects("UPDATE onboarding_invitations SET status='Revoked',accepted_at=NULL,revoked_at=now(),revoked_by_user_id=$2 WHERE id=$1", [invitation.rows[0]?.id, operator]),
    'accepted invitation is terminal');
  check(await rejects('DELETE FROM onboarding_invitations WHERE id=$1', [invitation.rows[0]?.id]), 'invitation evidence cannot be deleted');
  check(await rejects(
    `INSERT INTO onboarding_invitations(workspace_id,membership_id,user_id,token_hash,expires_at,issued_by_user_id)
     VALUES($1,$2,$3,'not-a-hash',now()+interval '24 hours',$4)`,
    [workspace.rows[0]?.id, membership.rows[0]?.id, customer, operator]
  ), 'raw or malformed tokens cannot be persisted as token hashes');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed.`);
  // eslint-disable-next-line no-console
  console.log('RESULT: PHX-LAUNCH-002-R5 INVITATION SCHEMA QA PASSED');
}

void main().finally(() => closeDatabasePool());

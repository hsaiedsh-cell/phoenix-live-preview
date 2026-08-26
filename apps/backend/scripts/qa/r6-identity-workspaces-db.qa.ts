import { closeDatabasePool, getDatabasePool } from '../../src/db/client';
import { listActiveWorkspacesForUser } from '../../src/repositories/auth.repository';

let passed = 0;
function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

async function main(): Promise<void> {
  const pool = getDatabasePool();
  const user = await pool.query<{ id: string }>("INSERT INTO users(email,display_name,platform_role) VALUES('r6@qa.test','R6 User','StandardUser') RETURNING id");
  const org = await pool.query<{ id: string }>("INSERT INTO organizations(name,org_code) VALUES('R6','PHXR6QA00001') RETURNING id");
  for (const [name, status, deleted] of [['Active','Active',false],['Invited','Invited',false],['Suspended','Suspended',false],['Deleted','Active',true]] as const) {
    const workspace = await pool.query<{ id: string }>('INSERT INTO workspaces(organization_id,name,slug,deleted_at) VALUES($1,$2,$3,$4) RETURNING id',
      [org.rows[0]?.id, name, `r6-${name.toLowerCase()}`, deleted ? new Date() : null]);
    await pool.query('INSERT INTO workspace_users(workspace_id,user_id,role,status) VALUES($1,$2,\'Owner\',$3)',
      [workspace.rows[0]?.id, user.rows[0]?.id, status]);
  }
  const result = await listActiveWorkspacesForUser(user.rows[0]!.id);
  check(result.length === 1 && result[0]?.name === 'Active', 'only Active membership in a live workspace resolves');
  check(result[0]?.role === 'Owner', 'resolved membership returns the database-owned role');
  check(!JSON.stringify(result).includes('email') && !JSON.stringify(result).includes('userId'), 'response projection excludes identity data');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed.`);
  // eslint-disable-next-line no-console
  console.log('RESULT: PHX-LAUNCH-002-R6 IDENTITY WORKSPACE RESOLUTION QA PASSED');
}

void main().finally(() => closeDatabasePool());

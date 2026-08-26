import { closeDatabasePool, getDatabasePool } from '../../src/db/client';

const BACKEND_TABLES = [
  'activity_logs',
  'assessment_steps',
  'assessments',
  'asset_versions',
  'assets',
  'audit_records',
  'auth_identities',
  'departments',
  'derived_signals',
  'evidence_items',
  'intake_workspace_handoffs',
  'integrations',
  'notifications',
  'onboarding_invitation_deliveries',
  'onboarding_invitations',
  'organizations',
  'pbrs_certifications',
  'pbrs_dimension_scores',
  'pbrs_passports',
  'pbrs_scores',
  'report_artifacts',
  'report_generation_jobs',
  'report_templates',
  'reports',
  'users',
  'workspace_users',
  'workspaces',
] as const;

let passed = 0;
function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

async function main(): Promise<void> {
  const pool = getDatabasePool();
  const rls = await pool.query<{ relname: string; relrowsecurity: boolean }>(
    `SELECT c.relname, c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname`,
    [BACKEND_TABLES]
  );

  check(rls.rows.length === BACKEND_TABLES.length, 'all Backend tables are present');
  check(rls.rows.every((row) => row.relrowsecurity), 'RLS is enabled on every Backend table');

  const exposedRoles = await pool.query<{ rolname: string }>(
    `SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname`
  );
  for (const { rolname } of exposedRoles.rows) {
    const grants = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM information_schema.role_table_grants
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
          AND grantee = $2`,
      [BACKEND_TABLES, rolname]
    );
    check(grants.rows[0]?.count === '0', `${rolname} has no Backend table grants`);
  }

  const functions = await pool.query<{ proname: string; search_path: string | null }>(
    `SELECT p.proname,
            (SELECT setting FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) setting
              WHERE setting LIKE 'search_path=%') AS search_path
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'enforce_intake_workspace_handoff_immutability',
          'enforce_onboarding_invitation_lifecycle'
        )
      ORDER BY p.proname`
  );
  check(functions.rows.length === 2, 'both trigger functions are present');
  check(
    functions.rows.every((row) => row.search_path === 'search_path=pg_catalog, public'),
    'both trigger functions use the fixed pg_catalog/public search path'
  );

  await pool.query('SELECT count(*) FROM organizations');
  check(true, 'the database owner connection still reads Backend tables');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed.`);
  // eslint-disable-next-line no-console
  console.log('RESULT: PHX-LAUNCH-002-R8 POSTGREST SECURITY QA PASSED');
}

void main().finally(() => closeDatabasePool());

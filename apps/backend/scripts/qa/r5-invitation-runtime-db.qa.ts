import { closeDatabasePool, getDatabasePool } from '../../src/db/client';
import {
  acceptOnboardingInvitation,
  issueOnboardingInvitation,
  reissueOnboardingInvitation,
  revokeOnboardingInvitation,
} from '../../src/services/onboarding-invitation.service';
import { deliverOnboardingInvitation } from '../../src/services/onboarding-invitation-delivery.service';

const OPERATOR = '11111111-1111-4111-8111-111111111111';
let passed = 0;
function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

async function fixture(suffix: string): Promise<string> {
  const pool = getDatabasePool();
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users(email,display_name,platform_role) VALUES($1,$2,'StandardUser') RETURNING id`, [`${suffix}@r5.qa`, suffix]
  );
  const org = await pool.query<{ id: string }>(`INSERT INTO organizations(name,org_code) VALUES($1,$2) RETURNING id`, [suffix, `PHX${suffix.padEnd(9, '0').slice(0, 9).toUpperCase()}`]);
  const workspace = await pool.query<{ id: string }>(`INSERT INTO workspaces(organization_id,name,slug) VALUES($1,$2,$3) RETURNING id`, [org.rows[0]?.id, suffix, suffix]);
  const membership = await pool.query<{ id: string }>(
    `INSERT INTO workspace_users(workspace_id,user_id,role,status,invited_by_user_id) VALUES($1,$2,'Owner','Invited',$3) RETURNING id`,
    [workspace.rows[0]?.id, user.rows[0]?.id, OPERATOR]
  );
  return membership.rows[0]!.id;
}

async function main(): Promise<void> {
  const pool = getDatabasePool();
  await pool.query(`INSERT INTO users(id,email,display_name,platform_role) VALUES($1,'operator@r5runtime.qa','Operator','SuperAdmin')`, [OPERATOR]);

  const membershipId = await fixture('acceptqa');
  const issued = await issueOnboardingInvitation(membershipId, 24, OPERATOR);
  check(issued.token.length >= 40, 'issuance returns one high-entropy delivery token');
  const persisted = await pool.query<{ token_hash: string }>('SELECT token_hash FROM onboarding_invitations WHERE id=$1', [issued.invitationId]);
  check(persisted.rows[0]?.token_hash !== issued.token && persisted.rows[0]?.token_hash.length === 64, 'database stores only the token hash');
  let deliveredUrl = '';
  process.env.PHOENIX_ONBOARDING_APP_BASE_URL = 'https://platform.example.test';
  const delivery = await deliverOnboardingInvitation(issued, {
    async send(input) { deliveredUrl = input.acceptUrl; return { ok: true, providerCode: 'fake' }; },
  });
  check(delivery.status === 'Sent' && deliveredUrl.includes('#token=') && !deliveredUrl.includes('?token='),
    'delivery sends the token in a URL fragment, never a query string');
  check((await pool.query<{ status: string }>('SELECT status FROM onboarding_invitation_deliveries WHERE invitation_id=$1', [issued.invitationId])).rows[0]?.status === 'Sent',
    'successful provider call commits bounded Sent state');
  const accepted = await acceptOnboardingInvitation(issued.token);
  check(accepted.status === 'Accepted', 'valid token is accepted');
  check((await pool.query<{ status: string }>('SELECT status FROM workspace_users WHERE id=$1', [membershipId])).rows[0]?.status === 'Active',
    'acceptance activates membership atomically');

  const revokeMembership = await fixture('revokeqa');
  const revokeIssued = await issueOnboardingInvitation(revokeMembership, 24, OPERATOR);
  const revoked = await revokeOnboardingInvitation(revokeIssued.invitationId, OPERATOR);
  check(revoked.status === 'Revoked', 'operator can revoke a live invitation');

  const reissueMembership = await fixture('reissueqa');
  const first = await issueOnboardingInvitation(reissueMembership, 24, OPERATOR);
  const second = await reissueOnboardingInvitation(first.invitationId, 48, OPERATOR);
  check(first.token !== second.token && first.invitationId !== second.invitationId, 'reissue rotates token and invitation identity');
  const chain = await pool.query<{ supersedes_invitation_id: string }>('SELECT supersedes_invitation_id FROM onboarding_invitations WHERE id=$1', [second.invitationId]);
  check(chain.rows[0]?.supersedes_invitation_id === first.invitationId, 'reissue preserves the audit chain');

  const expiryMembership = await fixture('expiryqa');
  const expiring = await issueOnboardingInvitation(expiryMembership, 0.000001, OPERATOR);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const expired = await acceptOnboardingInvitation(expiring.token);
  check(expired.status === 'Expired', 'database-time expiry rejects acceptance');
  check((await pool.query<{ status: string }>('SELECT status FROM onboarding_invitations WHERE id=$1', [expiring.invitationId])).rows[0]?.status === 'Expired',
    'expiry evidence commits instead of rolling back');
  check((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM audit_records WHERE action LIKE 'onboarding.invitation.%'", [])).rows[0]?.count === '9',
    'issuance, acceptance, revocation, reissue, and expiry are audited');

  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed.`);
  // eslint-disable-next-line no-console
  console.log('RESULT: PHX-LAUNCH-002-R5 INVITATION RUNTIME DATABASE QA PASSED');
}

void main().finally(() => closeDatabasePool());

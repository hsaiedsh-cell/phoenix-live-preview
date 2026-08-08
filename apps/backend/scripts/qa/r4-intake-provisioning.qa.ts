import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IntakeProvisioningBodySchema } from '../../src/validation/schemas/intake-provisioning.schemas';
import { fingerprintIntakeProvisioningCommand } from '../../src/services/intake-workspace-provisioning.service';

let passed = 0;
function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

const valid = {
  sourceReference: 'PHX-REQ-EXAMPLE', sourceStatus: 'accepted', requestType: 'assessment' as const,
  company: 'Example Company', firstName: 'Example', lastName: 'Owner', workEmail: 'owner@example.com',
};

const parsed = IntakeProvisioningBodySchema.safeParse(valid);
check(parsed.success, 'canonical provisioning command is accepted');
check(!IntakeProvisioningBodySchema.safeParse({ ...valid, operatorUserId: '11111111-1111-4111-8111-111111111111' }).success,
  'client-supplied operator attribution is rejected');
check(!IntakeProvisioningBodySchema.safeParse({ ...valid, workspaceId: '11111111-1111-4111-8111-111111111111' }).success,
  'client-supplied target identifiers are rejected');

if (!parsed.success) throw new Error('Canonical fixture failed.');
const fingerprint = fingerprintIntakeProvisioningCommand(parsed.data);
check(/^[0-9a-f]{64}$/.test(fingerprint), 'fingerprint is lowercase SHA-256');
check(fingerprint === fingerprintIntakeProvisioningCommand({ ...parsed.data }), 'fingerprint is deterministic');
check(fingerprint !== fingerprintIntakeProvisioningCommand({ ...parsed.data, company: 'Different Company' }),
  'business payload changes alter the fingerprint');

const service = readFileSync(resolve(process.cwd(), 'src/services/intake-workspace-provisioning.service.ts'), 'utf8');
const route = readFileSync(resolve(process.cwd(), 'src/routes/intake-provisioning.ts'), 'utf8');
check(service.includes('return withTransaction(async (client) =>'), 'all provisioning writes share one transaction');
check(service.includes('ON CONFLICT DO NOTHING') && service.includes('FOR UPDATE'), 'source claim and duplicate replay serialize in PostgreSQL');
check(service.includes("outcome: 'replayed'") && service.indexOf("outcome: 'replayed'") < service.indexOf('await createOrganization(client'),
  'completed replay returns before tenant creation');
check(service.includes("'Owner', 'Invited'") && service.includes('invited_by_user_id'), 'initial membership is invited Owner attributed to the operator');
check(service.includes("'workspace.provisioned_from_intake'") && service.indexOf("'workspace.provisioned_from_intake'") < service.indexOf("status = 'Completed'"),
  'minimal audit is appended before ledger completion');
check(!service.includes('INTAKE_DATABASE_URL') && !service.includes('fetch('), 'provisioning never reaches the Website database or network');
check(route.indexOf('requirePlatformSuperAdmin') < route.indexOf('IntakeProvisioningBodySchema.safeParse'),
  'SuperAdmin authorization precedes request validation');
check(route.includes("parsed.data.sourceStatus !== 'accepted'") && route.includes('res.status(422)'),
  'non-accepted source status maps to 422');
check(!route.includes('requirePermission') && !route.includes('workspaceId'), 'route does not use workspace membership authorization');

// eslint-disable-next-line no-console
console.log(`\n${passed} passed.`);
// eslint-disable-next-line no-console
console.log('RESULT: PHX-LAUNCH-002-R4 INTAKE WORKSPACE PROVISIONING QA PASSED');

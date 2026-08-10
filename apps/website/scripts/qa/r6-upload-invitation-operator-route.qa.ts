import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

const root = resolve(__dirname, '../..');
const route = readFileSync(
  resolve(root, 'src/app/api/internal/operations/intake-requests/[requestId]/upload-invitation/route.ts'),
  'utf8'
);
const service = readFileSync(resolve(root, 'src/lib/intake/upload-session.service.ts'), 'utf8');

check(route.includes('isValidIntakeServiceRequest(request)'), 'route requires the dedicated Website service credential');
check(route.includes('getIntakeServiceActorUserId(request)'), 'route requires database-derived actor attribution');
check(route.includes('internalRequestIdSchema.safeParse'), 'route validates the intake request UUID');
check(route.includes('issueUploadSession(parsedRequestId.data, actorUserId)'), 'route passes only validated identifiers to the issuance service');
check(route.includes("outcome.kind === 'session_already_active'"), 'route rejects duplicate active invitations');
check(route.includes("status: 'upload_invited'") && route.includes('emailSent: outcome.emailSent'), 'route returns bounded delivery metadata');
check(!route.includes('rawToken') && !route.includes('uploadUrl'), 'route never exposes the raw upload token or URL');
check(service.includes("actorUserId, source: 'phoenix_backend'"), 'operator-attributed issuance is recorded in the audit detail');

// eslint-disable-next-line no-console
console.log(`\n${passed} passed.`);
// eslint-disable-next-line no-console
console.log('RESULT: PHX-LAUNCH-002-R6 OPERATOR UPLOAD INVITATION QA PASSED');

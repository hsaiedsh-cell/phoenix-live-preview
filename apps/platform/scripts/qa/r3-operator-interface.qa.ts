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
const component = readFileSync(resolve(root, 'src/components/IntakeOperationsClient.tsx'), 'utf8');
const client = readFileSync(resolve(root, 'src/lib/real-api-client.client.ts'), 'utf8');
const page = readFileSync(resolve(root, 'src/app/(platform)/operations/intake-requests/page.tsx'), 'utf8');
const sidebar = readFileSync(resolve(root, 'src/components/PlatformSidebar.tsx'), 'utf8');
const apiConfig = readFileSync(resolve(root, 'src/lib/api-config.ts'), 'utf8');
const clientAuth = readFileSync(resolve(root, 'src/lib/auth/platform-auth.client.ts'), 'utf8');

check(client.includes("clientPost('/api/operations/intake-requests/query', input)"), 'queue uses the protected Backend POST route');
check(client.includes('/api/operations/intake-requests/${encodeURIComponent(requestId)}'), 'detail uses an encoded fixed Backend path');
check(client.includes('/actions`, { action }'), 'action body contains only the action property');
check(!component.includes('actorUserId') && !component.includes('platformRole'), 'browser UI cannot supply actor or platform-role claims');
check(!component.includes('INTAKE_SERVICE_SECRET') && !client.includes('INTAKE_SERVICE_SECRET'), 'Platform contains no Website service credential');
check(component.includes('window.confirm'), 'actions require explicit operator confirmation');
check(component.includes('await realGetIntakeRequestDetail(selected.requestId)'), 'successful action refreshes authoritative detail');
check(page.includes("config.mode === 'real-dev' || config.mode === 'production-auth'"), 'operator interface is limited to approved real API modes');
check(page.includes('never falls back to mock customer data'), 'unsupported modes disclose the no-mock boundary');
check(sidebar.includes("href: '/operations/intake-requests'"), 'protected operator route is registered in navigation');
check(!component.includes('console.log') && !component.includes('console.error'), 'operator UI logs no customer data or bodies');
check(!apiConfig.includes('const value = process.env[name]'), 'browser API config does not use unsupported dynamic env access');
check(
  apiConfig.includes('process.env.NEXT_PUBLIC_PHOENIX_API_MODE') &&
    apiConfig.includes('process.env.NEXT_PUBLIC_PHOENIX_BACKEND_URL'),
  'browser API mode and Backend URL use statically replaceable Next.js env references'
);
check(
  clientAuth.includes("session.getToken({ template: 'phoenix-backend' })"),
  'browser auth requests the audience-bound Clerk JWT template'
);
check(
  clientAuth.includes('await waitForClerkClient(clerkWindow)'),
  'browser auth waits for Clerk readiness before reading the session'
);

// eslint-disable-next-line no-console
console.log(`\n${passed} passed.`);
// eslint-disable-next-line no-console
console.log('RESULT: PHX-LAUNCH-002-R3 PROTECTED OPERATOR INTERFACE QA PASSED');

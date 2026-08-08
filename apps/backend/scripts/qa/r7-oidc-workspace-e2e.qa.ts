import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

let passed = 0;
function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('QA server failed to bind.');
  return address.port;
}

async function main(): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'r7-key', alg: 'RS256', use: 'sig' });
  const jwks = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  const jwksPort = await listen(jwks);
  const issuer = `http://127.0.0.1:${jwksPort}`;
  process.env.PHOENIX_AUTH_MODE = 'oidc-jwt';
  process.env.PHOENIX_AUTH_ISSUER = issuer;
  process.env.PHOENIX_AUTH_AUDIENCE = 'phoenix-backend';
  process.env.PHOENIX_AUTH_JWKS_URI = `${issuer}/.well-known/jwks.json`;
  process.env.PHOENIX_AUTH_PROVIDER = 'clerk';

  const [{ createServer: createBackend }, { getDatabasePool, closeDatabasePool }] = await Promise.all([
    import('../../src/server'), import('../../src/db/client'),
  ]);
  const pool = getDatabasePool();
  const user = await pool.query<{ id: string }>("INSERT INTO users(email,display_name,platform_role) VALUES('r7@qa.test','R7 User','StandardUser') RETURNING id");
  const org = await pool.query<{ id: string }>("INSERT INTO organizations(name,org_code) VALUES('R7','PHXR7QA00001') RETURNING id");
  const workspace = await pool.query<{ id: string }>("INSERT INTO workspaces(organization_id,name,slug) VALUES($1,'R7 Workspace','r7-workspace') RETURNING id", [org.rows[0]?.id]);
  await pool.query("INSERT INTO workspace_users(workspace_id,user_id,role,status) VALUES($1,$2,'Viewer','Active')", [workspace.rows[0]?.id, user.rows[0]?.id]);
  await pool.query(
    "INSERT INTO auth_identities(user_id,provider,external_subject,email,email_verified) VALUES($1,'clerk','clerk-r7-sub','r7@qa.test',true)", [user.rows[0]?.id]
  );

  const backend = createServer(createBackend());
  const backendPort = await listen(backend);
  const token = await new SignJWT({ email: 'r7@qa.test', email_verified: true, platform_role: 'SuperAdmin', workspace_id: 'attacker-claim' })
    .setProtectedHeader({ alg: 'RS256', kid: 'r7-key' }).setIssuer(issuer).setAudience('phoenix-backend')
    .setSubject('clerk-r7-sub').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const response = await fetch(`http://127.0.0.1:${backendPort}/api/me/workspaces`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json() as { ok: boolean; data?: { items: Array<{ workspaceId: string; role: string }> } };
  check(response.status === 200 && body.ok, 'valid OIDC token reaches the identity workspace endpoint');
  check(body.data?.items[0]?.workspaceId === workspace.rows[0]?.id, 'workspace comes from PostgreSQL membership, not JWT claims');
  check(body.data?.items[0]?.role === 'Viewer', 'workspace role comes from PostgreSQL, not JWT claims');

  const invalid = await fetch(`http://127.0.0.1:${backendPort}/api/me/workspaces`, { headers: { Authorization: 'Bearer invalid-token' } });
  check(invalid.status === 401, 'invalid bearer token fails closed');

  await Promise.all([
    new Promise<void>((resolve, reject) => backend.close((error) => error ? reject(error) : resolve())),
    new Promise<void>((resolve, reject) => jwks.close((error) => error ? reject(error) : resolve())),
  ]);
  await closeDatabasePool();
  // eslint-disable-next-line no-console
  console.log(`\n${passed} passed.`);
  // eslint-disable-next-line no-console
  console.log('RESULT: PHX-LAUNCH-002-R7 OIDC WORKSPACE E2E QA PASSED');
}

void main();

import { createServer } from 'node:http';
import express from 'express';
import { createIntakeOperationsRouter } from '../../src/routes/intake-operations';
import type { IntakeServiceClient, IntakeServiceResult } from '../../src/services/intake-service.client';

const REQUEST_UUID = '11111111-1111-4111-8111-111111111111';
const ACTOR_UUID = '22222222-2222-4222-8222-222222222222';
let passes = 0;

function check(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
  passes += 1;
  // eslint-disable-next-line no-console
  console.log(`PASS: ${label}`);
}

async function main(): Promise<void> {
  let queryResult: IntakeServiceResult<{ items: []; total: number; nextCursor: null }> = {
    ok: true, data: { items: [], total: 0, nextCursor: null },
  };
  let detailResult: IntakeServiceResult<{ request: never }> = { ok: false, kind: 'upstream', status: 404 };
  let actionResult: IntakeServiceResult<{ status: 'under_review' }> = { ok: true, data: { status: 'under_review' } };
  let inviteResult: IntakeServiceResult<{
    status: 'upload_invited'; expiresAt: string; emailSent: boolean;
  }> = {
    ok: true,
    data: {
      status: 'upload_invited',
      expiresAt: '2026-08-11T16:00:00.000Z',
      emailSent: true,
    },
  };
  let attributedActor = '';
  let invitationActor = '';

  const client: IntakeServiceClient = {
    query: async () => queryResult,
    detail: async () => detailResult,
    action: async (_id, _action, actor) => {
      attributedActor = actor;
      return actionResult;
    },
    inviteUpload: async (_id, actor) => {
      invitationActor = actor;
      return inviteResult;
    },
  };

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.requestId = 'route-qa-request';
    next();
  });
  app.use('/api', createIntakeOperationsRouter({
    client,
    authorize: async () => ({
      id: ACTOR_UUID,
      email: 'operator@example.test',
      displayName: 'Operator QA',
      platformRole: 'SuperAdmin',
    }),
  }));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('QA server did not bind.');
  const base = `http://127.0.0.1:${address.port}/api/operations/intake-requests`;

  try {
    let response = await fetch(`${base}/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    let body = await response.json() as { ok: boolean; data?: { total: number }; error?: { code: string } };
    check(response.status === 200 && body.ok && body.data?.total === 0, 'query route returns the shared success envelope');

    response = await fetch(`${base}/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ search: 'secret', extra: true }),
    });
    check(response.status === 400, 'strict query validation rejects unknown fields');

    response = await fetch(`${base}/not-a-uuid`);
    check(response.status === 400, 'detail route rejects a malformed UUID');

    response = await fetch(`${base}/${REQUEST_UUID}`);
    body = await response.json() as typeof body;
    check(response.status === 404 && body.error?.code === 'NOT_FOUND', 'missing Website request maps to 404 NOT_FOUND');

    response = await fetch(`${base}/${REQUEST_UUID}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete' }),
    });
    check(response.status === 422, 'unsupported action maps to 422');

    response = await fetch(`${base}/${REQUEST_UUID}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'under_review' }),
    });
    check(response.status === 200 && attributedActor === ACTOR_UUID, 'action forwards only the authorized database actor id');

    response = await fetch(`${base}/${REQUEST_UUID}/upload-invitation`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    body = await response.json() as typeof body;
    check(
      response.status === 200 && invitationActor === ACTOR_UUID,
      'upload invitation forwards only the authorized database actor id'
    );

    queryResult = { ok: false, kind: 'unavailable' };
    response = await fetch(`${base}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    body = await response.json() as typeof body;
    check(response.status === 503 && body.error?.code === 'INTAKE_SERVICE_UNAVAILABLE', 'unavailable service maps to sanitized 503');

    queryResult = { ok: false, kind: 'error' };
    response = await fetch(`${base}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    body = await response.json() as typeof body;
    check(response.status === 502 && body.error?.code === 'INTAKE_SERVICE_ERROR', 'invalid service response maps to sanitized 502');

    actionResult = { ok: false, kind: 'upstream', status: 409 };
    response = await fetch(`${base}/${REQUEST_UUID}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'under_review' }),
    });
    body = await response.json() as typeof body;
    check(response.status === 409 && body.error?.code === 'CONFLICT', 'transition conflict maps to 409 CONFLICT');

    inviteResult = { ok: false, kind: 'upstream', status: 409 };
    response = await fetch(`${base}/${REQUEST_UUID}/upload-invitation`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    body = await response.json() as typeof body;
    check(response.status === 409 && body.error?.code === 'CONFLICT', 'active or invalid upload invitation maps to 409 CONFLICT');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  // eslint-disable-next-line no-console
  console.log(`\n${passes} passed.`);
  // eslint-disable-next-line no-console
  console.log('RESULT: PHX-LAUNCH-002-R2 BACKEND OPERATOR ROUTES QA PASSED');
}

void main();

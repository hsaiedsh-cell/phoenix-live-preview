// ============================================================
// QA: PHX-LAUNCH-002-R2 Backend Website Intake Service Client
// ------------------------------------------------------------
// Deterministic fetch-stub QA. No real network, database, Website,
// route registration, credential, or customer data is used.
// ============================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createIntakeServiceClient,
  type IntakeServiceResult,
} from '../../src/services/intake-service.client';

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assert(
  condition: unknown,
  label: string
): asserts condition {
  if (condition) {
    passCount += 1;
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${label}`);
    return;
  }

  failCount += 1;
  failures.push(label);
  // eslint-disable-next-line no-console
  console.log(`  FAIL  ${label}`);
}

function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
}

function jsonResponse(
  status: number,
  body: unknown
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function assertFailureKind(
  result: IntakeServiceResult<unknown>,
  kind: 'unavailable' | 'error',
  label: string
): void {
  assert(
    !result.ok && result.kind === kind,
    label
  );
}

const SERVICE_SECRET =
  'r2-backend-client-secret-not-real-1234567890';
const REQUEST_ID = 'backend-r2-request-001';
const INTAKE_REQUEST_ID =
  '11111111-1111-4111-8111-111111111111';
const ACTOR_USER_ID =
  '22222222-2222-4222-8222-222222222222';
const EVENT_ID =
  '33333333-3333-4333-8333-333333333333';

const CONFIG = {
  baseUrl: 'https://website.example.test',
  secret: SERVICE_SECRET,
  timeoutMs: 100,
};

const QUEUE_RESPONSE = {
  items: [
    {
      requestId: INTAKE_REQUEST_ID,
      publicReference: 'PHX-REQ-QA0001',
      status: 'received',
      requestType: 'assessment',
      company: 'Client QA Company',
      createdAt: '2026-07-31T20:00:00.000Z',
      updatedAt: '2026-07-31T20:00:00.000Z',
      fileCount: 0,
      uploadSessionStatus: null,
    },
  ],
  total: 1,
  nextCursor: null,
  requestId: REQUEST_ID,
};

const DETAIL_RESPONSE = {
  request: {
    requestId: INTAKE_REQUEST_ID,
    publicReference: 'PHX-REQ-QA0001',
    requestType: 'assessment',
    status: 'under_review',
    firstName: 'Client',
    lastName: 'Tester',
    workEmail: 'client.qa@example.test',
    company: 'Client QA Company',
    role: 'CAIO',
    phone: null,
    country: 'AE',
    estimatedTimeline: null,
    message: 'Private deterministic client QA message.',
    createdAt: '2026-07-31T20:00:00.000Z',
    updatedAt: '2026-07-31T20:01:00.000Z',
    fileCount: 0,
    uploadSessionStatus: null,
    operatorActions: [
      {
        eventId: EVENT_ID,
        actorUserId: ACTOR_USER_ID,
        from: 'received',
        to: 'under_review',
        createdAt: '2026-07-31T20:01:00.000Z',
      },
    ],
    files: [],
  },
  requestId: REQUEST_ID,
};

async function main(): Promise<void> {
  section('1. Missing and malformed configuration fail closed');

  {
    let callCount = 0;
    const client = createIntakeServiceClient({
      config: {
        baseUrl: undefined,
        secret: undefined,
        timeoutMs: 5000,
      },
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse(200, QUEUE_RESPONSE);
      },
    });

    const result = await client.query({}, REQUEST_ID);

    assertFailureKind(
      result,
      'unavailable',
      'missing service configuration returns unavailable'
    );
    assert(
      callCount === 0,
      'missing service configuration performs no fetch'
    );
  }

  {
    let callCount = 0;
    const client = createIntakeServiceClient({
      config: {
        baseUrl:
          'https://website.example.test/unexpected-path',
        secret: SERVICE_SECRET,
        timeoutMs: 5000,
      },
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse(200, QUEUE_RESPONSE);
      },
    });

    const result = await client.query({}, REQUEST_ID);

    assertFailureKind(
      result,
      'unavailable',
      'non-origin base URL fails closed'
    );
    assert(
      callCount === 0,
      'invalid base URL performs no fetch'
    );
  }

  section('2. Query call uses the fixed service boundary');

  {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    let callCount = 0;

    const client = createIntakeServiceClient({
      config: CONFIG,
      fetchImpl: async (input, init) => {
        callCount += 1;
        capturedUrl = String(input);
        capturedInit = init;
        return jsonResponse(200, QUEUE_RESPONSE);
      },
    });

    const query = {
      search: 'Client QA Company',
      statuses: ['received'] as const,
      requestTypes: ['assessment'] as const,
      limit: 25,
    };

    const result = await client.query(
      {
        ...query,
        statuses: [...query.statuses],
        requestTypes: [...query.requestTypes],
      },
      REQUEST_ID
    );

    assert(
      result.ok &&
        result.data.items.length === 1 &&
        result.data.total === 1 &&
        result.data.nextCursor === null,
      'valid queue response is strictly parsed'
    );
    assert(
      callCount === 1,
      'query performs exactly one fetch'
    );
    assert(
      capturedUrl ===
        'https://website.example.test/api/internal/operations/intake-requests/query',
      'query uses the fixed internal route'
    );
    assert(
      !capturedUrl.includes('Client') &&
        !capturedUrl.includes('search'),
      'search text never enters the outbound URL'
    );

    const headers = new Headers(capturedInit?.headers);

    assert(
      capturedInit?.method === 'POST',
      'query uses POST'
    );
    assert(
      capturedInit?.redirect === 'error' &&
        capturedInit.signal !== undefined,
      'query rejects redirects and carries the timeout signal'
    );
    assert(
      headers.get('authorization') ===
        `Bearer ${SERVICE_SECRET}`,
      'query attaches the dedicated Bearer credential'
    );
    assert(
      headers.get('x-phoenix-request-id') ===
        REQUEST_ID,
      'query forwards the Backend request identifier'
    );
    assert(
      headers.get('x-phoenix-actor-user-id') ===
        null,
      'query never attaches an actor header'
    );
    assert(
      headers.get('content-type') ===
        'application/json',
      'query declares JSON'
    );

    const body = JSON.parse(
      String(capturedInit?.body)
    ) as Record<string, unknown>;

    assert(
      body.search === 'Client QA Company' &&
        body.limit === 25,
      'query sends the validated body in JSON only'
    );
    assert(
      result.ok &&
        !('requestId' in result.data),
      'Website correlation metadata is not forwarded as business data'
    );
  }

  section('3. Detail call uses one fixed UUID path');

  {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const client = createIntakeServiceClient({
      config: CONFIG,
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return jsonResponse(200, DETAIL_RESPONSE);
      },
    });

    const result = await client.detail(
      INTAKE_REQUEST_ID,
      REQUEST_ID
    );

    assert(
      result.ok &&
        result.data.request.requestId ===
          INTAKE_REQUEST_ID &&
        result.data.request.operatorActions.length === 1,
      'valid detail response and sanitized history are parsed'
    );
    assert(
      capturedUrl ===
        `https://website.example.test/api/internal/operations/intake-requests/${INTAKE_REQUEST_ID}`,
      'detail uses the fixed internal UUID route'
    );
    assert(
      capturedInit?.method === 'GET' &&
        capturedInit.body === undefined,
      'detail uses GET without a body'
    );

    const headers = new Headers(capturedInit?.headers);

    assert(
      headers.get('x-phoenix-actor-user-id') ===
        null,
      'detail never attaches an actor header'
    );
    assert(
      headers.get('content-type') === null,
      'detail does not declare a request body content type'
    );
  }

  section('4. Action call is action-only, attributed, and never retried');

  {
    let callCount = 0;
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const client = createIntakeServiceClient({
      config: CONFIG,
      fetchImpl: async (input, init) => {
        callCount += 1;
        capturedUrl = String(input);
        capturedInit = init;
        return jsonResponse(200, {
          status: 'under_review',
          requestId: REQUEST_ID,
        });
      },
    });

    const result = await client.action(
      INTAKE_REQUEST_ID,
      'under_review',
      ACTOR_USER_ID,
      REQUEST_ID
    );

    assert(
      result.ok &&
        result.data.status === 'under_review',
      'valid action response is strictly parsed'
    );
    assert(
      callCount === 1,
      'action performs exactly one fetch'
    );
    assert(
      capturedUrl ===
        `https://website.example.test/api/internal/operations/intake-requests/${INTAKE_REQUEST_ID}/actions`,
      'action uses the fixed internal route'
    );

    const headers = new Headers(capturedInit?.headers);
    const body = JSON.parse(
      String(capturedInit?.body)
    ) as Record<string, unknown>;

    assert(
      headers.get('x-phoenix-actor-user-id') ===
        ACTOR_USER_ID,
      'action attaches the database-derived actor UUID'
    );
    assert(
      JSON.stringify(Object.keys(body)) ===
        JSON.stringify(['action']) &&
        body.action === 'under_review',
      'action body contains exactly the action property'
    );
  }

  section('5. Expected Website business failures are sanitized');

  {
    const notFoundClient = createIntakeServiceClient({
      config: CONFIG,
      fetchImpl: async () =>
        jsonResponse(404, {
          error:
            'This internal text must not be forwarded.',
          requestId: REQUEST_ID,
        }),
    });

    const result = await notFoundClient.detail(
      INTAKE_REQUEST_ID,
      REQUEST_ID
    );

    assert(
      !result.ok &&
        result.kind === 'upstream' &&
        result.status === 404 &&
        !('error' in result),
      'detail 404 returns only the bounded upstream status'
    );
  }

  {
    const conflictClient = createIntakeServiceClient({
      config: CONFIG,
      fetchImpl: async () =>
        jsonResponse(409, {
          error:
            'Internal transition detail must not be forwarded.',
          requestId: REQUEST_ID,
        }),
    });

    const result = await conflictClient.action(
      INTAKE_REQUEST_ID,
      'close',
      ACTOR_USER_ID,
      REQUEST_ID
    );

    assert(
      !result.ok &&
        result.kind === 'upstream' &&
        result.status === 409 &&
        !('error' in result),
      'action 409 returns only the bounded upstream status'
    );
  }

  section('6. Internal auth and server failures map to unavailable');

  for (const status of [401, 500, 503]) {
    let callCount = 0;
    const client = createIntakeServiceClient({
      config: CONFIG,
      fetchImpl: async () => {
        callCount += 1;
        return jsonResponse(status, {
          error: 'Sanitized Website failure.',
          requestId: REQUEST_ID,
        });
      },
    });

    const result = await client.query(
      {},
      REQUEST_ID
    );

    assertFailureKind(
      result,
      'unavailable',
      `Website ${status} maps to unavailable`
    );
    assert(
      callCount === 1,
      `Website ${status} is not retried`
    );
  }

  section('7. Network and timeout failures map to unavailable');

  {
    const client = createIntakeServiceClient({
      config: CONFIG,
      fetchImpl: async () => {
        throw new Error('simulated network failure');
      },
    });

    const result = await client.query(
      {},
      REQUEST_ID
    );

    assertFailureKind(
      result,
      'unavailable',
      'network rejection maps to unavailable'
    );
  }

  {
    let callCount = 0;
    const client = createIntakeServiceClient({
      config: {
        ...CONFIG,
        timeoutMs: 20,
      },
      fetchImpl: async (_input, init) => {
        callCount += 1;

        return new Promise<Response>(
          (_resolve, reject) => {
            const abort = (): void => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            };

            if (init?.signal?.aborted) {
              abort();
              return;
            }

            init?.signal?.addEventListener(
              'abort',
              abort,
              { once: true }
            );
          }
        );
      },
    });

    const result = await client.action(
      INTAKE_REQUEST_ID,
      'under_review',
      ACTOR_USER_ID,
      REQUEST_ID
    );

    assertFailureKind(
      result,
      'unavailable',
      'AbortController timeout maps to unavailable'
    );
    assert(
      callCount === 1,
      'timed-out action is never retried'
    );
  }

  section('8. Invalid or unexpected Website responses fail closed');

  const invalidResponses: Array<{
    label: string;
    response: Response;
  }> = [
    {
      label: 'non-JSON response',
      response: new Response('plain text', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
        },
      }),
    },
    {
      label: 'malformed JSON response',
      response: new Response('{bad json', {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    },
    {
      label: 'invalid success projection',
      response: jsonResponse(200, {
        items: [],
        total: 0,
        nextCursor: null,
        requestId: REQUEST_ID,
        unexpected: true,
      }),
    },
    {
      label: 'invalid failure projection',
      response: jsonResponse(404, {
        error: 'Not found.',
        requestId: REQUEST_ID,
        internal: 'must fail strict parsing',
      }),
    },
    {
      label: 'oversized response',
      response: new Response(
        'x'.repeat(1_000_001),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }
      ),
    },
  ];

  for (const testCase of invalidResponses) {
    const client = createIntakeServiceClient({
      config: CONFIG,
      fetchImpl: async () => testCase.response,
    });

    const result = await client.query(
      {},
      REQUEST_ID
    );

    assertFailureKind(
      result,
      'error',
      `${testCase.label} maps to service error`
    );
  }

  section('9. Structural privacy and retry guards');

  {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'src/services/intake-service.client.ts'
      ),
      'utf8'
    );

    assert(
      source.includes('AbortController'),
      'client uses AbortController'
    );
    assert(
      source.includes("redirect: 'error'"),
      'client rejects redirects'
    );
    assert(
      source.includes('signal: controller.signal'),
      'client applies the AbortController signal to fetch'
    );
    assert(
      source.includes(
        "'X-Phoenix-Actor-User-Id'"
      ),
      'client defines the action actor header'
    );
    assert(
      source.includes('INTAKE_OPS_SECRET') ===
        false,
      'client never references the legacy ops secret'
    );
    assert(
      source.includes('console.log') === false &&
        source.includes('console.error') === false,
      'client contains no direct logging'
    );
    assert(
      source.includes('while (') === false &&
        source.includes('for (let attempt') ===
          false,
      'client contains no retry loop'
    );
    assert(
      source.includes('response.json()') ===
        false,
      'client bounds response text before JSON parsing'
    );
    assert(
      source.includes('response.body') === false,
      'client never exposes a raw response body'
    );
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n${passCount} passed, ${failCount} failed.`
  );

  if (failCount > 0) {
    // eslint-disable-next-line no-console
    console.log(
      'Failures:',
      failures.join(', ')
    );
    process.exitCode = 1;
    return;
  }

  // eslint-disable-next-line no-console
  console.log(
    'RESULT: PHX-LAUNCH-002-R2 BACKEND INTAKE SERVICE CLIENT QA PASSED'
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    'r2-intake-service-client.qa.ts failed:',
    error
  );
  process.exitCode = 1;
});

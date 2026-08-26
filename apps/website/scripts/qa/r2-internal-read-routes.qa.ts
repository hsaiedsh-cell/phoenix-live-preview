// ============================================================
// QA: PHX-LAUNCH-002 R2 internal Website query/detail routes
// Executes the actual Next.js handlers against disposable PostgreSQL.
// No HTTP server or external network is used.
// ============================================================

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import { recordEvent } from '../../src/lib/intake/repositories/intake-events.repository';
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from '../../src/lib/intake/config';

const SERVICE_SECRET =
  'r2-internal-route-qa-secret-not-real-1234567890';
process.env.INTAKE_SERVICE_SECRET = SERVICE_SECRET;

const QUERY_URL =
  'https://phoenixops.ai/api/internal/operations/intake-requests/query';
const DETAIL_URL =
  'https://phoenixops.ai/api/internal/operations/intake-requests';

interface SeededRequest {
  id: string;
  public_reference: string;
  work_email_normalized: string;
}

function serviceHeaders(
  requestId: string,
  secret = SERVICE_SECRET,
  contentType = 'application/json'
): Record<string, string> {
  return {
    authorization: `Bearer ${secret}`,
    'content-type': contentType,
    'x-phoenix-request-id': requestId,
  };
}

function queryRequest(
  body: string,
  requestId: string,
  options: {
    secret?: string;
    contentType?: string;
  } = {}
): Request {
  return new Request(QUERY_URL, {
    method: 'POST',
    headers: serviceHeaders(
      requestId,
      options.secret ?? SERVICE_SECRET,
      options.contentType ?? 'application/json'
    ),
    body,
  });
}

function detailRequest(
  requestId: string,
  secret = SERVICE_SECRET
): Request {
  return new Request(`${DETAIL_URL}/placeholder`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${secret}`,
      'x-phoenix-request-id': requestId,
    },
  });
}

async function createRequestFixture(): Promise<SeededRequest> {
  const rows = await intakeQuery<SeededRequest>(
    `INSERT INTO public_intake_requests (
       public_reference,
       request_type,
       first_name,
       last_name,
       work_email_normalized,
       company,
       role,
       phone,
       country,
       estimated_timeline,
       message,
       privacy_consent,
       privacy_version,
       terms_version,
       marketing_consent,
       consent_timestamp,
       idempotency_key_hash,
       ip_hash,
       status
     ) VALUES (
       'PHX-REQ-' || substr(md5(random()::text), 1, 12),
       'assessment',
       'Batch4',
       'RouteTester',
       $1,
       'Batch4 Route QA Company',
       'CAIO',
       '+971500000000',
       'AE',
       'Q4 2026',
       'Private Batch 4 route QA message',
       true,
       $2,
       $3,
       false,
       now(),
       $4,
       null,
       'under_review'
     )
     RETURNING
       id,
       public_reference,
       work_email_normalized::text`,
    [
      `batch4-route-${randomUUID()}@acme.example`,
      CURRENT_PRIVACY_VERSION,
      CURRENT_TERMS_VERSION,
      randomUUID(),
    ]
  );

  const fixture = rows[0];
  if (!fixture) {
    throw new Error('Route QA fixture could not be created.');
  }

  return fixture;
}

async function deleteRequestFixture(requestId: string): Promise<void> {
  await intakeQuery(
    `DELETE FROM public_intake_requests WHERE id = $1`,
    [requestId]
  );
}

async function main(): Promise<void> {
  const fixture = await createRequestFixture();
  const actorUserId = randomUUID();

  try {
    await recordEvent(
      fixture.id,
      'request.status_changed',
      {
        actorUserId,
        source: 'phoenix_backend',
        from: 'received',
        to: 'under_review',
      }
    );

    const { POST } = await import(
      '../../src/app/api/internal/operations/intake-requests/query/route'
    );
    const { GET } = await import(
      '../../src/app/api/internal/operations/intake-requests/[requestId]/route'
    );

    section('1. Dedicated service authentication');
    {
      const missingAuth = new Request(QUERY_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-phoenix-request-id': 'batch4-auth-missing',
        },
        body: '{}',
      });
      const missingResponse = await POST(missingAuth);
      const missingBody = (await missingResponse.json()) as Record<
        string,
        unknown
      >;

      assert(
        missingResponse.status === 401,
        'missing service credential returns 401'
      );
      assert(
        JSON.stringify(Object.keys(missingBody).sort()) ===
          JSON.stringify(['error', 'requestId']),
        'unauthorized response exposes only error and requestId'
      );
      assert(
        missingResponse.headers.get('cache-control') ===
          'no-store, private',
        'unauthorized response is not cacheable'
      );

      const wrongResponse = await POST(
        queryRequest('{}', 'batch4-auth-wrong', {
          secret: 'wrong-dedicated-service-secret',
        })
      );
      assert(
        wrongResponse.status === 401,
        'wrong dedicated service credential returns 401'
      );
    }

    section('2. Query route validation');
    {
      const wrongType = await POST(
        queryRequest('{}', 'batch4-content-type', {
          contentType: 'text/plain',
        })
      );
      assert(
        wrongType.status === 415,
        'non-JSON content type returns 415'
      );

      const malformed = await POST(
        queryRequest('{not valid json', 'batch4-malformed')
      );
      assert(
        malformed.status === 400,
        'malformed JSON returns 400'
      );

      const unknownProperty = await POST(
        queryRequest(
          JSON.stringify({ unexpected: true }),
          'batch4-unknown-property'
        )
      );
      assert(
        unknownProperty.status === 400,
        'unknown query property returns 400'
      );
    }

    section('3. Query route success and privacy projection');
    {
      const correlationId = 'batch4-query-correlation';
      const response = await POST(
        queryRequest(
          JSON.stringify({
            search: 'Batch4 Route QA Company',
            statuses: ['under_review'],
            limit: 10,
          }),
          correlationId
        )
      );
      const body = (await response.json()) as {
        items: Array<Record<string, unknown>>;
        total: number;
        nextCursor: string | null;
        requestId: string;
      };

      assert(response.status === 200, 'valid queue query returns 200');
      assert(
        response.headers.get('cache-control') === 'no-store, private',
        'successful query response is not cacheable'
      );
      assert(
        body.requestId === correlationId,
        'bounded correlation identifier is preserved'
      );
      assert(body.total === 1, 'queue total resolves the fixture');
      assert(
        body.items.length === 1,
        'queue returns exactly one fixture'
      );

      const item = body.items[0];
      if (!item) {
        throw new Error('Expected one queue item.');
      }

      const expectedKeys = [
        'company',
        'createdAt',
        'fileCount',
        'publicReference',
        'requestId',
        'requestType',
        'status',
        'updatedAt',
        'uploadSessionStatus',
      ];

      assert(
        JSON.stringify(Object.keys(item).sort()) ===
          JSON.stringify(expectedKeys),
        'queue exposes only the approved summary projection'
      );
      assert(
        item.requestId === fixture.id,
        'queue item contains the internal request UUID'
      );

      const serialized = JSON.stringify(body);
      for (const forbidden of [
        'Private Batch 4 route QA message',
        fixture.work_email_normalized,
        '+971500000000',
        'privacyVersion',
        'termsVersion',
        'marketingConsent',
        'consentTimestamp',
        'idempotency',
        'ipHash',
        'tokenHash',
        'storageObjectKey',
        'originalFilename',
        SERVICE_SECRET,
      ]) {
        assert(
          !serialized.includes(forbidden),
          `queue response excludes ${forbidden}`
        );
      }
    }

    section('4. Detail identifier handling');
    {
      const invalid = await GET(
        detailRequest('batch4-detail-invalid'),
        {
          params: Promise.resolve({ requestId: 'not-a-uuid' }),
        }
      );
      assert(
        invalid.status === 400,
        'malformed internal request UUID returns 400'
      );

      const missing = await GET(
        detailRequest('batch4-detail-missing'),
        {
          params: Promise.resolve({ requestId: randomUUID() }),
        }
      );
      assert(
        missing.status === 404,
        'unknown internal request UUID returns 404'
      );
    }

    section('5. Detail success and sanitized action history');
    {
      const correlationId = 'batch4-detail-correlation';
      const response = await GET(
        detailRequest(correlationId),
        {
          params: Promise.resolve({ requestId: fixture.id }),
        }
      );
      const body = (await response.json()) as {
        request: Record<string, unknown> & {
          requestId: string;
          operatorActions: Array<Record<string, unknown>>;
        };
        requestId: string;
      };

      assert(
        response.status === 200,
        'existing request detail returns 200'
      );
      assert(
        response.headers.get('cache-control') === 'no-store, private',
        'successful detail response is not cacheable'
      );
      assert(
        body.requestId === correlationId,
        'detail response preserves correlation identifier'
      );
      assert(
        body.request.requestId === fixture.id,
        'detail payload contains the internal request UUID'
      );
      assert(
        body.request.operatorActions.length === 1,
        'detail includes one valid operator action'
      );

      const action = body.request.operatorActions[0];
      if (!action) {
        throw new Error('Expected one operator action.');
      }

      const expectedActionKeys = [
        'actorUserId',
        'createdAt',
        'eventId',
        'from',
        'to',
      ];

      assert(
        JSON.stringify(Object.keys(action).sort()) ===
          JSON.stringify(expectedActionKeys),
        'operator action exposes only sanitized fields'
      );
      assert(
        action.actorUserId === actorUserId,
        'operator action retains the Backend actor UUID'
      );

      const expectedDetailKeys = [
        'company',
        'country',
        'createdAt',
        'estimatedTimeline',
        'fileCount',
        'firstName',
        'lastName',
        'message',
        'operatorActions',
        'phone',
        'publicReference',
        'requestId',
        'requestType',
        'role',
        'status',
        'updatedAt',
        'uploadSessionStatus',
        'workEmail',
      ];

      assert(
        JSON.stringify(Object.keys(body.request).sort()) ===
          JSON.stringify(expectedDetailKeys),
        'detail exposes exactly the approved detail projection'
      );

      const serialized = JSON.stringify(body);
      for (const forbidden of [
        'privacyVersion',
        'termsVersion',
        'marketingConsent',
        'consentTimestamp',
        'idempotency',
        'ipHash',
        'tokenHash',
        'reservationKeyHash',
        'storageObjectKey',
        'originalFilename',
        SERVICE_SECRET,
      ]) {
        assert(
          !serialized.includes(forbidden),
          `detail response excludes ${forbidden}`
        );
      }
    }

    section('6. Structural route boundary checks');
    {
      const querySource = readFileSync(
        new URL(
          '../../src/app/api/internal/operations/intake-requests/query/route.ts',
          import.meta.url
        ),
        'utf8'
      );
      const detailSource = readFileSync(
        new URL(
          '../../src/app/api/internal/operations/intake-requests/[requestId]/route.ts',
          import.meta.url
        ),
        'utf8'
      );

      for (const source of [querySource, detailSource]) {
        assert(
          source.includes('isValidIntakeServiceRequest'),
          'route uses dedicated service authentication'
        );
        assert(
          !source.includes('INTAKE_OPS_SECRET') &&
            !source.includes('isValidOpsSecret'),
          'route never uses the legacy ops-secret path'
        );
        assert(
          !source.includes('console.log') &&
            !source.includes('console.error'),
          'route contains no direct console logging'
        );
        assert(
          source.includes("'no-store, private'"),
          'route applies no-store private caching'
        );
      }

      assert(
        querySource.indexOf(
          'if (!isValidIntakeServiceRequest(request))'
        ) <
          querySource.indexOf(
            'const bodyResult = await readBoundedJsonBody(request)'
          ),
        'query authenticates before reading its body'
      );
      assert(
        detailSource.includes('listOperatorActionsForRequest'),
        'detail route includes sanitized operator-action history'
      );
    }
  } finally {
    await deleteRequestFixture(fixture.id);
  }

  const remaining = await intakeQuery<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM public_intake_requests
     WHERE id = $1`,
    [fixture.id]
  );

  assert(
    Number(remaining[0]?.count ?? 0) === 0,
    'route QA removes its request fixture'
  );

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('r2-internal-read-routes.qa.ts failed:', error);
  process.exitCode = 1;
});

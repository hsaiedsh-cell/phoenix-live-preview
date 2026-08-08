// ============================================================
// QA: PHX-LAUNCH-002 R2 internal transactional action route
// Executes the actual Next.js handler against disposable PostgreSQL.
// ============================================================

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  assert,
  printSummaryAndExit,
  section,
} from './assert';
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from '../../src/lib/intake/config';
import {
  getIntakeServiceActorUserId,
} from '../../src/lib/intake/http';
import { intakeQuery } from '../../src/lib/intake/db';
import {
  applyOperatorAction,
} from '../../src/lib/intake/operator-actions.service';

const SERVICE_SECRET =
  'r2-action-route-qa-service-secret-not-real-1234567890';

process.env.INTAKE_SERVICE_SECRET =
  SERVICE_SECRET;

const ACTION_URL =
  'https://phoenixops.ai/api/internal/operations/intake-requests';

interface SeededRequest {
  id: string;
  public_reference: string;
}

interface StatusRow {
  status: string;
}

interface CountRow {
  count: string;
}

interface EventRow {
  event_type: string;
  detail: Record<string, unknown> | null;
}

function serviceHeaders(
  correlationId: string,
  actorUserId: string,
  options: {
    secret?: string;
    contentType?: string;
  } = {}
): Record<string, string> {
  return {
    authorization:
      `Bearer ${options.secret ?? SERVICE_SECRET}`,
    'content-type':
      options.contentType ?? 'application/json',
    'x-phoenix-request-id': correlationId,
    'x-phoenix-actor-user-id': actorUserId,
  };
}

function actionRequest(
  body: string,
  correlationId: string,
  actorUserId: string,
  options: {
    secret?: string;
    contentType?: string;
  } = {}
): Request {
  return new Request(
    `${ACTION_URL}/placeholder/actions`,
    {
      method: 'POST',
      headers: serviceHeaders(
        correlationId,
        actorUserId,
        options
      ),
      body,
    }
  );
}

function controlledActorRequest(
  value: string | null
): Pick<Request, 'headers'> {
  return {
    headers: {
      get(name: string): string | null {
        if (
          name.toLowerCase() ===
          'x-phoenix-actor-user-id'
        ) {
          return value;
        }

        return null;
      },
    } as Headers,
  };
}

async function createRequestFixture(
  status: string
): Promise<SeededRequest> {
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
       'Batch5',
       'ActionTester',
       $1,
       'Batch5 Action QA Company',
       'CAIO',
       '+971500000000',
       'AE',
       'Q4 2026',
       'Private Batch 5 action QA message',
       true,
       $2,
       $3,
       false,
       now(),
       $4,
       null,
       $5
     )
     RETURNING id, public_reference`,
    [
      `batch5-action-${randomUUID()}@acme.example`,
      CURRENT_PRIVACY_VERSION,
      CURRENT_TERMS_VERSION,
      randomUUID(),
      status,
    ]
  );

  const fixture = rows[0];

  if (!fixture) {
    throw new Error(
      'Failed to create Batch 5 request fixture.'
    );
  }

  return fixture;
}

async function deleteRequestFixture(
  requestId: string
): Promise<void> {
  await intakeQuery(
    `DELETE FROM public_intake_requests
     WHERE id = $1`,
    [requestId]
  );
}

async function requestStatus(
  requestId: string
): Promise<string | null> {
  const rows = await intakeQuery<StatusRow>(
    `SELECT status
     FROM public_intake_requests
     WHERE id = $1`,
    [requestId]
  );

  return rows[0]?.status ?? null;
}

async function requestEvents(
  requestId: string
): Promise<EventRow[]> {
  return intakeQuery<EventRow>(
    `SELECT event_type, detail
     FROM public_intake_events
     WHERE request_id = $1
     ORDER BY created_at ASC, id ASC`,
    [requestId]
  );
}

async function countStatusEvents(
  requestId: string
): Promise<number> {
  const rows = await intakeQuery<CountRow>(
    `SELECT count(*)::text AS count
     FROM public_intake_events
     WHERE request_id = $1
       AND event_type = 'request.status_changed'`,
    [requestId]
  );

  return Number(rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const createdRequestIds: string[] = [];
  const actorUserId = randomUUID();

  const { POST } = await import(
    '../../src/app/api/internal/operations/intake-requests/[requestId]/actions/route'
  );

  try {
    section(
      '1. Strict service actor UUID extraction'
    );

    assert(
      getIntakeServiceActorUserId(
        controlledActorRequest(null)
      ) === null,
      'missing actor header is rejected'
    );

    assert(
      getIntakeServiceActorUserId(
        controlledActorRequest(actorUserId)
      ) === actorUserId,
      'one exact actor UUID is accepted'
    );

    assert(
      getIntakeServiceActorUserId(
        controlledActorRequest(
          ` ${actorUserId}`
        )
      ) === null,
      'raw leading whitespace is rejected'
    );

    assert(
      getIntakeServiceActorUserId(
        controlledActorRequest(
          `${actorUserId} `
        )
      ) === null,
      'raw trailing whitespace is rejected'
    );

    assert(
      getIntakeServiceActorUserId(
        controlledActorRequest(
          `${actorUserId},${randomUUID()}`
        )
      ) === null,
      'comma-joined duplicate actor values are rejected'
    );

    assert(
      getIntakeServiceActorUserId(
        controlledActorRequest('not-a-uuid')
      ) === null,
      'malformed actor UUID is rejected'
    );

    section(
      '2. Service authentication precedes actor attribution'
    );

    {
      const missingAuth = new Request(
        `${ACTION_URL}/placeholder/actions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-phoenix-request-id':
              'batch5-auth-missing',
          },
          body: JSON.stringify({
            action: 'under_review',
          }),
        }
      );

      const missingAuthResponse = await POST(
        missingAuth,
        {
          params: Promise.resolve({
            requestId: randomUUID(),
          }),
        }
      );

      assert(
        missingAuthResponse.status === 401,
        'missing service credential returns 401 before actor validation'
      );

      const missingActor = new Request(
        `${ACTION_URL}/placeholder/actions`,
        {
          method: 'POST',
          headers: {
            authorization:
              `Bearer ${SERVICE_SECRET}`,
            'content-type':
              'application/json',
            'x-phoenix-request-id':
              'batch5-actor-missing',
          },
          body: JSON.stringify({
            action: 'under_review',
          }),
        }
      );

      const missingActorResponse = await POST(
        missingActor,
        {
          params: Promise.resolve({
            requestId: randomUUID(),
          }),
        }
      );

      assert(
        missingActorResponse.status === 400,
        'missing actor attribution returns generic 400 after service authentication'
      );

      const wrongAuthResponse = await POST(
        actionRequest(
          JSON.stringify({
            action: 'under_review',
          }),
          'batch5-auth-wrong',
          actorUserId,
          {
            secret:
              'wrong-dedicated-service-secret',
          }
        ),
        {
          params: Promise.resolve({
            requestId: randomUUID(),
          }),
        }
      );

      assert(
        wrongAuthResponse.status === 401,
        'wrong service credential returns 401'
      );
    }

    section(
      '3. Request, media-type, body, and action validation'
    );

    {
      const invalidRequestId = await POST(
        actionRequest(
          JSON.stringify({
            action: 'under_review',
          }),
          'batch5-request-id-invalid',
          actorUserId
        ),
        {
          params: Promise.resolve({
            requestId: 'not-a-uuid',
          }),
        }
      );

      assert(
        invalidRequestId.status === 400,
        'malformed internal request UUID returns 400'
      );

      const wrongMediaType = await POST(
        actionRequest(
          '{}',
          'batch5-content-type',
          actorUserId,
          {
            contentType: 'text/plain',
          }
        ),
        {
          params: Promise.resolve({
            requestId: randomUUID(),
          }),
        }
      );

      assert(
        wrongMediaType.status === 415,
        'non-JSON content type returns 415'
      );

      const malformedBody = await POST(
        actionRequest(
          '{not valid json',
          'batch5-malformed',
          actorUserId
        ),
        {
          params: Promise.resolve({
            requestId: randomUUID(),
          }),
        }
      );

      assert(
        malformedBody.status === 400,
        'malformed JSON returns 400'
      );

      const extraProperty = await POST(
        actionRequest(
          JSON.stringify({
            action: 'under_review',
            actorUserId,
          }),
          'batch5-extra-property',
          actorUserId
        ),
        {
          params: Promise.resolve({
            requestId: randomUUID(),
          }),
        }
      );

      assert(
        extraProperty.status === 400,
        'actor UUID in the strict JSON body is rejected'
      );

      const unsupported = await POST(
        actionRequest(
          JSON.stringify({
            action: 'upload_invited',
          }),
          'batch5-unsupported',
          actorUserId
        ),
        {
          params: Promise.resolve({
            requestId: randomUUID(),
          }),
        }
      );

      assert(
        unsupported.status === 422,
        'structurally valid unsupported action returns 422'
      );
    }

    section(
      '4. Authorized missing request'
    );

    {
      const missingResponse = await POST(
        actionRequest(
          JSON.stringify({
            action: 'under_review',
          }),
          'batch5-not-found',
          actorUserId
        ),
        {
          params: Promise.resolve({
            requestId: randomUUID(),
          }),
        }
      );

      assert(
        missingResponse.status === 404,
        'unknown authorized request UUID returns 404'
      );
    }

    section(
      '5. Successful atomic status transition and minimal audit'
    );

    {
      const fixture =
        await createRequestFixture('received');
      createdRequestIds.push(fixture.id);

      const correlationId =
        'batch5-success-correlation';

      const response = await POST(
        actionRequest(
          JSON.stringify({
            action: 'under_review',
          }),
          correlationId,
          actorUserId
        ),
        {
          params: Promise.resolve({
            requestId: fixture.id,
          }),
        }
      );

      const body = await response.json() as
        Record<string, unknown>;

      assert(
        response.status === 200,
        'valid received-to-under_review action returns 200'
      );

      assert(
        response.headers.get('cache-control') ===
          'no-store, private',
        'successful action response is not cacheable'
      );

      assert(
        JSON.stringify(
          Object.keys(body).sort()
        ) ===
          JSON.stringify(
            ['requestId', 'status']
          ),
        'success response exposes only status and requestId'
      );

      assert(
        body.requestId === correlationId,
        'success response preserves the bounded correlation id'
      );

      assert(
        body.status === 'under_review',
        'success response returns the committed status'
      );

      assert(
        await requestStatus(fixture.id) ===
          'under_review',
        'request status committed to under_review'
      );

      const events =
        await requestEvents(fixture.id);

      assert(
        events.length === 1,
        'one status-change event commits with the update'
      );

      const event = events[0];

      if (!event) {
        throw new Error(
          'Expected one action event.'
        );
      }

      assert(
        event.event_type ===
          'request.status_changed',
        'committed event is request.status_changed'
      );

      assert(
        JSON.stringify(
          Object.keys(
            event.detail ?? {}
          ).sort()
        ) ===
          JSON.stringify(
            [
              'actorUserId',
              'from',
              'source',
              'to',
            ]
          ),
        'status event detail exposes only the minimal action audit'
      );

      assert(
        event.detail?.actorUserId ===
          actorUserId,
        'status event retains the Backend-derived actor UUID'
      );

      assert(
        event.detail?.source ===
          'phoenix_backend',
        'status event records the fixed Backend source'
      );

      assert(
        event.detail?.from === 'received' &&
          event.detail?.to ===
            'under_review',
        'status event records the exact transition'
      );

      assert(
        JSON.stringify(body).includes(
          actorUserId
        ) === false,
        'success response does not expose actor attribution'
      );
    }

    section(
      '6. Reject action preserves the specific event in the same transaction'
    );

    {
      const fixture =
        await createRequestFixture('received');
      createdRequestIds.push(fixture.id);

      const response = await POST(
        actionRequest(
          JSON.stringify({
            action: 'reject',
          }),
          'batch5-reject',
          actorUserId
        ),
        {
          params: Promise.resolve({
            requestId: fixture.id,
          }),
        }
      );

      assert(
        response.status === 200,
        'valid reject action returns 200'
      );

      const events =
        await requestEvents(fixture.id);

      const rejectEventTypes = events
        .map((event) => event.event_type)
        .sort();

      assert(
        JSON.stringify(rejectEventTypes) ===
          JSON.stringify([
            'request.rejected',
            'request.status_changed',
          ]),
        'reject commits status_changed and request.rejected together'
      );

      assert(
        await requestStatus(fixture.id) ===
          'rejected',
        'reject commits the rejected status'
      );
    }

    section(
      '7. Event failure rolls the status update back'
    );

    {
      const fixture =
        await createRequestFixture('received');
      createdRequestIds.push(fixture.id);

      await intakeQuery(
        `DROP TRIGGER IF EXISTS
           qa_r2_fail_status_event_trigger
         ON public_intake_events`
      );

      await intakeQuery(
        `DROP FUNCTION IF EXISTS
           qa_r2_fail_status_event()`
      );

      await intakeQuery(
        `CREATE FUNCTION
           qa_r2_fail_status_event()
         RETURNS trigger
         LANGUAGE plpgsql
         AS $$
         BEGIN
           RAISE EXCEPTION
             'qa forced status event failure';
         END;
         $$`
      );

      await intakeQuery(
        `CREATE TRIGGER
           qa_r2_fail_status_event_trigger
         BEFORE INSERT ON public_intake_events
         FOR EACH ROW
         WHEN (
           NEW.request_id =
             '${fixture.id}'::uuid
           AND NEW.event_type =
             'request.status_changed'
         )
         EXECUTE FUNCTION
           qa_r2_fail_status_event()`
      );

      try {
        const response = await POST(
          actionRequest(
            JSON.stringify({
              action: 'under_review',
            }),
            'batch5-rollback',
            actorUserId
          ),
          {
            params: Promise.resolve({
              requestId: fixture.id,
            }),
          }
        );

        assert(
          response.status === 500,
          'forced event failure returns generic 500'
        );

        assert(
          await requestStatus(fixture.id) ===
            'received',
          'event failure rolls the status update back'
        );

        assert(
          await countStatusEvents(
            fixture.id
          ) === 0,
          'event failure leaves no false status event'
        );
      } finally {
        await intakeQuery(
          `DROP TRIGGER IF EXISTS
             qa_r2_fail_status_event_trigger
           ON public_intake_events`
        );

        await intakeQuery(
          `DROP FUNCTION IF EXISTS
             qa_r2_fail_status_event()`
        );
      }
    }

    section(
      '8. Concurrent actions serialize and exactly one commits'
    );

    {
      const fixture =
        await createRequestFixture('received');
      createdRequestIds.push(fixture.id);

      const observedStatuses: string[] = [];
      let releaseGate: (() => void) | null = null;

      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      const afterObserved = async (
        status: string
      ): Promise<void> => {
        observedStatuses.push(status);

        if (observedStatuses.length === 2) {
          releaseGate?.();
        }

        await gate;
      };

      const outcomes = await Promise.race([
        Promise.all([
          applyOperatorAction(
            fixture.id,
            'under_review',
            actorUserId,
            { afterObserved }
          ),
          applyOperatorAction(
            fixture.id,
            'close',
            actorUserId,
            { afterObserved }
          ),
        ]),
        new Promise<never>(
          (_, reject) => {
            setTimeout(
              () => reject(
                new Error(
                  'TIMEOUT: concurrent operator actions did not settle'
                )
              ),
              10000
            );
          }
        ),
      ]);

      assert(
        observedStatuses.length === 2 &&
          observedStatuses.every(
            (status) => status === 'received'
          ),
        'both concurrent actions captured the same received starting status before either transaction began'
      );

      const kinds = outcomes
        .map((outcome) => outcome.kind)
        .sort();

      assert(
        JSON.stringify(kinds) ===
          JSON.stringify([
            'invalid_transition',
            'ok',
          ]),
        'exactly one concurrent action commits and the loser reports invalid_transition'
      );

      assert(
        await countStatusEvents(
          fixture.id
        ) === 1,
        'concurrent loser appends no false status event'
      );

      const finalStatus =
        await requestStatus(fixture.id);

      assert(
        finalStatus === 'under_review' ||
          finalStatus === 'closed',
        'request retains exactly the winning committed status'
      );

      const events =
        await requestEvents(fixture.id);

      const statusEvent = events.find(
        (event) =>
          event.event_type ===
          'request.status_changed'
      );

      assert(
        statusEvent?.detail?.to ===
          finalStatus,
        'the only status event matches the winning status'
      );
    }

    section(
      '9. Structural transaction and route boundary checks'
    );

    {
      const serviceSource = readFileSync(
        new URL(
          '../../src/lib/intake/operator-actions.service.ts',
          import.meta.url
        ),
        'utf8'
      );

      const routeSource = readFileSync(
        new URL(
          '../../src/app/api/internal/operations/intake-requests/[requestId]/actions/route.ts',
          import.meta.url
        ),
        'utf8'
      );

      assert(
        serviceSource.includes(
          'withIntakeTransaction'
        ),
        'action service uses the shared transaction helper'
      );

      assert(
        serviceSource.includes(
          'lockRequestForUpdate'
        ),
        'action service locks the request row FOR UPDATE'
      );

      assert(
        serviceSource.includes(
          'locked.status !== observed.status'
        ),
        'action service detects a concurrently advanced status snapshot'
      );

      assert(
        serviceSource.includes(
          'recordEventInTransaction'
        ),
        'action audit is inserted inside the write transaction'
      );

      for (const forbidden of [
        'fetch(',
        'sendEmail',
        'recordPostCommitEvent',
        'storage',
        'console.log',
        'console.error',
      ]) {
        assert(
          serviceSource.includes(
            forbidden
          ) === false,
          `action transaction contains no ${forbidden}`
        );
      }

      assert(
        routeSource.indexOf(
          'if (!isValidIntakeServiceRequest(request))'
        ) <
          routeSource.indexOf(
            'const actorUserId ='
          ),
        'route authenticates the service before actor attribution'
      );

      assert(
        routeSource.includes(
          'operatorActionBodySchema.safeParse'
        ) &&
          routeSource.includes(
            'operatorActionSchema.safeParse'
          ),
        'route distinguishes malformed bodies from unsupported actions'
      );

      assert(
        routeSource.includes(
          'INTAKE_OPS_SECRET'
        ) === false &&
          routeSource.includes(
            'isValidOpsSecret'
          ) === false,
        'action route never uses the legacy ops-secret path'
      );

      assert(
        routeSource.includes(
          'no-store, private'
        ),
        'action responses are not cacheable'
      );
    }
  } finally {
    await intakeQuery(
      `DROP TRIGGER IF EXISTS
         qa_r2_fail_status_event_trigger
       ON public_intake_events`
    ).catch(() => undefined);

    await intakeQuery(
      `DROP FUNCTION IF EXISTS
         qa_r2_fail_status_event()`
    ).catch(() => undefined);

    for (
      const requestId of createdRequestIds
    ) {
      await deleteRequestFixture(
        requestId
      );
    }
  }

  const remaining =
    await intakeQuery<CountRow>(
      `SELECT count(*)::text AS count
       FROM public_intake_requests
       WHERE first_name = 'Batch5'
         AND last_name = 'ActionTester'`
    );

  assert(
    Number(remaining[0]?.count ?? 0) === 0,
    'action route QA removes every request fixture'
  );

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    'r2-internal-action-route.qa.ts failed:',
    error
  );
  process.exitCode = 1;
});

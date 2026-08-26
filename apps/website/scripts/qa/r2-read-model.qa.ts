// ============================================================
// PHX-LAUNCH-002 R2 — Website operator read-model QA
// Runs against the disposable local PostgreSQL database only.
// ============================================================

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assert, section, printSummaryAndExit } from './assert';
import {
  decodeOperatorQueueCursor,
  encodeOperatorQueueCursor,
  operatorQueueQuerySchema,
} from '../../src/lib/intake/schema';
import {
  escapeOperatorQueueSearch,
  findOperatorRequestDetailById,
  queryOperatorQueue,
  type IntakeRequestStatus,
} from '../../src/lib/intake/repositories/intake-requests.repository';
import { listOperatorActionsForRequest } from '../../src/lib/intake/repositories/intake-events.repository';
import { intakeQuery } from '../../src/lib/intake/db';

interface SeededRequest {
  id: string;
  publicReference: string;
  workEmail: string;
  message: string;
}

async function createRequest(input: {
  prefix: string;
  index: number;
  status: IntakeRequestStatus;
  requestType: 'assessment' | 'demo' | 'general';
  createdAt: string;
  company: string;
  firstName?: string;
  lastName?: string;
}): Promise<SeededRequest> {
  const id = randomUUID();
  const publicReference = `PHX-R2-${input.prefix}-${input.index}`;
  const workEmail = `${input.prefix.toLowerCase()}-${input.index}@example.test`;
  const message = `private-message-${input.prefix}-${input.index}`;

  await intakeQuery(
    `INSERT INTO public_intake_requests (
       id,
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
       status,
       privacy_consent,
       privacy_version,
       terms_version,
       marketing_consent,
       consent_timestamp,
       idempotency_key_hash,
       ip_hash,
       created_at,
       updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,'QA Operator','+971000000000','AE',
       'Within 30 days',$8,$9,true,'qa-privacy','qa-terms',false,
       $10,$11,$12,$10,$10
     )`,
    [
      id,
      publicReference,
      input.requestType,
      input.firstName ?? 'Queue',
      input.lastName ?? `Tester${input.index}`,
      workEmail,
      input.company,
      message,
      input.status,
      input.createdAt,
      randomUUID(),
      `qa-ip-hash-${input.prefix}-${input.index}`,
    ]
  );

  return { id, publicReference, workEmail, message };
}

async function createSession(
  requestId: string,
  status: 'active' | 'used' | 'revoked' | 'expired',
  createdAt: string
): Promise<string> {
  const id = randomUUID();

  await intakeQuery(
    `INSERT INTO public_upload_sessions (
       id,
       request_id,
       token_hash,
       status,
       max_files,
       max_file_size_bytes,
       max_total_size_bytes,
       expires_at,
       used_at,
       revoked_at,
       finalized_at,
       created_at
     ) VALUES (
       $1,$2,$3,$4,5,20971520,62914560,
       $5::timestamptz + interval '2 days',
       CASE WHEN $4 = 'used' THEN $5::timestamptz ELSE NULL END,
       CASE WHEN $4 = 'revoked' THEN $5::timestamptz ELSE NULL END,
       CASE WHEN $4 = 'used' THEN $5::timestamptz ELSE NULL END,
       $5
     )`,
    [id, requestId, randomUUID(), status, createdAt]
  );

  return id;
}

async function createFile(
  requestId: string,
  sessionId: string,
  status: 'reserved' | 'completed',
  index: number
): Promise<void> {
  await intakeQuery(
    `INSERT INTO public_intake_files (
       id,
       request_id,
       upload_session_id,
       storage_object_key,
       original_filename,
       declared_content_type,
       declared_size_bytes,
       reservation_status,
       verified_content_type,
       verified_size_bytes,
       scan_status,
       created_at,
       completed_at,
       reservation_key_hash
     ) VALUES (
       $1,$2,$3,$4,$5,'application/pdf',1024,$6,
       CASE WHEN $6 = 'completed' THEN 'application/pdf' ELSE NULL END,
       CASE WHEN $6 = 'completed' THEN 1024 ELSE NULL END,
       'pending_review',
       now(),
       CASE WHEN $6 = 'completed' THEN now() ELSE NULL END,
       $7
     )`,
    [
      randomUUID(),
      requestId,
      sessionId,
      `r2-qa/${randomUUID()}`,
      `qa-${index}.pdf`,
      status,
      randomUUID(),
    ]
  );
}

async function createStatusEvent(
  requestId: string,
  detail: Record<string, unknown>,
  createdAt: string
): Promise<void> {
  await intakeQuery(
    `INSERT INTO public_intake_events (
       id,
       request_id,
       event_type,
       detail,
       created_at
     ) VALUES ($1,$2,'request.status_changed',$3::jsonb,$4)`,
    [randomUUID(), requestId, JSON.stringify(detail), createdAt]
  );
}

async function main(): Promise<void> {
  const createdRequestIds: string[] = [];
  const prefix = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();

  try {
    section('1. Strict query validation and cursor contract');

    const defaults = operatorQueueQuerySchema.safeParse({});
    assert(defaults.success, 'an empty body is accepted as the default queue query');
    if (defaults.success) {
      assert(defaults.data.limit === 25, 'the default queue limit is 25');
      assert(defaults.data.statuses.length === 0, 'the default status filter is empty');
      assert(defaults.data.requestTypes.length === 0, 'the default request-type filter is empty');
    }

    assert(
      !operatorQueueQuerySchema.safeParse({ unexpected: true }).success,
      'unknown query properties are rejected'
    );
    assert(
      !operatorQueueQuerySchema.safeParse({
        statuses: ['received', 'received'],
      }).success,
      'duplicate statuses are rejected'
    );
    assert(
      !operatorQueueQuerySchema.safeParse({
        requestTypes: ['demo', 'demo'],
      }).success,
      'duplicate request types are rejected'
    );
    assert(
      !operatorQueueQuerySchema.safeParse({
        createdFrom: '2026-08-02T00:00:00.000Z',
        createdTo: '2026-08-01T00:00:00.000Z',
      }).success,
      'an inverted creation-date range is rejected'
    );
    assert(
      !operatorQueueQuerySchema.safeParse({ limit: 101 }).success,
      'a queue limit above 100 is rejected'
    );
    assert(
      !operatorQueueQuerySchema.safeParse({ cursor: 'not-a-valid-cursor' }).success,
      'a malformed opaque cursor is rejected'
    );

    const cursor = encodeOperatorQueueCursor({
      createdAt: '2026-08-01T10:00:00.000Z',
      requestId: randomUUID(),
    });
    const decodedCursor = decodeOperatorQueueCursor(cursor);
    assert(decodedCursor !== null, 'a canonical queue cursor round-trips');
    assert(
      Object.keys(decodedCursor ?? {}).sort().join(',') === 'createdAt,requestId',
      'the decoded cursor contains only createdAt and requestId'
    );
    assert(
      operatorQueueQuerySchema.safeParse({ cursor }).success,
      'a structurally valid cursor passes query validation'
    );

    section('2. Literal search escaping');

    assert(
      escapeOperatorQueueSearch('100%_\\') === '100\\%\\_\\\\',
      'percent, underscore, and backslash are escaped for literal ILIKE semantics'
    );

    section('3. Seed isolated request, session, file, and event fixtures');

    const sharedCompany = `${prefix} Acme 100%_Lab`;
    const createdTimes = [
      '2026-08-01T10:04:00.000Z',
      '2026-08-01T10:03:00.000Z',
      '2026-08-01T10:02:00.000Z',
      '2026-08-01T10:02:00.000Z',
    ];

    const requests: SeededRequest[] = [];

    for (let index = 0; index < 4; index += 1) {
      const request = await createRequest({
        prefix,
        index,
        status: 'received',
        requestType: 'assessment',
        createdAt: createdTimes[index],
        company: sharedCompany,
        firstName: index === 0 ? 'Literal' : 'Queue',
        lastName: index === 0 ? 'Wildcard' : `Tester${index}`,
      });
      requests.push(request);
      createdRequestIds.push(request.id);
    }

    const unrelated = await createRequest({
      prefix,
      index: 99,
      status: 'quoted',
      requestType: 'demo',
      createdAt: '2026-08-01T10:05:00.000Z',
      company: `${prefix} Unrelated`,
    });
    createdRequestIds.push(unrelated.id);

    const oldSession = await createSession(
      requests[0].id,
      'revoked',
      '2026-08-01T11:00:00.000Z'
    );
    const latestSession = await createSession(
      requests[0].id,
      'used',
      '2026-08-01T12:00:00.000Z'
    );

    for (let index = 0; index < 3; index += 1) {
      await createFile(requests[0].id, oldSession, 'completed', index);
    }
    await createFile(requests[0].id, latestSession, 'completed', 10);
    await createFile(requests[0].id, latestSession, 'completed', 11);
    await createFile(requests[0].id, latestSession, 'reserved', 12);

    const actorOne = randomUUID();
    const actorTwo = randomUUID();

    await createStatusEvent(
      requests[0].id,
      {
        source: 'phoenix_backend',
        actorUserId: actorOne,
        from: 'received',
        to: 'under_review',
      },
      '2026-08-01T13:00:00.000Z'
    );
    await createStatusEvent(
      requests[0].id,
      {
        source: 'website_ops',
        actorUserId: randomUUID(),
        from: 'under_review',
        to: 'quoted',
      },
      '2026-08-01T13:01:00.000Z'
    );
    await createStatusEvent(
      requests[0].id,
      {
        source: 'phoenix_backend',
        actorUserId: 'not-a-uuid',
        from: 'under_review',
        to: 'quoted',
      },
      '2026-08-01T13:02:00.000Z'
    );
    await createStatusEvent(
      requests[0].id,
      {
        source: 'phoenix_backend',
        actorUserId: randomUUID(),
        from: 'invalid',
        to: 'quoted',
      },
      '2026-08-01T13:03:00.000Z'
    );
    await createStatusEvent(
      requests[0].id,
      {
        source: 'phoenix_backend',
        actorUserId: actorTwo,
        from: 'under_review',
        to: 'quoted',
      },
      '2026-08-01T13:04:00.000Z'
    );

    assert(createdRequestIds.length === 5, 'five isolated request fixtures were created');

    section('4. Search, filters, total, ordering, and keyset pagination');

    const parsedQuery = operatorQueueQuerySchema.parse({
      search: `${prefix} Acme 100%_Lab`,
      statuses: ['received'],
      requestTypes: ['assessment'],
      createdFrom: '2026-08-01T10:00:00.000Z',
      createdTo: '2026-08-01T10:10:00.000Z',
      limit: 2,
    });

    const firstPage = await queryOperatorQueue(parsedQuery);
    assert(firstPage.total === 4, 'total counts all filtered rows before cursor pagination');
    assert(firstPage.items.length === 2, 'the first page respects the requested limit');
    assert(firstPage.nextCursor !== null, 'the first page returns an opaque next cursor');

    const secondPage = await queryOperatorQueue({
      ...parsedQuery,
      cursor: firstPage.nextCursor ?? undefined,
    });

    assert(secondPage.total === 4, 'the second page preserves the unpaginated filtered total');
    assert(secondPage.items.length === 2, 'the second page returns the remaining rows');
    assert(secondPage.nextCursor === null, 'the final page has no next cursor');

    const combinedIds = [
      ...firstPage.items.map((item) => item.requestId),
      ...secondPage.items.map((item) => item.requestId),
    ];
    assert(new Set(combinedIds).size === 4, 'keyset pagination returns no duplicate request rows');

    const expectedOrderRows = await intakeQuery<{ id: string }>(
      `SELECT id
       FROM public_intake_requests
       WHERE company = $1
         AND status = 'received'
         AND request_type = 'assessment'
       ORDER BY created_at DESC, id DESC`,
      [sharedCompany]
    );
    assert(
      combinedIds.join(',') === expectedOrderRows.map((row) => row.id).join(','),
      'queue order is deterministically created_at DESC then id DESC'
    );

    const expectedQueueKeys = [
      'company',
      'createdAt',
      'fileCount',
      'publicReference',
      'requestId',
      'requestType',
      'status',
      'updatedAt',
      'uploadSessionStatus',
    ].sort();
    assert(
      Object.keys(firstPage.items[0] ?? {}).sort().join(',') === expectedQueueKeys.join(','),
      'queue items expose only the approved summary projection'
    );

    const literalSearch = await queryOperatorQueue(
      operatorQueueQuerySchema.parse({
        search: '100%_Lab',
        statuses: ['received'],
        limit: 25,
      })
    );
    assert(literalSearch.total === 4, 'client wildcard characters retain literal search semantics');

    const emailSearch = await queryOperatorQueue(
      operatorQueueQuerySchema.parse({
        search: requests[1].workEmail,
        limit: 25,
      })
    );
    assert(
      emailSearch.total === 1 && emailSearch.items[0]?.requestId === requests[1].id,
      'normalized work-email search resolves exactly one request'
    );

    const nameSearch = await queryOperatorQueue(
      operatorQueueQuerySchema.parse({
        search: 'Literal Wildcard',
        limit: 25,
      })
    );
    assert(
      nameSearch.total === 1 && nameSearch.items[0]?.requestId === requests[0].id,
      'combined first-name plus last-name search resolves the request'
    );

    const sessionSummary = await queryOperatorQueue(
      operatorQueueQuerySchema.parse({
        search: requests[0].publicReference,
        limit: 25,
      })
    );
    assert(
      sessionSummary.items[0]?.uploadSessionStatus === 'used',
      'queue summary uses the latest upload session by created_at and id'
    );
    assert(
      sessionSummary.items[0]?.fileCount === 2,
      'queue file count includes completed files from the latest session only'
    );

    const serializedQueue = JSON.stringify(sessionSummary);
    assert(
      !serializedQueue.includes(requests[0].message) &&
        !serializedQueue.includes(requests[0].workEmail),
      'queue serialization contains neither the private message nor work email'
    );

    section('5. Privacy-minimized request detail');

    const detail = await findOperatorRequestDetailById(requests[0].id);
    assert(detail !== null, 'operator detail resolves an internal request UUID');

    const expectedDetailKeys = [
      'company',
      'country',
      'createdAt',
      'estimatedTimeline',
      'fileCount',
      'firstName',
      'lastName',
      'message',
      'phone',
      'publicReference',
      'requestId',
      'requestType',
      'role',
      'status',
      'updatedAt',
      'uploadSessionStatus',
      'workEmail',
    ].sort();

    assert(
      Object.keys(detail ?? {}).sort().join(',') === expectedDetailKeys.join(','),
      'detail exposes exactly the approved request projection'
    );
    assert(detail?.fileCount === 2, 'detail uses the latest-session completed file count');
    assert(detail?.uploadSessionStatus === 'used', 'detail exposes the latest session status');

    const serializedDetail = JSON.stringify(detail);
    for (const forbidden of [
      'privacyVersion',
      'termsVersion',
      'marketingConsent',
      'consentTimestamp',
      'idempotency',
      'ipHash',
      'tokenHash',
      'storageObjectKey',
      'originalFilename',
    ]) {
      assert(
        !serializedDetail.includes(forbidden),
        `detail serialization excludes ${forbidden}`
      );
    }

    section('6. Sanitized operator-action history');

    const actions = await listOperatorActionsForRequest(requests[0].id);
    assert(actions.length === 2, 'only valid Phoenix Backend status events are returned');
    assert(actions[0]?.actorUserId === actorOne, 'operator actions retain chronological order');
    assert(actions[1]?.actorUserId === actorTwo, 'the second valid action follows the first');
    assert(
      Object.keys(actions[0] ?? {}).sort().join(',') ===
        ['actorUserId', 'createdAt', 'eventId', 'from', 'to'].sort().join(','),
      'operator-action history exposes only the approved sanitized fields'
    );

    section('7. Migration and structural source checks');

    const requiredIndexes = [
      'idx_intake_requests_queue_order',
      'idx_intake_requests_status_queue',
      'idx_intake_requests_type_queue',
      'idx_upload_sessions_request_latest',
      'idx_intake_files_session_completed',
      'idx_intake_events_request_history',
    ];
    const indexRows = await intakeQuery<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname = ANY($1::text[])`,
      [requiredIndexes]
    );
    assert(
      new Set(indexRows.map((row) => row.indexname)).size === requiredIndexes.length,
      'all six additive read-model indexes exist'
    );

    const migrationRows = await intakeQuery<{ filename: string }>(
      `SELECT filename
       FROM intake_schema_migrations
       WHERE filename IN (
         '0001_public_intake_schema.sql',
         '0002_operator_queue_indexes.sql'
       )
       ORDER BY filename`
    );
    assert(migrationRows.length === 2, 'both Website migrations are recorded as applied');

    const requestRepositorySource = readFileSync(
      new URL(
        '../../src/lib/intake/repositories/intake-requests.repository.ts',
        import.meta.url
      ),
      'utf8'
    );
    const eventRepositorySource = readFileSync(
      new URL(
        '../../src/lib/intake/repositories/intake-events.repository.ts',
        import.meta.url
      ),
      'utf8'
    );

    assert(
      requestRepositorySource.includes('ORDER BY r.created_at DESC, r.id DESC'),
      'queue repository fixes deterministic keyset ordering'
    );
    assert(
      requestRepositorySource.includes("ESCAPE '\\\\'"),
      'queue repository declares an explicit LIKE escape character'
    );
    assert(
      eventRepositorySource.includes("detail->>'source' = 'phoenix_backend'"),
      'operator history is restricted to Phoenix Backend events'
    );

    section('8. Missing detail returns null');

    assert(
      (await findOperatorRequestDetailById(randomUUID())) === null,
      'an unknown internal request UUID returns no detail row'
    );
  } finally {
    if (createdRequestIds.length > 0) {
      await intakeQuery(
        `DELETE FROM public_intake_requests
         WHERE id = ANY($1::uuid[])`,
        [createdRequestIds]
      );
    }
  }

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('r2-read-model.qa.ts failed:', error);
  process.exitCode = 1;
});

// ============================================================
// QA: PHX-LAUNCH-002-R2 Website service-auth foundation
// ------------------------------------------------------------
// Pure helper verification. No database, network, route handler,
// real credential, or deployed environment is used.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';

const SERVICE_SECRET = 'qa-service-secret-base64url-0123456789_ABCD';
const OPS_SECRET = 'qa-legacy-ops-secret-kept-separate-9876543210';

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};

  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }

  try {
    return fn();
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function requestWithHeaders(headers: Record<string, string> = {}): Request {
  return new Request('https://phoenixops.ai/api/internal/operations/intake-requests/query', {
    method: 'POST',
    headers,
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function main() {
  const {
    getIntakeServiceBearerToken,
    getIntakeServiceRequestId,
    intakeServiceUnauthorizedResponse,
    isValidIntakeServiceRequest,
    isValidOpsSecret,
  } = await import('../../src/lib/intake/http');

  section('1. Exact dedicated Bearer extraction');

  assert(
    getIntakeServiceBearerToken(requestWithHeaders()) === null,
    'missing Authorization header is rejected'
  );

  assert(
    getIntakeServiceBearerToken(
      requestWithHeaders({ authorization: `bearer ${SERVICE_SECRET}` })
    ) === null,
    'wrong-case bearer scheme is rejected'
  );

  assert(
    getIntakeServiceBearerToken(
      requestWithHeaders({ authorization: `Bearer  ${SERVICE_SECRET}` })
    ) === null,
    'an extra separator space is rejected'
  );

  assert(
    getIntakeServiceBearerToken(
      requestWithHeaders({ authorization: `Bearer\t${SERVICE_SECRET}` })
    ) === null,
    'a tab separator is rejected'
  );

  assert(
    getIntakeServiceBearerToken(
      requestWithHeaders({
        authorization: `Bearer ${SERVICE_SECRET}, Bearer ${SERVICE_SECRET}`,
      })
    ) === null,
    'comma-joined duplicate Authorization values are rejected'
  );

  assert(
    getIntakeServiceBearerToken(
      requestWithHeaders({ authorization: `Bearer ${SERVICE_SECRET}` })
    ) === SERVICE_SECRET,
    'one exact non-empty Bearer credential is extracted'
  );

  section('2. Dedicated service-secret validation fails closed');

  withEnv(
    {
      INTAKE_SERVICE_SECRET: undefined,
      INTAKE_OPS_SECRET: OPS_SECRET,
    },
    () => {
      assert(
        isValidIntakeServiceRequest(
          requestWithHeaders({ authorization: `Bearer ${OPS_SECRET}` })
        ) === false,
        'missing dedicated configuration rejects the legacy ops secret'
      );
    }
  );

  withEnv(
    {
      INTAKE_SERVICE_SECRET: SERVICE_SECRET,
      INTAKE_OPS_SECRET: OPS_SECRET,
    },
    () => {
      assert(
        isValidIntakeServiceRequest(
          requestWithHeaders({ authorization: `Bearer ${OPS_SECRET}` })
        ) === false,
        'INTAKE_OPS_SECRET is never accepted as a service-secret fallback'
      );

      assert(
        isValidIntakeServiceRequest(
          requestWithHeaders({ authorization: 'Bearer wrong-length' })
        ) === false,
        'a wrong-length credential is rejected'
      );

      assert(
        isValidIntakeServiceRequest(
          requestWithHeaders({ authorization: `Bearer ${SERVICE_SECRET}` })
        ) === true,
        'the configured dedicated service credential is accepted'
      );
    }
  );

  section('3. Legacy ops-secret path remains separate and unchanged');

  withEnv(
    {
      INTAKE_SERVICE_SECRET: SERVICE_SECRET,
      INTAKE_OPS_SECRET: OPS_SECRET,
    },
    () => {
      assert(
        isValidOpsSecret(
          requestWithHeaders({ 'x-intake-ops-secret': OPS_SECRET })
        ) === true,
        'the existing x-intake-ops-secret path still accepts its own secret'
      );

      assert(
        isValidOpsSecret(
          requestWithHeaders({ 'x-intake-ops-secret': SERVICE_SECRET })
        ) === false,
        'the dedicated service secret is not aliased into the legacy ops path'
      );
    }
  );

  section('4. Bounded X-Phoenix-Request-Id handling');

  const acceptedRequestId = 'req_01JABCDEF-0123:worker.7';
  assert(
    getIntakeServiceRequestId(
      requestWithHeaders({ 'x-phoenix-request-id': acceptedRequestId })
    ) === acceptedRequestId,
    'a bounded request identifier is preserved exactly'
  );

  const fetchNormalizedLeadingRequest = requestWithHeaders({
    'x-phoenix-request-id': ' leading-space-id',
  });
  assert(
    fetchNormalizedLeadingRequest.headers.get('x-phoenix-request-id') ===
      'leading-space-id',
    'Fetch normalizes leading optional whitespace before the helper receives the header'
  );
  assert(
    getIntakeServiceRequestId(fetchNormalizedLeadingRequest) ===
      'leading-space-id',
    'a transport-normalized valid ASCII request identifier is preserved'
  );

  const requestWithRawRequestId = (value: string | null): Request =>
    ({
      headers: {
        get(name: string): string | null {
          return name.toLowerCase() === 'x-phoenix-request-id'
            ? value
            : null;
        },
      },
    }) as unknown as Request;

  for (const [label, value] of [
    ['missing', null],
    ['raw leading whitespace', ' invalid'],
    ['raw trailing whitespace', 'invalid '],
    ['embedded whitespace', 'invalid request id'],
    ['comma joined', 'request-a,request-b'],
    ['oversized', 'r'.repeat(129)],
    ['raw non-ASCII', 'طلب-123'],
  ] as const) {
    const resolved = getIntakeServiceRequestId(
      requestWithRawRequestId(value)
    );

    assert(
      isUuid(resolved),
      `${label} request id is replaced with a fresh UUID`
    );
  }

  const latinOneRequest = requestWithHeaders({
    'x-phoenix-request-id': 'request-é',
  });
  assert(
    latinOneRequest.headers.get('x-phoenix-request-id') === 'request-é',
    'Fetch accepts a transport-valid Latin-1 non-ASCII header value'
  );
  assert(
    isUuid(getIntakeServiceRequestId(latinOneRequest)),
    'a transport-valid Latin-1 non-ASCII request id is replaced with a fresh UUID'
  );

  section('5. Generic internal-auth failure response');

  const unauthorized = intakeServiceUnauthorizedResponse('req-r2-auth-qa');
  assert(
    unauthorized.status === 401,
    'service authentication failure returns HTTP 401'
  );

  const unauthorizedBody = (await unauthorized.json()) as {
    error: string;
    requestId: string;
  };

  assert(
    unauthorizedBody.error === 'Unauthorized.',
    'service authentication failure uses one generic message'
  );

  assert(
    unauthorizedBody.requestId === 'req-r2-auth-qa',
    'generic failure response preserves only the validated request id'
  );

  section('6. Structural constant-time and no-fallback proof');

  const fs = await import('node:fs');
  const httpSource = fs.readFileSync(
    new URL('../../src/lib/intake/http.ts', import.meta.url),
    'utf8'
  );
  const configSource = fs.readFileSync(
    new URL('../../src/lib/intake/config.ts', import.meta.url),
    'utf8'
  );

  assert(
    httpSource.includes('timingSafeEqual('),
    'live helper uses Node timingSafeEqual'
  );

  assert(
    httpSource.includes("createHash('sha256')"),
    'both secrets are normalized to equal-length SHA-256 digests'
  );

  assert(
    configSource.includes("requireServerEnv('INTAKE_OPS_SECRET')"),
    'legacy ops-secret configuration remains present'
  );

  assert(
    configSource.includes("optionalServerEnv('INTAKE_SERVICE_SECRET')"),
    'dedicated service-secret configuration is separate and lazy'
  );

  assert(
    !httpSource.includes('serverConfig.intakeOpsSecret ??') &&
      !httpSource.includes('serverConfig.intakeOpsSecret ||'),
    'service authentication contains no legacy-secret fallback expression'
  );

  printSummaryAndExit();

  if (!process.exitCode) {
    // eslint-disable-next-line no-console
    console.log(
      'RESULT: PHX-LAUNCH-002-R2 WEBSITE SERVICE AUTH FOUNDATION QA PASSED'
    );
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('r2-service-auth.qa.ts failed:', error);
  process.exitCode = 1;
});

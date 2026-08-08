// ============================================================
// PHX-LAUNCH-002-R2 — Backend Foundation QA
// ------------------------------------------------------------
// Source-structure and environment-contract checks for the first R2
// implementation batch. No route, database, or outbound HTTP call is
// executed by this file.
// ============================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getBackendEnv,
  isIntakeServiceConfigured,
} from '../../src/config/env';

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${label}`);
  }
  console.log(`PASS: ${label}`);
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function withEnvironment(
  values: Record<string, string | undefined>,
  run: () => void
): void {
  const previous = new Map<string, string | undefined>();

  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

const repositorySource = source('src/repositories/auth.repository.ts');
const actorSource = source('src/auth/request-actor.ts');
const envSource = source('src/config/env.ts');
const responseSource = source('src/contracts/api-response.ts');
const envExampleSource = source('.env.example');

assert(
  repositorySource.includes(
    "export type PlatformRole = 'SuperAdmin' | 'StandardUser' | 'ServiceAccount';"
  ),
  'auth repository defines the exact platform-role union'
);
assert(
  repositorySource.includes('SELECT id, email, display_name, platform_role'),
  'getUserById selects the database-owned platform_role'
);
assert(
  repositorySource.includes('platformRole: row.platform_role'),
  'getUserById maps platform_role into UserRecord'
);

const guardStart = actorSource.indexOf(
  'export async function requirePlatformSuperAdmin'
);
const nextSection = actorSource.indexOf(
  '/**\n * Resolves a full RequestActor',
  guardStart
);
assert(guardStart >= 0 && nextSection > guardStart, 'global SuperAdmin guard exists');

const guardSource = actorSource.slice(guardStart, nextSection);
assert(
  (guardSource.match(/getActorResolver\(\)\.resolveUserId\(req\)/g) ?? [])
    .length === 1,
  'global guard resolves the actor source exactly once'
);
assert(
  guardSource.indexOf('requireDatabase(res)') <
    guardSource.indexOf('getUserById(resolution.userId)'),
  'global guard checks database availability before user lookup'
);
assert(
  guardSource.includes("user.platformRole !== 'SuperAdmin'"),
  'global guard rejects every non-SuperAdmin platform role'
);
assert(
  !guardSource.includes('getActorForWorkspace') &&
    !guardSource.includes('workspaceId') &&
    !guardSource.includes('membership'),
  'global guard does not depend on workspace membership'
);
assert(
  guardSource.includes('id: user.id') &&
    guardSource.includes('email: user.email') &&
    guardSource.includes('displayName: user.displayName'),
  'global guard returns only database-derived operator identity'
);

assert(
  envSource.includes('export interface PhoenixIntakeServiceConfig'),
  'Backend environment exposes the intake-service config type'
);
assert(
  envSource.includes("readEnvVar('PHOENIX_INTAKE_SERVICE_BASE_URL')") &&
    envSource.includes("readEnvVar('PHOENIX_INTAKE_SERVICE_SECRET')") &&
    envSource.includes("readEnvVar('PHOENIX_INTAKE_SERVICE_TIMEOUT_MS')"),
  'Backend environment reads all three dedicated R2 variables'
);
assert(
  !envSource.includes("readEnvVar('INTAKE_OPS_SECRET')"),
  'Backend environment has no INTAKE_OPS_SECRET fallback'
);

withEnvironment(
  {
    PHOENIX_INTAKE_SERVICE_BASE_URL: undefined,
    PHOENIX_INTAKE_SERVICE_SECRET: undefined,
    PHOENIX_INTAKE_SERVICE_TIMEOUT_MS: undefined,
  },
  () => {
    const config = getBackendEnv().intakeService;
    assert(config.baseUrl === undefined, 'missing service base URL remains undefined');
    assert(config.secret === undefined, 'missing service secret remains undefined');
    assert(config.timeoutMs === 5000, 'missing timeout defaults to 5000ms');
    assert(
      isIntakeServiceConfigured(config) === false,
      'missing service configuration fails closed'
    );
  }
);

withEnvironment(
  {
    PHOENIX_INTAKE_SERVICE_BASE_URL: ' https://website.example.test ',
    PHOENIX_INTAKE_SERVICE_SECRET: ' dedicated-r2-secret ',
    PHOENIX_INTAKE_SERVICE_TIMEOUT_MS: '7000',
  },
  () => {
    const config = getBackendEnv().intakeService;
    assert(
      config.baseUrl === 'https://website.example.test',
      'service base URL is trimmed'
    );
    assert(config.secret === 'dedicated-r2-secret', 'service secret is trimmed');
    assert(config.timeoutMs === 7000, 'valid configured timeout is retained');
    assert(
      isIntakeServiceConfigured(config) === true,
      'base URL plus dedicated secret marks the service configured'
    );
  }
);

for (const invalidTimeout of ['0', '-1', 'abc', '30001']) {
  withEnvironment(
    {
      PHOENIX_INTAKE_SERVICE_BASE_URL: 'https://website.example.test',
      PHOENIX_INTAKE_SERVICE_SECRET: 'dedicated-r2-secret',
      PHOENIX_INTAKE_SERVICE_TIMEOUT_MS: invalidTimeout,
    },
    () => {
      assert(
        getBackendEnv().intakeService.timeoutMs === 5000,
        `invalid timeout ${invalidTimeout} fails to the 5000ms default`
      );
    }
  );
}

assert(
  responseSource.includes(
    "INTAKE_SERVICE_UNAVAILABLE: 'INTAKE_SERVICE_UNAVAILABLE'"
  ),
  'stable INTAKE_SERVICE_UNAVAILABLE code exists'
);
assert(
  responseSource.includes("INTAKE_SERVICE_ERROR: 'INTAKE_SERVICE_ERROR'"),
  'stable INTAKE_SERVICE_ERROR code exists'
);

assert(
  envExampleSource.includes('PHOENIX_INTAKE_SERVICE_BASE_URL=') &&
    envExampleSource.includes('PHOENIX_INTAKE_SERVICE_SECRET=') &&
    envExampleSource.includes('# PHOENIX_INTAKE_SERVICE_TIMEOUT_MS=5000'),
  'example environment documents all R2 service variable names'
);
assert(
  !envExampleSource.includes('PHOENIX_INTAKE_SERVICE_SECRET=dedicated'),
  'example environment contains no service-secret value'
);

console.log('RESULT: PHX-LAUNCH-002-R2 BACKEND FOUNDATION QA PASSED');

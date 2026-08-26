import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;

function check(condition, label) {
  if (!condition) throw new Error(label);
  passed += 1;
  console.log(`PASS: ${label}`);
}

const files = [
  'src/lib/auth/preview-auth.server.ts',
  'src/lib/auth/platform-auth.server.ts',
];

for (const file of files) {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8');
  check(
    !/console\.error\([^;]*,\s*err\s*\)/s.test(source),
    `${file} never sends a raw Clerk error to console.error`
  );
  check(
    source.includes('Failed to resolve Clerk session.'),
    `${file} retains a privacy-safe operational signal`
  );
}

const dataSource = readFileSync(resolve(process.cwd(), 'src/lib/platform-data-source.ts'), 'utf8');
const errorMapperStart = dataSource.indexOf('function errorToLiveResult');
const errorMapperEnd = dataSource.indexOf('// ---------------------------------------------------------------------------', errorMapperStart);
const errorMapper = dataSource.slice(errorMapperStart, errorMapperEnd);
check(errorMapperStart >= 0 && errorMapperEnd > errorMapperStart, 'live error mapper is present');
check(
  !/status:\s*'backend-unavailable'[\s\S]{0,160}message:\s*err\.message/.test(errorMapper),
  'backend-unavailable states never expose a raw provider error message'
);
check(
  errorMapper.includes('Live Phoenix data is temporarily unavailable. Please try again later.'),
  'backend-unavailable states retain a privacy-safe customer message'
);

console.log(`\n${passed} passed.`);
console.log('RESULT: PHX-LAUNCH-002-R8 AUTH LOG PRIVACY QA PASSED');

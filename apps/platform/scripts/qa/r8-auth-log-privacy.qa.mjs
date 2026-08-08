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

console.log(`\n${passed} passed.`);
console.log('RESULT: PHX-LAUNCH-002-R8 AUTH LOG PRIVACY QA PASSED');

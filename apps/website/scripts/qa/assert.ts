// ============================================================
// QA assertion helper
// PHX-LAUNCH-001
// ------------------------------------------------------------
// This repo has no vitest/jest anywhere (confirmed by search before
// Gate 2's dependency plan) — QA follows the same standalone
// tsx-script convention already established for apps/backend's
// db:smoke and auth:test-* scripts, not a new test framework.
// ============================================================

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

export function assert(condition: boolean, label: string): void {
  if (condition) {
    passCount += 1;
    // eslint-disable-next-line no-console
    console.log(`  PASS  ${label}`);
  } else {
    failCount += 1;
    failures.push(label);
    // eslint-disable-next-line no-console
    console.log(`  FAIL  ${label}`);
  }
}

export function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
}

export function printSummaryAndExit(): void {
  // eslint-disable-next-line no-console
  console.log(`\n${passCount} passed, ${failCount} failed.`);
  if (failCount > 0) {
    // eslint-disable-next-line no-console
    console.log('Failures:', failures.join(', '));
    process.exitCode = 1;
  }
}

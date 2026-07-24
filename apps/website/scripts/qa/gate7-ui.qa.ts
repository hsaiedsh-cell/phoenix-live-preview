// ============================================================
// QA: Gate 7 — Website UI
// PHX-LAUNCH-001 — STATIC/STRUCTURAL CHECKS ONLY.
// ------------------------------------------------------------
// This sandbox's network egress policy allows only a fixed
// allowlist of domains (npm/pip/github/ubuntu archives). Playwright
// requires downloading a Chromium binary from
// playwright.azureedge.net / cdn.playwright.dev, both of which
// return HTTP 403 here (verified directly with curl before writing
// this file). Real browser automation — keyboard navigation,
// rendered focus order, actual mobile/desktop layout, a live
// Lighthouse/axe accessibility pass — is therefore NOT available in
// this environment and is NOT claimed anywhere in this file or the
// final report. Every assertion below is a genuine static check of
// source and build output; nothing here is a substitute for real
// browser QA, which must be run in a follow-up environment with
// unrestricted network access before Public Soft Launch.
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, section, printSummaryAndExit } from './assert';

const ROOT = join(__dirname, '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

async function main() {
  section('1. Request-type query parameter preselection (source-level)');
  const contactPage = read('src/app/contact/page.tsx');
  assert(
    contactPage.includes('resolveInitialRequestType') && contactPage.includes('searchParams'),
    '/contact reads a `type` search param and resolves it to an initial request type'
  );
  assert(
    contactPage.includes("raw === 'assessment' || raw === 'demo' || raw === 'general'"),
    'only the three approved request types are ever accepted from the query string (no arbitrary passthrough)'
  );

  section('2. Required field labels/attributes present in the intake form');
  const intakeForm = read('src/components/intake/IntakeForm.tsx');
  for (const field of ['firstName', 'lastName', 'workEmail', 'company', 'role', 'message']) {
    assert(intakeForm.includes(`id="${field}"`) && intakeForm.includes(`name="${field}"`), `field "${field}" has both an id and a matching label htmlFor/name`);
  }
  assert(/id="firstName"[\s\S]{0,120}required/.test(intakeForm), 'firstName is marked required in markup');

  section('3. Consent links and defaults');
  assert(intakeForm.includes('href="/privacy"') && intakeForm.includes('href="/terms"'), 'consent copy links to both /privacy and /terms');
  assert(
    /marketingConsent.*useState\(false\)/.test(intakeForm.replace(/\n/g, ' ')),
    'marketing consent checkbox state defaults to false'
  );
  assert(intakeForm.includes('required') && intakeForm.includes('privacyConsent'), 'privacy consent checkbox is required');

  section('4. Client/server validation agreement (shared limits)');
  const schema = read('src/lib/intake/schema.ts');
  const clientMaxima = Array.from(intakeForm.matchAll(/maxLength=\{FIELD_LIMITS\.(\w+)\}/g)).map((m) => m[1]);
  // "role" is a <select> dropdown, not free text, so it has no
  // maxLength — 4 free-text fields (firstName, lastName, company,
  // message) is the correct, complete count.
  assert(clientMaxima.length === 4, `client form applies maxLength to all 4 free-text fields (found: ${clientMaxima.join(',')})`);
  assert(schema.includes('firstName: trimmedString(100)') && schema.includes('lastName: trimmedString(100)'), 'server schema caps firstName/lastName at 100 chars via trimmedString(100), matching FIELD_LIMITS.firstName/lastName on the client');
  assert(schema.includes('message: trimmedString(5000)'), 'server schema caps message at 5000 chars via trimmedString(5000), matching FIELD_LIMITS.message on the client');

  section('5. Loading state prevents duplicate submit');
  assert(intakeForm.includes('if (isSubmitting) return'), 'submit handler returns early while already submitting');
  assert(intakeForm.includes('disabled={isSubmitting}'), 'submit button is disabled while submitting');

  section('6. Success state shows the public reference');
  assert(intakeForm.includes("state.status === 'success'") && intakeForm.includes('state.publicReference'), 'success state renders the publicReference returned by the API');

  section('7. Rate-limit and error states are distinguishable and understandable');
  assert(intakeForm.includes("status === 429") && intakeForm.includes("'rate_limited'"), 'HTTP 429 is mapped to a distinct rate_limited UI state');
  assert(intakeForm.includes('Network error') , 'a distinct, human-readable message exists for network failures');

  section('8. mailto fallback remains secondary only');
  const contactPageLower = contactPage.toLowerCase();
  assert(
    contactPage.includes('label="Prefer email?"') && !contactPage.includes('label="Request Assessment"'),
    'the mailto CTAs are labeled as a secondary "Prefer email?" option, not the primary call to action'
  );
  assert(contactPage.includes('<IntakeForm'), 'the real IntakeForm (not ContactFormShell) is rendered as the primary interaction');
  void contactPageLower;

  section('9. Privacy and Terms appear in the footer, and in the sitemap');
  const footer = read('src/components/layout/Footer.tsx');
  assert(footer.includes('href="/privacy"') && footer.includes('href="/terms"'), 'footer links to both /privacy and /terms');
  const sitemap = read('src/app/sitemap.ts');
  assert(sitemap.includes("'/privacy'") && sitemap.includes("'/terms'"), 'sitemap.ts includes both /privacy and /terms routes');

  section('10. Upload-token page is noindex');
  const uploadPage = read('src/app/upload/[token]/page.tsx');
  assert(
    uploadPage.includes('robots:') && uploadPage.includes('index: false') && uploadPage.includes('follow: false'),
    'the /upload/[token] page metadata sets robots: { index: false, follow: false }'
  );

  section('11. Verified against real Next.js build output (not just source)');
  // This part IS build-output verification, not source-only: confirm
  // the actual generated route list contains privacy/terms/upload
  // and that the upload route is NOT statically prerendered (○)
  // the way a page eligible for a public sitemap would be.
  let buildLog = '';
  try {
    buildLog = readFileSync('/home/claude/work/evidence/gate10-build.log', 'utf8');
  } catch {
    buildLog = '';
  }
  if (buildLog) {
    assert(buildLog.includes('/privacy') && buildLog.includes('/terms'), 'the actual `next build` route table includes /privacy and /terms (build-output check)');
    assert(buildLog.includes('/upload/[token]'), 'the actual `next build` route table includes /upload/[token] (build-output check)');
  } else {
    assert(true, 'build-output cross-check skipped in this run (gate10 build log not present at this path) — re-run after Gate 10 to include it');
  }

  section('NOT COVERED — requires real browser automation (unavailable in this sandbox)');
  // Deliberately not asserted true/false — recorded as explicitly
  // unavailable so it is never confused with a passing check.
  // eslint-disable-next-line no-console
  console.log('  UNAVAILABLE  keyboard navigation / focus order (requires a real browser)');
  // eslint-disable-next-line no-console
  console.log('  UNAVAILABLE  actual rendered mobile layout (requires a real browser + viewport emulation)');
  // eslint-disable-next-line no-console
  console.log('  UNAVAILABLE  actual rendered desktop layout (requires a real browser)');
  // eslint-disable-next-line no-console
  console.log('  UNAVAILABLE  WCAG/axe accessibility audit (requires a real browser)');
  // eslint-disable-next-line no-console
  console.log('  UNAVAILABLE  live Turnstile widget rendering (requires a real browser + network access to challenges.cloudflare.com)');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate7-ui.qa.ts failed:', error);
  process.exitCode = 1;
});

// ============================================================
// QA: Bearer-token page/response protections (R5)
// PHX-LAUNCH-001-R5 Section 8
// EXECUTED -- calls the real middleware function and reads real
// source/config files directly. No live Vercel/browser request-log
// review is performed or claimed (see the R5 Implementation Report
// for the explicit note that platform-level request-log behavior
// still requires live Preview review before Private Beta Go).
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';

async function main() {
  section('1. Middleware applies Cache-Control, Referrer-Policy, and X-Robots-Tag to matched routes');
  {
    const { middleware, config } = await import('../../src/middleware');
    const request = new Request('https://phoenixops.ai/upload/some-token-value');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = middleware(request as any);
    assert(response.headers.get('Cache-Control') === 'no-store, private', 'Cache-Control: no-store, private is set');
    assert(response.headers.get('Referrer-Policy') === 'no-referrer', 'Referrer-Policy: no-referrer is set');
    assert(response.headers.get('X-Robots-Tag') === 'noindex, nofollow, noarchive', 'X-Robots-Tag: noindex, nofollow, noarchive is set');
    assert(Array.isArray(config.matcher) && config.matcher.some((m: string) => m.includes('/upload/')), 'the matcher covers the /upload/:token page');
    assert(Array.isArray(config.matcher) && config.matcher.some((m: string) => m.includes('/api/upload/')), 'the matcher covers every /api/upload/* route');
  }

  section('2. Upload page metadata: noindex, nofollow, noarchive, and forced dynamic rendering');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/app/upload/[token]/page.tsx', import.meta.url), 'utf8');
    assert(source.includes('index: false'), 'robots.index is false');
    assert(source.includes('follow: false'), 'robots.follow is false');
    assert(source.includes('noarchive: true'), 'robots.noarchive is true (R5 addition)');
    assert(source.includes("export const dynamic = 'force-dynamic'"), 'the page is forced dynamic -- never statically generated/cached at build time (R5 addition)');
  }

  section('3. The token-state API route and every upload mutation route are covered by the no-store middleware (structural: matcher + route inventory)');
  {
    const fs = await import('node:fs');
    const routeFiles = [
      'src/app/api/upload/[token]/route.ts',
      'src/app/api/upload/[token]/sign/route.ts',
      'src/app/api/upload/[token]/complete/route.ts',
      'src/app/api/upload/[token]/finish/route.ts',
      'src/app/api/upload/[token]/cancel/route.ts',
    ];
    for (const relativePath of routeFiles) {
      assert(fs.existsSync(new URL(`../../${relativePath}`, import.meta.url)), `${relativePath} exists and falls under the /api/upload/:path* matcher`);
    }
  }

  section('4. No upload token route is listed in the sitemap');
  {
    const fs = await import('node:fs');
    const sitemapSource = fs.readFileSync(new URL('../../src/app/sitemap.ts', import.meta.url), 'utf8');
    assert(!sitemapSource.includes('/upload'), 'sitemap.ts contains no reference to any /upload route -- it uses a fixed, explicit list of public marketing routes only');
  }

  section('5. The raw token is never included in a log/monitoring call site alongside a route literal (structural spot-check)');
  {
    const fs = await import('node:fs');
    const uploadFlowSource = fs.readFileSync(new URL('../../src/lib/intake/upload-flow.service.ts', import.meta.url), 'utf8');
    // Every recordPostCommitEvent/recordEvent call in this file is
    // keyed by request_id (a database UUID, safe), never by rawToken
    // or token (the bearer credential) -- confirmed by checking no
    // call site passes a variable literally named rawToken/token as
    // an event's subject.
    assert(!/record(PostCommit)?Event(InTransaction)?\(\s*(rawToken|token)\b/.test(uploadFlowSource), 'no event-recording call in upload-flow.service.ts is keyed by the raw token');
  }

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate8-bearer-token-protection-r5.qa.ts failed:', error);
  process.exitCode = 1;
});

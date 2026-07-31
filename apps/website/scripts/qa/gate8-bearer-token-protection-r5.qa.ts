// ============================================================
// QA: Fixed-path bearer-token transport protections
// PHX-LAUNCH-001 token-transport migration
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';

async function main() {
  section('1. Middleware protects the fixed upload page and API routes');
  {
    const { middleware, config } = await import('../../src/middleware');
    const request = new Request('https://phoenixops.ai/upload');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = middleware(request as any);
    assert(response.headers.get('Cache-Control') === 'no-store, private', 'Cache-Control: no-store, private is set');
    assert(response.headers.get('Referrer-Policy') === 'no-referrer', 'Referrer-Policy: no-referrer is set');
    assert(response.headers.get('X-Robots-Tag') === 'noindex, nofollow, noarchive', 'X-Robots-Tag: noindex, nofollow, noarchive is set');
    assert(Array.isArray(config.matcher) && config.matcher.includes('/upload'), 'the matcher covers the fixed /upload page');
    assert(Array.isArray(config.matcher) && config.matcher.includes('/api/upload/session/:path*'), 'the matcher covers the fixed upload-session API family');
  }

  section('2. Fixed upload page metadata and fragment-consuming client');
  {
    const fs = await import('node:fs');
    const pageSource = fs.readFileSync(new URL('../../src/app/upload/page.tsx', import.meta.url), 'utf8');
    const clientSource = fs.readFileSync(new URL('../../src/components/intake/UploadClient.tsx', import.meta.url), 'utf8');
    assert(pageSource.includes('index: false'), 'robots.index is false');
    assert(pageSource.includes('follow: false'), 'robots.follow is false');
    assert(pageSource.includes('noarchive: true'), 'robots.noarchive is true');
    assert(pageSource.includes("export const dynamic = 'force-dynamic'"), 'the page is forced dynamic');
    assert(clientSource.includes("window.location.hash.slice(1)"), 'the client reads the credential from the URL fragment');
    assert(clientSource.includes("window.history.replaceState"), 'the client removes the fragment before API traffic');
    assert(!clientSource.includes('localStorage') && !clientSource.includes('sessionStorage') && !clientSource.includes('document.cookie'), 'the client does not persist the credential in browser storage or cookies');
  }

  section('3. Bearer extraction is exact and fails closed');
  {
    const { getUploadBearerToken } = await import('../../src/lib/intake/http');
    const token = 'A'.repeat(43);
    assert(getUploadBearerToken(new Request('https://phoenixops.ai/api/upload/session')) === null, 'missing Authorization header is rejected');
    assert(getUploadBearerToken(new Request('https://phoenixops.ai/api/upload/session', { headers: { Authorization: `bearer ${token}` } })) === null, 'wrong-case scheme is rejected by the exact contract');
    assert(getUploadBearerToken(new Request('https://phoenixops.ai/api/upload/session', { headers: { Authorization: 'Bearer short' } })) === null, 'malformed token length is rejected');
    assert(getUploadBearerToken(new Request('https://phoenixops.ai/api/upload/session', { headers: { Authorization: `Bearer ${token}` } })) === token, 'a valid 43-character base64url bearer token is accepted');
  }

  section('4. Fixed route inventory exists and token-in-path routes are gone');
  {
    const fs = await import('node:fs');
    const fixedRouteFiles = [
      'src/app/api/upload/session/route.ts',
      'src/app/api/upload/session/sign/route.ts',
      'src/app/api/upload/session/complete/route.ts',
      'src/app/api/upload/session/finish/route.ts',
      'src/app/api/upload/session/cancel/route.ts',
    ];
    for (const relativePath of fixedRouteFiles) {
      assert(fs.existsSync(new URL(`../../${relativePath}`, import.meta.url)), `${relativePath} exists under the fixed request path`);
    }
    assert(!fs.existsSync(new URL('../../src/app/api/upload/[token]', import.meta.url)), 'the legacy /api/upload/[token] route tree is removed');
    assert(!fs.existsSync(new URL('../../src/app/upload/[token]', import.meta.url)), 'the legacy /upload/[token] page is removed');
  }

  section('5. Browser API calls use fixed paths and Authorization: Bearer');
  {
    const fs = await import('node:fs');
    const clientSource = fs.readFileSync(new URL('../../src/components/intake/UploadClient.tsx', import.meta.url), 'utf8');
    for (const path of [
      '/api/upload/session',
      '/api/upload/session/sign',
      '/api/upload/session/complete',
      '/api/upload/session/cancel',
      '/api/upload/session/finish',
    ]) {
      assert(clientSource.includes(path), `UploadClient uses fixed path ${path}`);
    }
    assert(clientSource.includes('Authorization: `Bearer ${token}`'), 'UploadClient sends the credential only in Authorization: Bearer');
    assert(!/fetch\(`\/api\/upload\/\$\{/.test(clientSource), 'UploadClient never interpolates a credential into an API path');
  }

  section('6. Invitation transport uses a fragment, not a path segment');
  {
    const fs = await import('node:fs');
    const sessionSource = fs.readFileSync(new URL('../../src/lib/intake/upload-session.service.ts', import.meta.url), 'utf8');
    assert(sessionSource.includes("new URL('/upload', publicConfig.siteUrl)"), 'invitation construction targets the fixed /upload page');
    assert(sessionSource.includes('uploadUrlValue.hash'), 'invitation construction carries the token in the URL fragment');
    assert(!sessionSource.includes('`/upload/${rawToken}`'), 'invitation construction does not place the token in the path');
  }

  section('7. Raw token is never used as an event subject');
  {
    const fs = await import('node:fs');
    const uploadFlowSource = fs.readFileSync(new URL('../../src/lib/intake/upload-flow.service.ts', import.meta.url), 'utf8');
    assert(!/record(PostCommit)?Event(InTransaction)?\(\s*(rawToken|token)\b/.test(uploadFlowSource), 'no event-recording call is keyed by the raw bearer credential');
  }

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate8-bearer-token-protection-r5.qa.ts failed:', error);
  process.exitCode = 1;
});

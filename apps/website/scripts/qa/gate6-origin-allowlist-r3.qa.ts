// ============================================================
// QA: Exact preview-origin allowlist (R3)
// PHX-LAUNCH-001-R3 Section 6
// EXECUTED -- pure functions, no I/O, no network.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { isOriginAllowed, isCrossSiteBrowserRequest } from '../../src/lib/intake/http';

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

function requestWithOrigin(origin: string | undefined): Request {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.origin = origin;
  return new Request('https://phoenixops.ai/api/intake', { method: 'POST', headers });
}

async function main() {
  section('1. Production origin (NEXT_PUBLIC_SITE_URL) is allowed');
  withEnv({ NEXT_PUBLIC_SITE_URL: 'https://phoenixops.ai', ALLOWED_PREVIEW_ORIGINS: undefined }, () => {
    assert(isOriginAllowed(requestWithOrigin('https://phoenixops.ai')) === true, 'the exact production origin is allowed');
  });

  section('2. A configured exact preview origin is allowed');
  withEnv(
    { NEXT_PUBLIC_SITE_URL: 'https://phoenixops.ai', ALLOWED_PREVIEW_ORIGINS: 'https://phoenix-website-git-staging-team.vercel.app' },
    () => {
      assert(
        isOriginAllowed(requestWithOrigin('https://phoenix-website-git-staging-team.vercel.app')) === true,
        'the exact configured preview origin is allowed'
      );
    }
  );

  section('3. An UNCONFIGURED sibling *.vercel.app origin is denied (no more wildcard)');
  withEnv(
    { NEXT_PUBLIC_SITE_URL: 'https://phoenixops.ai', ALLOWED_PREVIEW_ORIGINS: 'https://phoenix-website-git-staging-team.vercel.app' },
    () => {
      assert(
        isOriginAllowed(requestWithOrigin('https://some-other-random-project-xyz123.vercel.app')) === false,
        'a DIFFERENT, unconfigured Vercel project preview origin is denied -- R2\'s broad *.vercel.app wildcard is gone'
      );
    }
  );

  section('4. Cross-site request is denied (unchanged behavior)');
  const crossSiteRequest = new Request('https://phoenixops.ai/api/intake', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } });
  assert(isCrossSiteBrowserRequest(crossSiteRequest) === true, 'Sec-Fetch-Site: cross-site is still detected');

  section('5. A malformed configured preview origin is dropped (fails closed, does not match everything)');
  withEnv({ NEXT_PUBLIC_SITE_URL: 'https://phoenixops.ai', ALLOWED_PREVIEW_ORIGINS: 'not-a-valid-url, , https://also???not valid' }, () => {
    assert(isOriginAllowed(requestWithOrigin('https://phoenixops.ai')) === true, 'production origin is still allowed even when the preview allowlist is entirely malformed');
    assert(isOriginAllowed(requestWithOrigin('https://some-random-preview.vercel.app')) === false, 'a malformed configured entry does not accidentally allow an unrelated origin');
  });

  section('6. A malformed INCOMING Origin header is denied');
  withEnv({ NEXT_PUBLIC_SITE_URL: 'https://phoenixops.ai', ALLOWED_PREVIEW_ORIGINS: undefined }, () => {
    assert(isOriginAllowed(requestWithOrigin('not a url at all')) === false, 'a malformed incoming Origin header fails closed');
  });

  section('7. Missing Origin follows the documented non-browser policy (not rejected by this check alone)');
  withEnv({ NEXT_PUBLIC_SITE_URL: 'https://phoenixops.ai', ALLOWED_PREVIEW_ORIGINS: undefined }, () => {
    assert(isOriginAllowed(requestWithOrigin(undefined)) === true, 'an absent Origin header is not rejected by isOriginAllowed itself (the rest of the anti-abuse stack -- rate limits, Turnstile, Sec-Fetch-Site -- still applies)');
  });

  section('8. Multiple configured preview origins: each is matched exactly, independently');
  withEnv(
    {
      NEXT_PUBLIC_SITE_URL: 'https://phoenixops.ai',
      ALLOWED_PREVIEW_ORIGINS: 'https://preview-one.vercel.app,https://preview-two.vercel.app',
    },
    () => {
      assert(isOriginAllowed(requestWithOrigin('https://preview-one.vercel.app')) === true, 'first configured origin allowed');
      assert(isOriginAllowed(requestWithOrigin('https://preview-two.vercel.app')) === true, 'second configured origin allowed');
      assert(isOriginAllowed(requestWithOrigin('https://preview-three.vercel.app')) === false, 'a third, unconfigured origin is still denied');
    }
  );

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate6-origin-allowlist-r3.qa.ts failed:', error);
  process.exitCode = 1;
});

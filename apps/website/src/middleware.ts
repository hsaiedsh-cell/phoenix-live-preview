// ============================================================
// Website middleware -- bearer-token route protections
// PHX-LAUNCH-001-R5 §8
// ------------------------------------------------------------
// The upload token embedded in /upload/:token and every
// /api/upload/:token/* route is a bearer credential. This adds
// defense-in-depth response headers Next.js's Metadata API alone
// cannot set (Cache-Control, Referrer-Policy, X-Robots-Tag are real
// HTTP response headers, not <meta> tags) so that:
//   - the page/response is never cached by an intermediary or the
//     browser's disk cache (Cache-Control: no-store, private);
//   - the token never leaks via the Referer header when the upload
//     page links out anywhere (Referrer-Policy: no-referrer);
//   - no crawler indexes, follows links from, or archives a cached
//     copy of the page (X-Robots-Tag: noindex, nofollow, noarchive).
// This is defense-in-depth alongside page.tsx's own <meta name="robots">
// export -- the HTTP header applies even to non-HTML responses (the
// JSON API routes), which a <meta> tag cannot.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';

export function middleware(_request: NextRequest): NextResponse {
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'no-store, private');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return response;
}

export const config = {
  matcher: ['/upload/:token', '/api/upload/:path*'],
};

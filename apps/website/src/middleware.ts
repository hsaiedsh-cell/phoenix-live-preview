// ============================================================
// Website middleware -- private upload route protections
// PHX-LAUNCH-001 token-transport migration
// ------------------------------------------------------------
// The raw invitation credential is carried only in the client-side
// URL fragment and Authorization header. It is never present in the
// HTTP request path. These fixed upload page/API routes still receive
// defense-in-depth private/no-cache/no-index response headers.
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
  matcher: ['/upload', '/api/upload/session/:path*'],
};

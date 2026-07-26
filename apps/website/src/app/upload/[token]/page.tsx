import type { Metadata } from 'next';
import { UploadClient } from '@/components/intake/UploadClient';

// Gate 7 / Section 13 requirement: upload-token pages must never be
// indexed — each one is a private, single-use, guessable-if-leaked
// URL and must not appear in search results or sitemaps.
// R5 (§8): noarchive added (no cached copy of a token page should
// ever be servable from a search engine's cache); force-dynamic
// ensures this page is never statically generated/cached at build
// time or by the framework's own data cache -- combined with
// middleware.ts's Cache-Control: no-store, private response header.
export const metadata: Metadata = {
  title: 'Secure Upload',
  robots: { index: false, follow: false, noarchive: true },
};

export const dynamic = 'force-dynamic';

export default async function UploadTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <UploadClient token={token} />;
}

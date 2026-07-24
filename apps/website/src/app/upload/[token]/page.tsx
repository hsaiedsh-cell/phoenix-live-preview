import type { Metadata } from 'next';
import { UploadClient } from '@/components/intake/UploadClient';

// Gate 7 / Section 13 requirement: upload-token pages must never be
// indexed — each one is a private, single-use, guessable-if-leaked
// URL and must not appear in search results or sitemaps.
export const metadata: Metadata = {
  title: 'Secure Upload',
  robots: { index: false, follow: false },
};

export default async function UploadTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <UploadClient token={token} />;
}

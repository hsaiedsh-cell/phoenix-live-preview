import type { Metadata } from 'next';
import { UploadClient } from '@/components/intake/UploadClient';

// The raw upload credential is delivered in the URL fragment
// (/upload#token=...), which is never part of the HTTP request. The
// client consumes and removes it before making the first API call.
// Keep the fixed upload page private and non-cacheable as defense in
// depth alongside middleware.ts's response headers.
export const metadata: Metadata = {
  title: 'Secure Upload',
  robots: { index: false, follow: false, noarchive: true },
};

export const dynamic = 'force-dynamic';

export default function UploadPage() {
  return <UploadClient />;
}

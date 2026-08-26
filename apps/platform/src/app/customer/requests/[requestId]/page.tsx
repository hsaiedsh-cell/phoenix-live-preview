import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CustomerQuoteWorkspace } from '@/components/CustomerQuoteWorkspace';
import { RealApiError } from '@/lib/real-api-client';
import { realGetCustomerPortalRequest } from '@/lib/real-api-client.server';

export default async function CustomerRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  try {
    const detail = await realGetCustomerPortalRequest((await params).requestId);
    return <><Link href="/customer" className="text-sm font-semibold text-phx-cyan">← All requests</Link><CustomerQuoteWorkspace initialDetail={detail} /></>;
  } catch (error) {
    if (error instanceof RealApiError && error.status === 404) notFound();
    return <div className="mt-6 rounded-2xl border border-red-200 bg-white p-8"><h1 className="text-xl font-bold text-phx-navy">Request temporarily unavailable</h1><p className="mt-2 text-sm text-gray-500">Please refresh in a moment. No decision or message was submitted.</p></div>;
  }
}

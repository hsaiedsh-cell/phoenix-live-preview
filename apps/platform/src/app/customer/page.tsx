import Link from 'next/link';
import { realGetCustomerPortalRequests } from '@/lib/real-api-client.server';

const statusLabel: Record<string, string> = {
  received: 'Received', under_review: 'Under review', upload_invited: 'Files requested',
  files_received: 'Files received', quoted: 'Quotation ready', accepted: 'Approved',
  rejected: 'Closed', closed: 'Closed',
};

export default async function CustomerPortalPage() {
  try {
    const { requests } = await realGetCustomerPortalRequests();
    return <>
      <div className="mb-8"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-phx-cyan">Client workspace</p>
        <h1 className="mt-2 text-3xl font-extrabold text-phx-navy">Your requests</h1>
        <p className="mt-2 text-sm text-gray-500">Track progress, review quotations, and keep every project conversation in one place.</p></div>
      {requests.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">No requests are linked to this account yet.</div> :
        <div className="grid gap-4">{requests.map((request) => <Link key={request.requestId} href={`/customer/requests/${request.requestId}`} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-phx-cyan">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold text-phx-cyan">{request.publicReference}</p><h2 className="mt-1 text-lg font-bold text-phx-navy">{request.company}</h2><p className="mt-1 text-sm text-gray-500">Submitted {new Date(request.createdAt).toLocaleDateString('en-GB')}</p></div>
            <span className="rounded-full bg-phx-navy/5 px-3 py-1 text-xs font-semibold text-phx-navy">{statusLabel[request.status] ?? request.status}</span></div>
        </Link>)}</div>}
    </>;
  } catch {
    return <div className="rounded-2xl border border-red-200 bg-white p-8"><h1 className="text-xl font-bold text-phx-navy">Your requests are temporarily unavailable</h1><p className="mt-2 text-sm text-gray-500">Please refresh in a moment. No request data was changed.</p></div>;
  }
}

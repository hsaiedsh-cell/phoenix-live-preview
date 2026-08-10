'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  realGetIntakeRequestDetail,
  realGetIntakeFileDownload,
  realSendIntakeQuote,
  realIssueIntakeUploadInvitation,
  realIssueOnboardingInvitation,
  realProvisionIntakeWorkspace,
  realQueryIntakeRequests,
  realReissueOnboardingInvitation,
  realRevokeOnboardingInvitation,
  realRunIntakeAction,
} from '@/lib/real-api-client.client';
import type {
  IntakeOperatorAction,
  IntakeProvisioningResult,
  IntakeQueueItem,
  IntakeRequestDetail,
  IntakeRequestStatus,
  IntakeRequestType,
  OnboardingInvitationIssueResult,
} from '@/lib/real-api-client';

const STATUSES: IntakeRequestStatus[] = [
  'received', 'under_review', 'upload_invited', 'files_received',
  'quoted', 'accepted', 'rejected', 'closed',
];
const TYPES: IntakeRequestType[] = ['assessment', 'demo', 'general'];
const ACTIONS: Array<{ value: IntakeOperatorAction; label: string }> = [
  { value: 'under_review', label: 'Start review' },
  { value: 'quote', label: 'Mark quoted' },
  { value: 'accept', label: 'Accept' },
  { value: 'reject', label: 'Reject' },
  { value: 'close', label: 'Close' },
];

const ALLOWED_ACTIONS: Record<IntakeRequestStatus, IntakeOperatorAction[]> = {
  received: ['under_review', 'reject', 'close'],
  under_review: ['reject', 'close'],
  upload_invited: ['reject', 'close'],
  files_received: ['reject', 'close'],
  quoted: ['accept', 'reject', 'close'],
  accepted: ['close'],
  rejected: ['close'],
  closed: [],
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}

export function IntakeOperationsClient() {
  const [items, setItems] = useState<IntakeQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<IntakeRequestStatus | ''>('');
  const [requestType, setRequestType] = useState<IntakeRequestType | ''>('');
  const [selected, setSelected] = useState<IntakeRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [uploadInvitationLoading, setUploadInvitationLoading] = useState(false);
  const [uploadInvitationStatus, setUploadInvitationStatus] = useState<string | null>(null);
  const [provisioningLoading, setProvisioningLoading] = useState(false);
  const [provisioningResult, setProvisioningResult] = useState<IntakeProvisioningResult | null>(null);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitation, setInvitation] = useState<(OnboardingInvitationIssueResult & { status: 'Issued' | 'Revoked' }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<string | null>(null);
  const [downloadLinks, setDownloadLinks] = useState<Record<string, { url: string; expiresAt: string }>>({});
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState<string | null>(null);
  const [quotePrice, setQuotePrice] = useState(95);
  const [quoteCurrency, setQuoteCurrency] = useState<'USD' | 'AED'>('USD');
  const [quoteDeliveryHours, setQuoteDeliveryHours] = useState(48);
  const [quoteRevisions, setQuoteRevisions] = useState(3);
  const [quoteAdditionalRevisionPrice, setQuoteAdditionalRevisionPrice] = useState(20);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await realQueryIntakeRequests({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(status ? { statuses: [status] } : {}),
        ...(requestType ? { requestTypes: [requestType] } : {}),
        limit: 50,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (caught) {
      setItems([]);
      setTotal(0);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [requestType, search, status]);

  useEffect(() => { void loadQueue(); }, [loadQueue]);

  async function openDetail(requestId: string): Promise<void> {
    setDetailLoading(true);
    setError(null);
    try {
      const result = await realGetIntakeRequestDetail(requestId);
      setSelected(result.request);
      setProvisioningResult(null);
      setInvitation(null);
      setUploadInvitationStatus(null);
      setDownloadLinks({});
      setQuoteStatus(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDetailLoading(false);
    }
  }

  async function sendQuote(): Promise<void> {
    if (!selected || !['files_received', 'accepted'].includes(selected.status)) return;
    if (!window.confirm(`Send the ${quoteCurrency} ${quotePrice.toFixed(2)} quotation to ${selected.workEmail}?`)) return;
    setQuoteLoading(true);
    setError(null);
    try {
      await realSendIntakeQuote(selected.requestId, {
        priceAmount: quotePrice,
        currency: quoteCurrency,
        deliveryHours: quoteDeliveryHours,
        fileFormats: ['AI', 'SVG', 'JPEG', 'PNG'],
        revisionRounds: quoteRevisions,
        additionalRevisionPrice: quoteAdditionalRevisionPrice,
      });
      setQuoteStatus('Quotation sent successfully.');
      const refreshed = await realGetIntakeRequestDetail(selected.requestId);
      setSelected(refreshed.request);
      await loadQueue();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setQuoteLoading(false);
    }
  }

  async function prepareFileDownload(fileId: string): Promise<void> {
    if (!selected) return;
    setDownloadLoadingId(fileId);
    setError(null);
    try {
      const result = await realGetIntakeFileDownload(selected.requestId, fileId);
      setDownloadLinks((current) => ({
        ...current,
        [fileId]: { url: result.downloadUrl, expiresAt: result.expiresAt },
      }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDownloadLoadingId(null);
    }
  }

  async function issueInvitation(): Promise<void> {
    if (!provisioningResult || !window.confirm('Issue a 72-hour onboarding invitation for this Owner membership?')) return;
    setInvitationLoading(true);
    setError(null);
    try {
      const result = await realIssueOnboardingInvitation(provisioningResult.membershipId, 72);
      setInvitation({ ...result, status: 'Issued' });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setInvitationLoading(false);
    }
  }

  async function revokeInvitation(): Promise<void> {
    if (!invitation || invitation.status !== 'Issued' || !window.confirm('Revoke this onboarding invitation?')) return;
    setInvitationLoading(true);
    setError(null);
    try {
      await realRevokeOnboardingInvitation(invitation.invitationId);
      setInvitation({ ...invitation, status: 'Revoked' });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setInvitationLoading(false);
    }
  }

  async function reissueInvitation(): Promise<void> {
    if (!invitation || !window.confirm('Reissue this onboarding invitation with a new 72-hour token?')) return;
    setInvitationLoading(true);
    setError(null);
    try {
      const result = await realReissueOnboardingInvitation(invitation.invitationId, 72);
      setInvitation({ ...result, status: 'Issued' });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setInvitationLoading(false);
    }
  }

  async function provisionWorkspace(): Promise<void> {
    if (!selected || selected.status !== 'accepted') return;
    if (!window.confirm(`Provision a workspace for ${selected.publicReference}?`)) return;
    setProvisioningLoading(true);
    setProvisioningResult(null);
    setError(null);
    try {
      const result = await realProvisionIntakeWorkspace({
        sourceReference: selected.publicReference,
        sourceStatus: 'accepted',
        requestType: selected.requestType,
        company: selected.company,
        firstName: selected.firstName,
        lastName: selected.lastName,
        workEmail: selected.workEmail,
      });
      setProvisioningResult(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setProvisioningLoading(false);
    }
  }

  async function runAction(action: IntakeOperatorAction): Promise<void> {
    if (!selected || !window.confirm(`Confirm “${action}” for ${selected.publicReference}?`)) return;
    setActionLoading(true);
    setError(null);
    try {
      await realRunIntakeAction(selected.requestId, action);
      const refreshed = await realGetIntakeRequestDetail(selected.requestId);
      setSelected(refreshed.request);
      await loadQueue();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionLoading(false);
    }
  }

  async function issueUploadInvitation(): Promise<void> {
    if (!selected || selected.status !== 'under_review') return;
    if (!window.confirm(`Send a 24-hour upload invitation to ${selected.workEmail}?`)) return;
    setUploadInvitationLoading(true);
    setUploadInvitationStatus(null);
    setError(null);
    try {
      const result = await realIssueIntakeUploadInvitation(selected.requestId);
      const refreshed = await realGetIntakeRequestDetail(selected.requestId);
      setSelected(refreshed.request);
      setUploadInvitationStatus(
        result.emailSent
          ? `Upload invitation sent. It expires ${new Date(result.expiresAt).toLocaleString()}.`
          : 'The upload session was created, but the invitation email could not be sent.'
      );
      await loadQueue();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploadInvitationLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <form
        className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-[1fr_180px_180px_auto]"
        onSubmit={(event) => { event.preventDefault(); void loadQueue(); }}
      >
        <label className="text-xs font-semibold text-gray-600">
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="Reference, company, name, or email" />
        </label>
        <label className="text-xs font-semibold text-gray-600">Status
          <select value={status} onChange={(event) => setStatus(event.target.value as IntakeRequestStatus | '')}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="">All statuses</option>{STATUSES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-gray-600">Type
          <select value={requestType} onChange={(event) => setRequestType(event.target.value as IntakeRequestType | '')}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="">All types</option>{TYPES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <button disabled={loading} className="self-end rounded-lg bg-phx-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </form>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-bold text-phx-navy">Request queue</h2><span className="text-xs text-gray-400">{total} total</span>
          </div>
          {items.length === 0 && !loading ? <p className="p-6 text-sm text-gray-500">No requests matched these filters.</p> : (
            <div className="divide-y divide-gray-100">{items.map((item) => (
              <button key={item.requestId} onClick={() => void openDetail(item.requestId)}
                className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-4 text-left hover:bg-gray-50">
                <span><span className="block text-sm font-bold text-phx-navy">{item.company}</span>
                  <span className="mt-1 block text-xs text-gray-500">{item.publicReference} · {item.requestType} · {item.fileCount} files</span></span>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">{item.status}</span>
              </button>
            ))}</div>
          )}
        </section>

        <aside className="rounded-xl border border-gray-200 bg-white p-5">
          {detailLoading ? <p className="text-sm text-gray-500">Loading request…</p> : !selected ? (
            <p className="text-sm text-gray-500">Select a request to inspect its authoritative detail.</p>
          ) : <div className="space-y-5">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-phx-cyan">{selected.publicReference}</p>
              <h2 className="mt-1 text-xl font-extrabold text-phx-navy">{selected.company}</h2>
              <p className="mt-1 text-sm text-gray-500">{selected.firstName} {selected.lastName} · {selected.workEmail}</p></div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-gray-400">Status</dt><dd className="font-semibold">{selected.status}</dd></div>
              <div><dt className="text-xs text-gray-400">Type</dt><dd className="font-semibold">{selected.requestType}</dd></div>
              <div><dt className="text-xs text-gray-400">Role</dt><dd>{selected.role}</dd></div>
              <div><dt className="text-xs text-gray-400">Country</dt><dd>{selected.country ?? '—'}</dd></div>
            </dl>
            <div><h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Message</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">{selected.message}</p></div>
            {selected.files.length > 0 && <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Customer files</h3>
              <div className="mt-2 space-y-2">{selected.files.map((file) => {
                const prepared = downloadLinks[file.fileId];
                return <div key={file.fileId} className="rounded-lg border border-gray-200 p-3 text-xs">
                  <p className="break-all font-semibold text-phx-navy">{file.originalFilename}</p>
                  <p className="mt-1 text-gray-500">{file.contentType} · {formatBytes(file.sizeBytes)}</p>
                  <p className="mt-1 text-gray-500">Security status: <strong>{file.scanStatus}</strong></p>
                  {file.scanStatus === 'pending_review' && <p className="mt-1 text-amber-700">Unscanned file — open only in an isolated review environment.</p>}
                  <div className="mt-2">
                    {prepared ? <a href={prepared.url} target="_blank" rel="noopener noreferrer"
                      className="font-semibold text-phx-cyan underline">Download now (60-second link)</a> :
                      <button disabled={downloadLoadingId === file.fileId || file.scanStatus === 'quarantined'}
                        onClick={() => void prepareFileDownload(file.fileId)}
                        className="rounded-md border border-gray-200 px-2.5 py-1.5 font-semibold text-phx-navy disabled:opacity-50">
                        {downloadLoadingId === file.fileId ? 'Preparing…' : file.scanStatus === 'quarantined' ? 'Quarantined' : 'Prepare secure download'}
                      </button>}
                  </div>
                </div>;
              })}</div>
            </div>}
            {['files_received', 'accepted'].includes(selected.status) && <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-phx-navy">Quotation</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <label>Price<input type="number" min="1" value={quotePrice} onChange={(e) => setQuotePrice(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5" /></label>
                <label>Currency<select value={quoteCurrency} onChange={(e) => setQuoteCurrency(e.target.value as 'USD' | 'AED')} className="mt-1 w-full rounded border px-2 py-1.5"><option>USD</option><option>AED</option></select></label>
                <label>Delivery hours<input type="number" min="1" value={quoteDeliveryHours} onChange={(e) => setQuoteDeliveryHours(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5" /></label>
                <label>Revision rounds<input type="number" min="0" value={quoteRevisions} onChange={(e) => setQuoteRevisions(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5" /></label>
                <label className="col-span-2">Additional revision price<input type="number" min="0" value={quoteAdditionalRevisionPrice} onChange={(e) => setQuoteAdditionalRevisionPrice(Number(e.target.value))} className="mt-1 w-full rounded border px-2 py-1.5" /></label>
              </div>
              <p className="mt-2 text-xs text-gray-600">Formats: AI, SVG, JPEG, PNG · Payment after final preview approval and before final file release.</p>
              <button disabled={quoteLoading} onClick={() => void sendQuote()} className="mt-3 rounded-lg bg-phx-cyan px-3 py-2 text-xs font-semibold text-phx-navy disabled:opacity-50">{quoteLoading ? 'Sending quotation…' : selected.status === 'accepted' ? 'Resend quotation' : 'Send quotation & mark quoted'}</button>
            </div>}
            {quoteStatus && <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{quoteStatus}</div>}
            <div className="flex flex-wrap gap-2">{ACTIONS.filter((action) => ALLOWED_ACTIONS[selected.status].includes(action.value)).map((action) => (
              <button key={action.value} disabled={actionLoading} onClick={() => void runAction(action.value)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-phx-navy hover:bg-gray-50 disabled:opacity-50">{action.label}</button>
            ))}
              {selected.status === 'under_review' && (
                <button disabled={uploadInvitationLoading || actionLoading} onClick={() => void issueUploadInvitation()}
                  className="rounded-lg bg-phx-cyan px-3 py-2 text-xs font-semibold text-phx-navy hover:opacity-90 disabled:opacity-50">
                  {uploadInvitationLoading ? 'Sending invitation…' : 'Send upload invitation'}
                </button>
              )}
              {selected.status === 'accepted' && (
                <button disabled={provisioningLoading || actionLoading} onClick={() => void provisionWorkspace()}
                  className="rounded-lg bg-phx-cyan px-3 py-2 text-xs font-semibold text-phx-navy hover:opacity-90 disabled:opacity-50">
                  {provisioningLoading ? 'Provisioning…' : 'Provision workspace'}
                </button>
              )}
            </div>
            {uploadInvitationStatus && (
              <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                {uploadInvitationStatus}
              </div>
            )}
            {provisioningResult && (
              <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                <div role="status">Workspace {provisioningResult.outcome === 'created' ? 'created' : 'already provisioned'} successfully.
                  <span className="mt-1 block font-mono text-xs">Workspace: {provisioningResult.workspaceId}</span>
                </div>
                {!invitation ? (
                  <button disabled={invitationLoading} onClick={() => void issueInvitation()}
                    className="rounded-lg bg-phx-navy px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    {invitationLoading ? 'Issuing…' : 'Issue onboarding invitation'}
                  </button>
                ) : (
                  <div className="space-y-2 border-t border-green-200 pt-3">
                    <p>Invitation: <strong>{invitation.status}</strong> · Delivery: <strong>{invitation.deliveryStatus}</strong></p>
                    <p className="text-xs">Expires: {new Date(invitation.expiresAt).toLocaleString()}</p>
                    <div className="flex flex-wrap gap-2">
                      {invitation.status === 'Issued' && <button disabled={invitationLoading} onClick={() => void revokeInvitation()}
                        className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Revoke invitation</button>}
                      <button disabled={invitationLoading} onClick={() => void reissueInvitation()}
                        className="rounded-lg border border-green-300 px-3 py-2 text-xs font-semibold text-green-800 disabled:opacity-50">
                        {invitationLoading ? 'Working…' : 'Reissue invitation'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div><h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Action history</h3>
              <div className="mt-2 space-y-2">{selected.operatorActions.length === 0 ? <p className="text-sm text-gray-500">No operator actions yet.</p> : selected.operatorActions.map((entry) => (
                <div key={entry.eventId} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{entry.from} → {entry.to}<span className="block text-gray-400">{new Date(entry.createdAt).toLocaleString()}</span></div>
              ))}</div></div>
          </div>}
        </aside>
      </div>
    </div>
  );
}

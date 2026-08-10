'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerPortalRequestDetail } from '@/lib/real-api-client';
import { realSendCustomerPortalMessage, realSubmitCustomerPortalDecision,realDecidePreviewProof } from '@/lib/real-api-client.client';

export function CustomerQuoteWorkspace({ initialDetail }: { initialDetail: CustomerPortalRequestDetail }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = initialDetail.offers[0];
  const terminal = latest ? initialDetail.decisions.find((d) => d.quoteOfferId === latest.quoteOfferId && (d.decision === 'approved' || d.decision === 'declined')) : undefined;
  const fulfillment = initialDetail.fulfillment;
  const stages = ['accepted', 'in_progress', 'preview_ready', 'payment_pending', 'paid', 'final_files_delivered'] as const;
  const currentStage = fulfillment ? stages.indexOf(fulfillment.status as typeof stages[number]) : -1;
  const preview=initialDetail.previews[0];const previewDecision=preview?initialDetail.previewDecisions.find(d=>d.previewProofId===preview.previewProofId):undefined;

  async function decide(decision: 'approved' | 'declined' | 'changes_requested') {
    if (!latest || busy) return;
    if (decision !== 'approved' && !note.trim()) { setError('Please add a short explanation first.'); return; }
    if (decision === 'approved' && !window.confirm(`Approve quotation ${latest.currency} ${latest.priceAmount.toFixed(2)}?`)) return;
    setBusy(true); setError(null);
    try {
      await realSubmitCustomerPortalDecision(initialDetail.request.requestId, latest.quoteOfferId,
        decision === 'approved' ? { decision, termsAcceptedVersion: `quote-v${latest.version}` } : { decision, reason: note.trim() });
      setNote(''); router.refresh();
    } catch { setError('Your decision could not be saved. Please refresh and try again.'); }
    finally { setBusy(false); }
  }

  async function sendMessage() {
    if (!latest || !note.trim() || busy) return;
    setBusy(true); setError(null);
    try { await realSendCustomerPortalMessage(initialDetail.request.requestId, latest.quoteOfferId, note.trim()); setNote(''); router.refresh(); }
    catch { setError('Your message could not be sent. Please try again.'); }
    finally { setBusy(false); }
  }
  async function decidePreview(decision:'approved'|'revision_requested'){if(!preview||busy)return;if(decision==='revision_requested'&&!note.trim()){setError('Please explain the requested revision first.');return;}setBusy(true);setError(null);try{await realDecidePreviewProof(initialDetail.request.requestId,preview.previewProofId,decision==='approved'?{decision}:{decision,reason:note.trim()});setNote('');router.refresh();}catch{setError('Your preview decision could not be saved.');}finally{setBusy(false);}}

  return <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
    <section className="space-y-6"><div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><p className="text-xs font-semibold text-phx-cyan">{initialDetail.request.publicReference}</p><h1 className="mt-2 text-2xl font-extrabold text-phx-navy">{initialDetail.request.company}</h1><p className="mt-2 text-sm text-gray-500">Request status: <strong className="text-phx-navy">{initialDetail.request.status.replaceAll('_', ' ')}</strong></p></div>
      {fulfillment && <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-phx-cyan">Project delivery</p><h2 className="mt-1 text-xl font-extrabold capitalize text-phx-navy">{fulfillment.status.replaceAll('_', ' ')}</h2></div><div className="text-right text-xs text-gray-500"><p>Estimated delivery</p><p className="mt-1 font-semibold text-phx-navy">{new Date(fulfillment.dueAt).toLocaleString('en-GB')}</p></div></div>
        <ol className="mt-6 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{stages.map((stage, index) => <li key={stage} className={`rounded-lg border px-3 py-3 text-xs font-semibold capitalize ${index <= currentStage ? 'border-cyan-300 bg-cyan-50 text-phx-navy' : 'border-gray-200 text-gray-400'}`}><span className="mr-1">{index < currentStage ? '✓' : index + 1}.</span>{stage.replaceAll('_', ' ')}</li>)}</ol>
      </div>}
      {preview&&<div className="rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Preview proof v{preview.version}</p><h2 className="mt-2 text-xl font-extrabold text-phx-navy">Review your project preview</h2><p className="mt-2 text-sm text-gray-500">This protected proof is for review only. Final editable files are released after payment.</p><a href={preview.downloadUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block rounded-lg bg-phx-navy px-4 py-2.5 text-sm font-semibold text-white">Open preview</a>{previewDecision?<p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm font-semibold capitalize">Decision recorded: {previewDecision.decision.replaceAll('_',' ')}</p>:<><textarea value={note} onChange={e=>setNote(e.target.value)} rows={3} maxLength={4000} placeholder="Optional feedback, required when requesting a revision…" className="mt-4 w-full rounded-lg border border-gray-300 p-3 text-sm"/><div className="mt-3 flex gap-3"><button disabled={busy} onClick={()=>void decidePreview('approved')} className="rounded-lg bg-phx-cyan px-4 py-2.5 text-sm font-semibold text-white">Approve preview</button><button disabled={busy} onClick={()=>void decidePreview('revision_requested')} className="rounded-lg border border-phx-navy px-4 py-2.5 text-sm font-semibold text-phx-navy">Request revision</button></div></>}</div>}
      {latest ? <div className="rounded-2xl border border-cyan-200 bg-white p-6 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-phx-cyan">Quotation v{latest.version}</p><p className="mt-2 text-3xl font-extrabold text-phx-navy">{latest.currency} {latest.priceAmount.toFixed(2)}</p></div><span className="text-xs text-gray-400">{new Date(latest.sentAt).toLocaleString('en-GB')}</span></div>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2 text-sm"><div><dt className="text-gray-400">Delivery</dt><dd className="font-semibold">{latest.deliveryHours} hours after approval</dd></div><div><dt className="text-gray-400">Revisions</dt><dd className="font-semibold">{latest.revisionRounds} rounds included</dd></div><div><dt className="text-gray-400">Deliverables</dt><dd className="font-semibold">{latest.fileFormats.join(', ')}</dd></div><div><dt className="text-gray-400">Extra revision</dt><dd className="font-semibold">{latest.currency} {latest.additionalRevisionPrice.toFixed(2)}</dd></div></dl>
        <div className="mt-6 rounded-xl bg-gray-50 p-4 text-xs leading-5 text-gray-600 whitespace-pre-wrap">{latest.termsSnapshot}</div>
        {terminal ? <div className="mt-5 rounded-lg bg-phx-navy/5 px-4 py-3 text-sm font-semibold text-phx-navy">Decision recorded: {terminal.decision}</div> : <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} onClick={() => void decide('approved')} className="rounded-lg bg-phx-cyan px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Approve quotation</button><button disabled={busy} onClick={() => void decide('changes_requested')} className="rounded-lg border border-phx-navy px-4 py-2.5 text-sm font-semibold text-phx-navy disabled:opacity-50">Request changes</button><button disabled={busy} onClick={() => void decide('declined')} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-600 disabled:opacity-50">Decline</button></div>}
      </div> : <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-sm text-gray-500">Your quotation is being prepared. We will notify you when it is ready.</div>}
    </section>
    <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-phx-navy">Project conversation</h2><div className="mt-4 max-h-96 space-y-3 overflow-y-auto">{initialDetail.messages.length === 0 ? <p className="text-sm text-gray-400">No messages yet.</p> : initialDetail.messages.map((item) => <div key={item.messageId} className={`rounded-xl p-3 text-sm ${item.authorType === 'customer' ? 'bg-cyan-50' : 'bg-gray-100'}`}><p className="text-[10px] font-semibold uppercase text-gray-400">{item.authorType === 'customer' ? 'You' : 'Phoenix'}</p><p className="mt-1 whitespace-pre-wrap text-gray-700">{item.message}</p><p className="mt-2 text-[10px] text-gray-400">{new Date(item.createdAt).toLocaleString('en-GB')}</p></div>)}</div>
      {latest && !terminal && <div className="mt-5"><label htmlFor="customer-note" className="text-xs font-semibold text-gray-600">Message or negotiation note</label><textarea id="customer-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} rows={5} className="mt-2 w-full rounded-lg border border-gray-300 p-3 text-sm" placeholder="Ask a question, explain requested changes, or share your preferred budget…"/><button disabled={busy || !note.trim()} onClick={() => void sendMessage()} className="mt-2 w-full rounded-lg bg-phx-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Send message</button></div>}
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    </aside>
  </div>;
}

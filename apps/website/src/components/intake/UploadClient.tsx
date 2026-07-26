'use client';

// ============================================================
// UploadClient — invitation-only private upload UI
// PHX-LAUNCH-001 (R6: PHX-LAUNCH-001-R6 §1, §2, §3, §4)
// ------------------------------------------------------------
// R6 correction summary:
//  - §1/§4: an entry left in `recoverable_error` with NO
//    storageObjectKey (the sign response was lost or the request
//    failed before the browser ever received one) now exposes a real
//    "Retry upload request" action that calls signAndUpload() again
//    with the exact SAME clientEntryId/reservationKey/filename/
//    declaredContentType/declaredSizeBytes -- never a new
//    reservationKey. The R5 server-side idempotent-sign contract was
//    real but had no usable path from the customer interface until now.
//  - §2: cancelEntry() no longer silently removes an entry whose
//    storageObjectKey is unknown -- doing so previously hid an
//    already-committed server reservation (still consuming quota)
//    behind what looked like a successful local cancel. Local removal
//    is now permitted ONLY for a never-submitted `pending` entry, or
//    once the server has returned an explicit terminal/no-reservation
//    result (phase 'terminal') for that entry.
//  - §3: refreshUploadState now parses and applies the COMPLETE
//    token-state response (not just four of its seven fields) and
//    reconciles pendingReservations into the entry list via the pure,
//    directly-testable reconcilePendingReservations helper -- keyed
//    exclusively by storageObjectKey, never duplicating a recovered
//    reservation across repeated refreshes, and merging a local entry
//    with its recovered counterpart the moment they share an object key.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import {
  type FileEntry,
  type PendingReservationSummary,
  updateEntryById,
  removeEntryById,
  findEntryById,
  canFinish as computeCanFinish,
  anyEntryBusy,
  reconcilePendingReservations,
} from './upload-client-state';

interface UploadClientProps {
  token: string;
}

type TokenState =
  | { status: 'checking' }
  | { status: 'invalid' }
  | { status: 'valid'; maxFiles: number; maxFileSizeBytes: number; maxTotalSizeBytes: number; expiresAt: string };

type FinishState = 'idle' | 'finishing' | 'error';

interface TokenStateResponse {
  maxFiles: number;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  completedCount: number;
  completedBytes: number;
  reservedCount: number;
  reservedBytes: number;
  remainingFileSlots: number;
  remainingBytes: number;
  expiresAt: string;
  pendingReservations: PendingReservationSummary[];
}

function generateClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function UploadClient({ token }: UploadClientProps) {
  const [tokenState, setTokenState] = useState<TokenState>({ status: 'checking' });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [reservedCount, setReservedCount] = useState(0);
  const [remainingFileSlots, setRemainingFileSlots] = useState<number | null>(null);
  const [remainingBytes, setRemainingBytes] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const [finalized, setFinalized] = useState(false);
  const [finishState, setFinishState] = useState<FinishState>('idle');
  const [finishError, setFinishError] = useState('');
  const inFlightRef = useRef<Set<string>>(new Set());
  // R5 (§5)/R6: monotonically increasing sequence guard -- a refresh
  // response is applied only if it is still the most recently ISSUED
  // refresh by the time it resolves.
  const refreshSeqRef = useRef(0);
  const entriesRef = useRef<FileEntry[]>([]);
  entriesRef.current = entries;

  /** R5 (§5) + R6 (§3): the single reusable function that refreshes the COMPLETE authoritative token-state response and reconciles pendingReservations into the entry list. Never guesses on failure. */
  async function refreshUploadState(): Promise<void> {
    const seq = ++refreshSeqRef.current;
    try {
      const response = await fetch(`/api/upload/${encodeURIComponent(token)}`);
      if (seq !== refreshSeqRef.current) return;
      if (!response.ok) {
        setRefreshError('Your file state could not be refreshed. Please reload the page.');
        return;
      }
      const body = (await response.json()) as TokenStateResponse;
      if (seq !== refreshSeqRef.current) return;
      setRefreshError('');
      setCompletedCount(body.completedCount);
      setReservedCount(body.reservedCount);
      setRemainingFileSlots(body.remainingFileSlots);
      setRemainingBytes(body.remainingBytes);
      // R6 (§3): reconcile the authoritative pendingReservations list
      // into the entry array -- keyed by storageObjectKey, never
      // duplicating, never clobbering an in-flight local action.
      setEntries((prev) => reconcilePendingReservations(prev, body.pendingReservations));
      setTokenState((prev) =>
        prev.status === 'valid'
          ? { ...prev, maxFiles: body.maxFiles, maxFileSizeBytes: body.maxFileSizeBytes, maxTotalSizeBytes: body.maxTotalSizeBytes, expiresAt: body.expiresAt }
          : prev
      );
    } catch {
      if (seq !== refreshSeqRef.current) return;
      setRefreshError('Your file state could not be refreshed. Please check your connection.');
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/upload/${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setTokenState({ status: 'invalid' });
          return;
        }
        const body = (await response.json()) as TokenStateResponse;
        setTokenState({
          status: 'valid',
          maxFiles: body.maxFiles,
          maxFileSizeBytes: body.maxFileSizeBytes,
          maxTotalSizeBytes: body.maxTotalSizeBytes,
          expiresAt: body.expiresAt,
        });
        setCompletedCount(body.completedCount);
        setReservedCount(body.reservedCount);
        setRemainingFileSlots(body.remainingFileSlots);
        setRemainingBytes(body.remainingBytes);
        setEntries((prev) => reconcilePendingReservations(prev, body.pendingReservations));
      })
      .catch(() => {
        if (!cancelled) setTokenState({ status: 'invalid' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function onFilesSelected(fileList: FileList | null) {
    if (!fileList || finalized) return;
    const additions: FileEntry[] = Array.from(fileList).map((file) => ({
      clientEntryId: generateClientId(),
      // R5 (§6): generated ONCE here, reused verbatim for every sign
      // retry of this exact entry -- never regenerated.
      reservationKey: generateClientId(),
      file,
      filename: file.name,
      declaredContentType: file.type || 'application/octet-stream',
      declaredSizeBytes: file.size,
      phase: 'pending',
    }));
    setEntries((prev) => [...prev, ...additions]);
  }

  /** Sign (or re-sign, using the SAME reservationKey) -> PUT -> complete. */
  async function signAndUpload(clientEntryId: string) {
    if (inFlightRef.current.has(clientEntryId) || finalized) return;
    inFlightRef.current.add(clientEntryId);
    const entry = findEntryById(entriesRef.current, clientEntryId);
    if (!entry || !entry.reservationKey) {
      inFlightRef.current.delete(clientEntryId);
      return;
    }

    setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'signing', message: undefined }));
    try {
      const signResponse = await fetch(`/api/upload/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: entry.filename,
          contentType: entry.declaredContentType,
          sizeBytes: entry.declaredSizeBytes,
          reservationKey: entry.reservationKey,
        }),
      });
      if (signResponse.status === 409) {
        // R6 (§1/§4): an explicit terminal/conflict result -- do not
        // keep presenting a retry that can never succeed.
        setEntries((prev) =>
          updateEntryById(prev, clientEntryId, {
            phase: 'terminal',
            message: 'This file entry can no longer be used. Please remove it and re-select the file.',
          })
        );
        inFlightRef.current.delete(clientEntryId);
        await refreshUploadState();
        return;
      }
      if (!signResponse.ok) {
        const body = (await signResponse.json().catch(() => null)) as { error?: string } | null;
        setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: body?.error || 'File not accepted. You can retry.' }));
        inFlightRef.current.delete(clientEntryId);
        await refreshUploadState();
        return;
      }
      const { uploadUrl, storageObjectKey } = (await signResponse.json()) as { uploadUrl: string; storageObjectKey: string };
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'signed', storageObjectKey, signedUploadUrl: uploadUrl, message: undefined }));
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
      await uploadEntry(clientEntryId, { storageObjectKey, signedUploadUrl: uploadUrl });
    } catch {
      // R6 (§1): the response may have been lost even though the
      // server-side reservation committed -- this entry stays
      // recoverable, WITHOUT a storageObjectKey, and "Retry upload
      // request" (this same function) is the way back in, reusing
      // the identical reservationKey so the server-side idempotent
      // reservation (R5 §6) is what actually resolves the ambiguity.
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Network error while requesting an upload slot. Retry uses the same reservation -- it will not create a duplicate or consume extra quota.' }));
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
    }
  }

  async function uploadEntry(clientEntryId: string, signed?: { storageObjectKey: string; signedUploadUrl: string }) {
    if (inFlightRef.current.has(clientEntryId) || finalized) return;
    inFlightRef.current.add(clientEntryId);
    const entry = findEntryById(entriesRef.current, clientEntryId);
    const storageObjectKey = signed?.storageObjectKey ?? entry?.storageObjectKey;
    const signedUploadUrl = signed?.signedUploadUrl ?? entry?.signedUploadUrl;
    if (!entry || !storageObjectKey || !signedUploadUrl || !entry.file) {
      inFlightRef.current.delete(clientEntryId);
      return;
    }

    setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'uploading' }));
    try {
      const putResponse = await fetch(signedUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': entry.declaredContentType },
        body: entry.file,
      });
      if (!putResponse.ok) {
        // R6 (§4): the signed URL itself may have expired -- offer
        // both "retry the same PUT" (handled by rendering, since
        // signedUploadUrl/storageObjectKey are both still known) and
        // "request a fresh URL" (re-runs signAndUpload with the SAME
        // reservationKey, which the server resolves to the identical
        // reservation and simply reissues a new signed URL for it).
        setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Upload failed. You can retry, or request a fresh upload link if this one may have expired -- neither loses your place.' }));
        inFlightRef.current.delete(clientEntryId);
        await refreshUploadState();
        return;
      }
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'uploaded_unverified' }));
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
      await verifyEntry(clientEntryId, storageObjectKey);
    } catch {
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Network error during upload. You can retry without losing your place.' }));
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
    }
  }

  async function verifyEntry(clientEntryId: string, storageObjectKeyOverride?: string) {
    if (inFlightRef.current.has(clientEntryId) || finalized) return;
    inFlightRef.current.add(clientEntryId);
    const entry = findEntryById(entriesRef.current, clientEntryId);
    const storageObjectKey = storageObjectKeyOverride ?? entry?.storageObjectKey;
    if (!storageObjectKey) {
      inFlightRef.current.delete(clientEntryId);
      return;
    }

    setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'verifying' }));
    try {
      const completeResponse = await fetch(`/api/upload/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageObjectKey, finishSession: false }),
      });
      if (!completeResponse.ok) {
        setEntries((prev) =>
          updateEntryById(prev, clientEntryId, {
            phase: 'recoverable_error',
            message: 'Could not verify this file yet. If you already uploaded it, try Verify again; otherwise Cancel and re-select it.',
          })
        );
        inFlightRef.current.delete(clientEntryId);
        await refreshUploadState();
        return;
      }
      const completeBody = (await completeResponse.json()) as { fileCount: number; finalized: boolean };
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'completed', message: undefined }));
      if (completeBody.finalized) setFinalized(true);
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
    } catch {
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Network error while verifying. Please retry.' }));
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
    }
  }

  /**
   * R6 (§2): NEVER silently removes an entry whose server-side state
   * is ambiguous. An entry with a known storageObjectKey is cancelled
   * on the server as before. An entry with NO storageObjectKey but
   * that HAS been submitted for signing (reservationKey exists and it
   * is not still 'pending') cannot be safely removed locally -- its
   * sign attempt may have committed a reservation the browser never
   * learned the object key for. Only a genuinely never-submitted
   * 'pending' entry, or one already in the explicit 'terminal' phase,
   * is ever removed purely locally.
   */
  async function cancelEntry(clientEntryId: string) {
    if (inFlightRef.current.has(clientEntryId) || finalized) return;
    const entry = findEntryById(entriesRef.current, clientEntryId);
    if (!entry) return;

    if (!entry.storageObjectKey) {
      if (entry.phase === 'pending' || entry.phase === 'terminal') {
        setEntries((prev) => removeEntryById(prev, clientEntryId));
        return;
      }
      // R6 (§2): an ambiguous, already-submitted entry with no known
      // object key -- do not remove it. Refreshing state is the only
      // safe action here; if the server did commit a reservation,
      // reconciliation will surface it (with its object key) as a
      // recovered entry the customer can then Verify or Cancel
      // normally, or the customer can use "Retry upload request"
      // (signAndUpload) to resolve the ambiguity directly.
      await refreshUploadState();
      return;
    }

    inFlightRef.current.add(clientEntryId);
    setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'cancelling' }));
    try {
      const response = await fetch(`/api/upload/${encodeURIComponent(token)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageObjectKey: entry.storageObjectKey }),
      });
      if (response.ok) {
        setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'cancelled', message: undefined }));
      } else {
        setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Could not cancel this file. Please try again.' }));
      }
    } catch {
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Network error while cancelling. Please try again.' }));
    } finally {
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
    }
  }

  async function handleFinish() {
    if (finishState === 'finishing' || finalized) return;
    setFinishState('finishing');
    setFinishError('');
    try {
      const response = await fetch(`/api/upload/${encodeURIComponent(token)}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setFinishState('error');
        setFinishError(body?.error || 'Could not finish this upload session. Please try again.');
        await refreshUploadState();
        return;
      }
      const body = (await response.json()) as { fileCount: number };
      setCompletedCount(body.fileCount);
      setFinalized(true);
      setFinishState('idle');
    } catch {
      setFinishState('error');
      setFinishError('Network error. Please try again.');
    }
  }

  if (tokenState.status === 'checking') {
    return <main className="max-w-2xl mx-auto py-24 px-6 text-center text-gray-500">Checking your link…</main>;
  }

  if (tokenState.status === 'invalid') {
    return (
      <main className="max-w-2xl mx-auto py-24 px-6 text-center">
        <h1 className="text-2xl font-bold text-phx-navy mb-3">This link is not valid</h1>
        <p className="text-gray-600 text-sm">
          This upload link may have expired, already been used, or been revoked. Please contact Phoenix if you
          believe this is a mistake.
        </p>
      </main>
    );
  }

  const finishDisabled = !computeCanFinish({ completedCount, reservedCount, entries, finalized, finishing: finishState === 'finishing' });
  const remaining = remainingFileSlots ?? tokenState.maxFiles;

  return (
    <main className="max-w-2xl mx-auto py-24 px-6">
      <h1 className="text-2xl font-bold text-phx-navy mb-3">Upload your files</h1>
      <p className="text-sm text-gray-600 mb-2">
        You can upload up to {tokenState.maxFiles} files ({formatBytes(tokenState.maxFileSizeBytes)} per file,{' '}
        {formatBytes(tokenState.maxTotalSizeBytes)} total). This link expires{' '}
        {new Date(tokenState.expiresAt).toLocaleString()} and can only be used once.
      </p>
      <p className="text-sm text-gray-500 mb-2">
        {completedCount} of {tokenState.maxFiles} files received{!finalized ? ` — ${remaining} remaining` : ''}
        {remainingBytes !== null && !finalized ? ` (${formatBytes(remainingBytes)} remaining)` : ''}.
      </p>
      {refreshError && (
        <p className="text-xs text-amber-600 mb-4" role="status">
          {refreshError}
        </p>
      )}

      {!finalized && (
        <input
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.txt"
          onChange={(e) => onFilesSelected(e.target.files)}
          className="mb-6 block w-full text-sm"
        />
      )}

      <ul className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.clientEntryId} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 gap-3">
            <span className="text-sm text-gray-700 truncate">{entry.filename}</span>
            <span className="text-xs flex items-center gap-2 shrink-0">
              {entry.phase === 'pending' && !finalized && (
                <>
                  <button onClick={() => signAndUpload(entry.clientEntryId)} className="text-phx-cyan-dark underline" type="button">
                    Upload
                  </button>
                  <button onClick={() => cancelEntry(entry.clientEntryId)} className="text-gray-400 underline" type="button">
                    Remove
                  </button>
                </>
              )}
              {(entry.phase === 'signing' || entry.phase === 'uploading' || entry.phase === 'verifying') && (
                <span className="text-gray-500">Working…</span>
              )}
              {entry.phase === 'cancelling' && <span className="text-gray-500">Cancelling…</span>}
              {entry.phase === 'completed' && <span className="text-green-600">Received</span>}
              {entry.phase === 'rejected' && <span className="text-red-600">{entry.message}</span>}
              {entry.phase === 'cancelled' && <span className="text-gray-400">Cancelled</span>}
              {entry.phase === 'terminal' && !finalized && (
                <>
                  <span className="text-red-600">{entry.message}</span>
                  <button onClick={() => cancelEntry(entry.clientEntryId)} className="text-gray-600 underline" type="button">
                    Remove and re-select
                  </button>
                </>
              )}
              {entry.phase === 'recoverable_error' && !finalized && !entry.storageObjectKey && (
                <>
                  {/* R6 §1/§2/§4: a lost/failed sign response with no object key yet -- the ONLY safe recovery is retrying the SAME reservation, or refreshing to see if the server actually already has it. No silent local cancel. */}
                  <span className="text-amber-600">{entry.message || 'Not yet confirmed.'}</span>
                  <button onClick={() => signAndUpload(entry.clientEntryId)} className="text-phx-cyan-dark underline" type="button">
                    Retry upload request
                  </button>
                  <button onClick={() => refreshUploadState()} className="text-gray-600 underline" type="button">
                    Refresh state
                  </button>
                </>
              )}
              {entry.phase === 'recoverable_error' && !finalized && entry.storageObjectKey && (
                <>
                  <span className="text-amber-600">{entry.message || 'Not yet confirmed.'}</span>
                  {entry.file && entry.signedUploadUrl && (
                    <button onClick={() => uploadEntry(entry.clientEntryId)} className="text-phx-cyan-dark underline" type="button">
                      Retry upload
                    </button>
                  )}
                  {entry.file && entry.reservationKey && (
                    <button onClick={() => signAndUpload(entry.clientEntryId)} className="text-phx-cyan-dark underline" type="button">
                      Request fresh upload URL
                    </button>
                  )}
                  <button onClick={() => verifyEntry(entry.clientEntryId)} className="text-phx-cyan-dark underline" type="button">
                    Verify
                  </button>
                  <button onClick={() => cancelEntry(entry.clientEntryId)} className="text-red-600 underline" type="button">
                    Cancel
                  </button>
                </>
              )}
              {entry.phase === 'uploaded_unverified' && !finalized && (
                <>
                  <span className="text-amber-600">{entry.message || 'Not yet confirmed.'}</span>
                  {entry.storageObjectKey && (
                    <button onClick={() => verifyEntry(entry.clientEntryId)} className="text-phx-cyan-dark underline" type="button">
                      Verify
                    </button>
                  )}
                  <button onClick={() => cancelEntry(entry.clientEntryId)} className="text-red-600 underline" type="button">
                    Cancel
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {!finalized && (
        <div className="mt-8">
          <button
            type="button"
            onClick={handleFinish}
            disabled={finishDisabled}
            className="inline-flex items-center justify-center px-6 py-3 bg-phx-navy text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {finishState === 'finishing' ? 'Finishing…' : 'Finish uploading'}
          </button>
          {completedCount === 0 && (
            <p className="text-xs text-gray-400 mt-2">Upload at least one file before finishing.</p>
          )}
          {reservedCount > 0 && (
            <p className="text-xs text-gray-400 mt-2">Please verify or cancel your pending file(s) before finishing.</p>
          )}
          {anyEntryBusy(entries) && reservedCount === 0 && (
            <p className="text-xs text-gray-400 mt-2">Please wait for the current action to finish.</p>
          )}
          {finishState === 'error' && (
            <p className="text-sm text-red-600 mt-2" role="alert">
              {finishError}
            </p>
          )}
        </div>
      )}

      {finalized && (
        <p className="mt-8 text-sm text-green-700" role="status">
          Thanks — your files have been received and are pending our team&apos;s review.
        </p>
      )}
    </main>
  );
}

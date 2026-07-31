'use client';

// ============================================================
// UploadClient — invitation-only private upload UI
// PHX-LAUNCH-001 (R7: PHX-LAUNCH-001-R7 §5, §6)
// ------------------------------------------------------------
// R7 correction summary:
//  - §5: the token-state response can now report `state: 'finalized'`
//    (a minimal receipt for an already-finalized session, R7 §4). On
//    initial load this renders the success confirmation immediately,
//    with no upload controls ever mounted. During refreshUploadState,
//    a finalized receipt marks the whole session finalized and
//    promotes any still-ambiguous local entry to 'completed' --
//    finalization is only possible with zero reserved rows (R5 §3),
//    so an entry that was ambiguous but had a real server reservation
//    must have completed for finalization to have happened at all. A
//    network failure during verifyEntry/handleFinish now triggers
//    authoritative reconciliation rather than leaving the customer
//    looking at a permanent, false error for work the server already
//    committed -- and an ambiguous, still-known-object-key entry left
//    over after a refresh is transparently re-verified, which (R7 §2)
//    is now a safe, side-effect-free no-op if it was already completed.
//  - §6: completedBytes/reservedBytes are now stored in component
//    state alongside every other authoritative field, even though the
//    UI does not currently need to display both.
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

type TokenState =
  | { status: 'checking' }
  | { status: 'invalid' }
  | { status: 'finalized'; completedCount: number }
  | { status: 'valid'; maxFiles: number; maxFileSizeBytes: number; maxTotalSizeBytes: number; expiresAt: string };

type FinishState = 'idle' | 'finishing' | 'error';

interface ActiveTokenStateResponse {
  state: 'active';
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

interface FinalizedTokenStateResponse {
  state: 'finalized';
  completedCount: number;
  finalizedAt: string;
}

type TokenStateResponse = ActiveTokenStateResponse | FinalizedTokenStateResponse;

function generateClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const UPLOAD_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function uploadHeaders(token: string, includeJson = false): HeadersInit {
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
  };
}

export function UploadClient() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenState, setTokenState] = useState<TokenState>({ status: 'checking' });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [completedBytes, setCompletedBytes] = useState(0);
  const [reservedCount, setReservedCount] = useState(0);
  const [reservedBytes, setReservedBytes] = useState(0);
  const [remainingFileSlots, setRemainingFileSlots] = useState<number | null>(null);
  const [remainingBytes, setRemainingBytes] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState('');
  const [finalized, setFinalized] = useState(false);
  const [finishState, setFinishState] = useState<FinishState>('idle');
  const [finishError, setFinishError] = useState('');
  const inFlightRef = useRef<Set<string>>(new Set());
  const fragmentConsumedRef = useRef(false);
  const refreshSeqRef = useRef(0);
  const entriesRef = useRef<FileEntry[]>([]);
  entriesRef.current = entries;

  /**
   * R5 (§5)/R6 (§3)/R7 (§5, §6): the single reusable function that
   * refreshes the COMPLETE authoritative token-state response and
   * reconciles it into the entry list. Returns whether the session is
   * now known to be finalized, so a caller recovering from a network
   * failure (verifyEntry, handleFinish) can distinguish "the server
   * actually finalized this" from "still genuinely unresolved."
   */
  async function refreshUploadState(): Promise<{ finalized: boolean }> {
    if (!token) return { finalized };
    const seq = ++refreshSeqRef.current;
    try {
      const response = await fetch('/api/upload/session', {
        headers: uploadHeaders(token),
        cache: 'no-store',
      });
      if (seq !== refreshSeqRef.current) return { finalized };
      if (!response.ok) {
        setRefreshError('Your file state could not be refreshed. Please reload the page.');
        return { finalized };
      }
      const body = (await response.json()) as TokenStateResponse;
      if (seq !== refreshSeqRef.current) return { finalized };
      setRefreshError('');

      if (body.state === 'finalized') {
        // R7 (§5): finalization requires zero reserved rows (R5 §3),
        // so any local entry still sitting in an ambiguous state must
        // actually have completed for finalization to have happened
        // at all -- promote it rather than leaving a false error.
        setCompletedCount(body.completedCount);
        setFinalized(true);
        setEntries((prev) =>
          prev.map((entry) =>
            entry.phase === 'cancelled' || entry.phase === 'terminal' || entry.phase === 'rejected'
              ? entry
              : { ...entry, phase: 'completed' as const, message: undefined }
          )
        );
        return { finalized: true };
      }

      setCompletedCount(body.completedCount);
      setCompletedBytes(body.completedBytes);
      setReservedCount(body.reservedCount);
      setReservedBytes(body.reservedBytes);
      setRemainingFileSlots(body.remainingFileSlots);
      setRemainingBytes(body.remainingBytes);
      setEntries((prev) => reconcilePendingReservations(prev, body.pendingReservations));
      setTokenState((prev) =>
        prev.status === 'valid'
          ? { ...prev, maxFiles: body.maxFiles, maxFileSizeBytes: body.maxFileSizeBytes, maxTotalSizeBytes: body.maxTotalSizeBytes, expiresAt: body.expiresAt }
          : prev
      );

      // R7 (§5): an entry left ambiguous by a network failure right
      // after PUT/verify, whose object key is known but no longer
      // appears in the server's pending list, is transparently
      // re-verified -- if it was already completed, R7 §2's
      // idempotent replay resolves this with no side effects.
      const stillAmbiguous = entriesRef.current.filter(
        (entry) =>
          entry.phase === 'recoverable_error' &&
          entry.storageObjectKey &&
          entry.file &&
          !body.pendingReservations.some((r) => r.storageObjectKey === entry.storageObjectKey)
      );
      for (const entry of stillAmbiguous) {
        if (entry.storageObjectKey) {
          // eslint-disable-next-line no-await-in-loop
          await verifyEntry(entry.clientEntryId, entry.storageObjectKey);
        }
      }
      return { finalized: false };
    } catch {
      if (seq !== refreshSeqRef.current) return { finalized };
      setRefreshError('Your file state could not be refreshed. Please check your connection.');
      return { finalized };
    }
  }

  useEffect(() => {
    if (fragmentConsumedRef.current) return;
    fragmentConsumedRef.current = true;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const candidate = fragment.get('token');

    // Remove the bearer credential from the visible URL before the
    // first network request. It remains only in this component's
    // in-memory state for the lifetime of the page.
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

    if (!candidate || !UPLOAD_TOKEN_PATTERN.test(candidate)) {
      setTokenState({ status: 'invalid' });
      return;
    }

    setToken(candidate);
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch('/api/upload/session', {
      headers: uploadHeaders(token),
      cache: 'no-store',
    })
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) {
          setTokenState({ status: 'invalid' });
          return;
        }
        const body = (await response.json()) as TokenStateResponse;
        if (body.state === 'finalized') {
          // R7 (§5): render the success confirmation immediately --
          // no upload controls are ever mounted for an
          // already-finalized session.
          setTokenState({ status: 'finalized', completedCount: body.completedCount });
          setCompletedCount(body.completedCount);
          setFinalized(true);
          return;
        }
        setTokenState({
          status: 'valid',
          maxFiles: body.maxFiles,
          maxFileSizeBytes: body.maxFileSizeBytes,
          maxTotalSizeBytes: body.maxTotalSizeBytes,
          expiresAt: body.expiresAt,
        });
        setCompletedCount(body.completedCount);
        setCompletedBytes(body.completedBytes);
        setReservedCount(body.reservedCount);
        setReservedBytes(body.reservedBytes);
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
      reservationKey: generateClientId(),
      file,
      filename: file.name,
      declaredContentType: file.type || 'application/octet-stream',
      declaredSizeBytes: file.size,
      phase: 'pending',
    }));
    setEntries((prev) => [...prev, ...additions]);
  }

  async function signAndUpload(clientEntryId: string) {
    if (!token || inFlightRef.current.has(clientEntryId) || finalized) return;
    inFlightRef.current.add(clientEntryId);
    const entry = findEntryById(entriesRef.current, clientEntryId);
    if (!entry || !entry.reservationKey) {
      inFlightRef.current.delete(clientEntryId);
      return;
    }

    setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'signing', message: undefined }));
    try {
      const signResponse = await fetch('/api/upload/session/sign', {
        method: 'POST',
        headers: uploadHeaders(token, true),
        body: JSON.stringify({
          filename: entry.filename,
          contentType: entry.declaredContentType,
          sizeBytes: entry.declaredSizeBytes,
          reservationKey: entry.reservationKey,
        }),
      });
      if (signResponse.status === 409) {
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
    if (!token || inFlightRef.current.has(clientEntryId) || finalized) return;
    inFlightRef.current.add(clientEntryId);
    const entry = findEntryById(entriesRef.current, clientEntryId);
    const storageObjectKey = storageObjectKeyOverride ?? entry?.storageObjectKey;
    if (!storageObjectKey) {
      inFlightRef.current.delete(clientEntryId);
      return;
    }

    setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'verifying' }));
    try {
      const completeResponse = await fetch('/api/upload/session/complete', {
        method: 'POST',
        headers: uploadHeaders(token, true),
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
      const completeBody = (await completeResponse.json()) as { fileCount: number; finalized: boolean; replayed?: boolean };
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'completed', message: undefined }));
      setCompletedCount(completeBody.fileCount);
      if (completeBody.finalized) setFinalized(true);
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
    } catch {
      // R7 (§5): a network failure here does NOT necessarily mean the
      // completion didn't commit server-side -- call authoritative
      // refresh rather than assuming failure. If the refresh reveals
      // the session finalized, or this entry's own re-verification
      // (triggered inside refreshUploadState) resolves it, the
      // customer never sees a false permanent error.
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Network error while verifying. Please retry.' }));
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
    }
  }

  async function cancelEntry(clientEntryId: string) {
    if (!token || inFlightRef.current.has(clientEntryId) || finalized) return;
    const entry = findEntryById(entriesRef.current, clientEntryId);
    if (!entry) return;

    if (!entry.storageObjectKey) {
      if (entry.phase === 'pending' || entry.phase === 'terminal') {
        setEntries((prev) => removeEntryById(prev, clientEntryId));
        return;
      }
      await refreshUploadState();
      return;
    }

    inFlightRef.current.add(clientEntryId);
    setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'cancelling' }));
    try {
      const response = await fetch('/api/upload/session/cancel', {
        method: 'POST',
        headers: uploadHeaders(token, true),
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
    if (!token || finishState === 'finishing' || finalized) return;
    setFinishState('finishing');
    setFinishError('');
    try {
      const response = await fetch('/api/upload/session/finish', {
        method: 'POST',
        headers: uploadHeaders(token, true),
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
      // R7 (§5): the Finish request may have committed even though
      // its response was lost -- reconcile via authoritative refresh
      // rather than reporting a permanent network error when the
      // server actually already finalized the session.
      const result = await refreshUploadState();
      if (result.finalized) {
        setFinishState('idle');
      } else {
        setFinishState('error');
        setFinishError('Network error. Please try again.');
      }
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

  if (tokenState.status === 'finalized') {
    return (
      <main className="max-w-2xl mx-auto py-24 px-6 text-center">
        <h1 className="text-2xl font-bold text-phx-navy mb-3">Upload complete</h1>
        <p className="text-sm text-green-700" role="status">
          Thanks — {tokenState.completedCount} file{tokenState.completedCount === 1 ? '' : 's'} received and pending our
          team&apos;s review.
        </p>
      </main>
    );
  }

  const finishDisabled = !computeCanFinish({ completedCount, reservedCount, entries, finalized, finishing: finishState === 'finishing' });
  const remaining = remainingFileSlots ?? tokenState.maxFiles;
  // completedBytes/reservedBytes (R7 §6) are retained in state for
  // authoritative reconciliation completeness even though the UI does
  // not currently surface both independently.
  void completedBytes;
  void reservedBytes;

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

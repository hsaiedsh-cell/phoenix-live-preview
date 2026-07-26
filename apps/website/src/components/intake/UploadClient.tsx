'use client';

// ============================================================
// UploadClient — invitation-only private upload UI
// PHX-LAUNCH-001 (R5: PHX-LAUNCH-001-R5 §3 UI, §4, §5, §6 client half)
// ------------------------------------------------------------
// R5 correction summary:
//  - §4: every entry has a stable, client-generated clientEntryId
//    (see upload-client-state.ts), used for the React key, the
//    in-flight guard, and every update/remove/sign/upload/verify/
//    cancel/retry target. The mutable array index is never used as
//    an asynchronous identity -- removing entry A while entry B is
//    still uploading can no longer cause B's eventual completion to
//    update the wrong entry (or silently miss a since-shifted index).
//  - §5: a single refreshUploadState() function is the ONLY place
//    that updates completedCount/reservedCount/*Bytes/remaining*/
//    pendingReservations/expiresAt from the server, called after
//    every sign/completion/cancellation (success, failure, or
//    ambiguous-but-recoverable outcome). A monotonic sequence guard
//    discards a stale, out-of-order response rather than letting it
//    overwrite newer state. A failed refresh shows a recoverable
//    message and never guesses a quota value.
//  - §6 (client half): each entry generates its OWN reservationKey
//    once, at creation, and reuses it verbatim for every sign retry
//    -- never regenerated, so a lost-response retry reuses the exact
//    same server-side reservation instead of creating a second one.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import {
  type FileEntry,
  updateEntryById,
  removeEntryById,
  findEntryById,
  canFinish as computeCanFinish,
  anyEntryBusy,
} from './upload-client-state';

interface UploadClientProps {
  token: string;
}

interface PendingReservation {
  storageObjectKey: string;
  originalFilename: string;
  declaredContentType: string;
  declaredSizeBytes: number;
  reservationStatus: 'reserved';
}

type TokenState =
  | { status: 'checking' }
  | { status: 'invalid' }
  | { status: 'valid'; maxFiles: number; maxFileSizeBytes: number; maxTotalSizeBytes: number; expiresAt: string };

type FinishState = 'idle' | 'finishing' | 'error';

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
  // R5 (§5): monotonically increasing sequence guard -- a refresh
  // response is applied only if it is still the most recently
  // ISSUED refresh by the time it resolves; an older, slower request
  // that resolves after a newer one can never overwrite fresher state.
  const refreshSeqRef = useRef(0);
  const entriesRef = useRef<FileEntry[]>([]);
  entriesRef.current = entries;

  /** R5 (§5): the single reusable function that refreshes every authoritative quota field from the server. Never guesses on failure. */
  async function refreshUploadState(): Promise<void> {
    const seq = ++refreshSeqRef.current;
    try {
      const response = await fetch(`/api/upload/${encodeURIComponent(token)}`);
      if (seq !== refreshSeqRef.current) return;
      if (!response.ok) {
        setRefreshError('Your file state could not be refreshed. Please reload the page.');
        return;
      }
      const body = (await response.json()) as {
        completedCount: number;
        reservedCount: number;
        remainingFileSlots: number;
        remainingBytes: number;
      };
      if (seq !== refreshSeqRef.current) return;
      setRefreshError('');
      setCompletedCount(body.completedCount);
      setReservedCount(body.reservedCount);
      setRemainingFileSlots(body.remainingFileSlots);
      setRemainingBytes(body.remainingBytes);
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
        const body = (await response.json()) as {
          maxFiles: number;
          maxFileSizeBytes: number;
          maxTotalSizeBytes: number;
          expiresAt: string;
          completedCount: number;
          reservedCount: number;
          remainingFileSlots: number;
          remainingBytes: number;
          pendingReservations: PendingReservation[];
        };
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
        if (body.pendingReservations.length > 0) {
          setEntries((prev) => [
            ...body.pendingReservations.map(
              (reservation): FileEntry => ({
                clientEntryId: generateClientId(),
                reservationKey: generateClientId(),
                filename: reservation.originalFilename,
                declaredContentType: reservation.declaredContentType,
                declaredSizeBytes: reservation.declaredSizeBytes,
                storageObjectKey: reservation.storageObjectKey,
                phase: 'uploaded_unverified',
              })
            ),
            ...prev,
          ]);
        }
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

  async function signAndUpload(clientEntryId: string) {
    if (inFlightRef.current.has(clientEntryId) || finalized) return;
    inFlightRef.current.add(clientEntryId);
    const entry = findEntryById(entriesRef.current, clientEntryId);
    if (!entry) {
      inFlightRef.current.delete(clientEntryId);
      return;
    }

    setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'signing' }));
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
      if (!signResponse.ok) {
        const body = (await signResponse.json().catch(() => null)) as { error?: string } | null;
        setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: body?.error || 'File not accepted. You can retry.' }));
        inFlightRef.current.delete(clientEntryId);
        await refreshUploadState();
        return;
      }
      const { uploadUrl, storageObjectKey } = (await signResponse.json()) as { uploadUrl: string; storageObjectKey: string };
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'signed', storageObjectKey, signedUploadUrl: uploadUrl }));
      inFlightRef.current.delete(clientEntryId);
      await refreshUploadState();
      await uploadEntry(clientEntryId, { storageObjectKey, signedUploadUrl: uploadUrl });
    } catch {
      setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Network error while requesting an upload slot. You can retry -- this will not create a duplicate.' }));
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
        setEntries((prev) => updateEntryById(prev, clientEntryId, { phase: 'recoverable_error', message: 'Upload failed. You can retry without losing your place.' }));
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

  async function cancelEntry(clientEntryId: string) {
    if (inFlightRef.current.has(clientEntryId) || finalized) return;
    inFlightRef.current.add(clientEntryId);
    const entry = findEntryById(entriesRef.current, clientEntryId);
    if (!entry) {
      inFlightRef.current.delete(clientEntryId);
      return;
    }
    if (!entry.storageObjectKey) {
      setEntries((prev) => removeEntryById(prev, clientEntryId));
      inFlightRef.current.delete(clientEntryId);
      return;
    }
    // R5 (§3 UI): a visible cancelling phase, which counts as "busy"
    // and therefore blocks Finish while the request is in flight.
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
                <button onClick={() => signAndUpload(entry.clientEntryId)} className="text-phx-cyan-dark underline" type="button">
                  Upload
                </button>
              )}
              {(entry.phase === 'signing' || entry.phase === 'uploading' || entry.phase === 'verifying') && (
                <span className="text-gray-500">Working…</span>
              )}
              {entry.phase === 'cancelling' && <span className="text-gray-500">Cancelling…</span>}
              {entry.phase === 'completed' && <span className="text-green-600">Received</span>}
              {entry.phase === 'rejected' && <span className="text-red-600">{entry.message}</span>}
              {entry.phase === 'cancelled' && <span className="text-gray-400">Cancelled</span>}
              {(entry.phase === 'uploaded_unverified' || entry.phase === 'recoverable_error') && !finalized && (
                <>
                  <span className="text-amber-600">{entry.message || 'Not yet confirmed.'}</span>
                  {entry.phase === 'recoverable_error' && entry.file && entry.signedUploadUrl && (
                    <button onClick={() => uploadEntry(entry.clientEntryId)} className="text-phx-cyan-dark underline" type="button">
                      Retry upload
                    </button>
                  )}
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

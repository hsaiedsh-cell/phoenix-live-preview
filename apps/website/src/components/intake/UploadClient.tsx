'use client';

// ============================================================
// UploadClient — invitation-only private upload UI
// PHX-LAUNCH-001 (R4: PHX-LAUNCH-001-R4 §1, §2)
// ------------------------------------------------------------
// R4 correction summary:
//  - §1: the initial GET /api/upload/:token response now carries the
//    full authoritative state contract (completed/reserved counts and
//    bytes, remaining slots/bytes, and any pending reservations). The
//    UI initializes completedCount/remaining from THAT response, not
//    from a locally-assumed zero -- so after a page reload, a
//    customer who already completed a file can click "Finish
//    uploading" immediately, and existing in-flight reservations
//    reappear as recoverable entries instead of vanishing.
//  - §2: every file entry now tracks storageObjectKey,
//    signedUploadUrl, declaredSizeBytes, declaredContentType, and an
//    explicit `phase` (pending/signing/signed/uploading/
//    uploaded_unverified/verifying/completed/rejected/
//    recoverable_error/cancelled). A failed/ambiguous PUT or a failed
//    completion call preserves the reservation and offers Retry
//    (reusing the SAME signed URL/object key -- never re-signing,
//    which would consume additional quota) rather than silently
//    losing it. A new explicit Cancel action (POST
//    /api/upload/:token/cancel) releases a still-reserved file's
//    quota entirely, including for reservations recovered after a
//    reload (which have no locally-known signedUploadUrl to retry a
//    PUT with, only enough state to verify-or-cancel).
// ============================================================

import { useEffect, useRef, useState } from 'react';

interface UploadClientProps {
  token: string;
}

type EntryPhase =
  | 'pending'
  | 'signing'
  | 'signed'
  | 'uploading'
  | 'uploaded_unverified'
  | 'verifying'
  | 'completed'
  | 'rejected'
  | 'recoverable_error'
  | 'cancelled';

interface FileEntry {
  // Only present for a live, same-session file selection -- a
  // reservation recovered from a page reload has no File object to
  // re-PUT, only enough declared metadata to verify or cancel it.
  file?: File;
  filename: string;
  declaredContentType: string;
  declaredSizeBytes: number;
  storageObjectKey?: string;
  signedUploadUrl?: string;
  phase: EntryPhase;
  message?: string;
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
  | {
      status: 'valid';
      maxFiles: number;
      maxFileSizeBytes: number;
      expiresAt: string;
    };

type FinishState = 'idle' | 'finishing' | 'error';

export function UploadClient({ token }: UploadClientProps) {
  const [tokenState, setTokenState] = useState<TokenState>({ status: 'checking' });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  // R4 §1: sourced from the server on load and after every
  // completion/cancel/finish response -- never inferred solely from
  // local `entries`.
  const [completedCount, setCompletedCount] = useState(0);
  const [remainingFileSlots, setRemainingFileSlots] = useState<number | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [finishState, setFinishState] = useState<FinishState>('idle');
  const [finishError, setFinishError] = useState('');
  // Guards against duplicate/concurrent calls (sign, upload, verify,
  // cancel) for the SAME entry index.
  const inFlightRef = useRef<Set<number>>(new Set());

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
          expiresAt: string;
          completedCount: number;
          remainingFileSlots: number;
          pendingReservations: PendingReservation[];
        };
        setTokenState({ status: 'valid', maxFiles: body.maxFiles, maxFileSizeBytes: body.maxFileSizeBytes, expiresAt: body.expiresAt });
        // R4 §1/§2.4: initialize completed count and remaining limits
        // from the GET response, and surface any pending reservation
        // (from a prior visit, this session or a reload) as a
        // recoverable entry -- never silently dropped.
        setCompletedCount(body.completedCount);
        setRemainingFileSlots(body.remainingFileSlots);
        if (body.pendingReservations.length > 0) {
          setEntries((prev) => [
            ...body.pendingReservations.map(
              (reservation): FileEntry => ({
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

  function updateEntry(index: number, patch: Partial<FileEntry>) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  function onFilesSelected(fileList: FileList | null) {
    if (!fileList || finalized) return;
    const additions: FileEntry[] = Array.from(fileList).map((file) => ({
      file,
      filename: file.name,
      declaredContentType: file.type || 'application/octet-stream',
      declaredSizeBytes: file.size,
      phase: 'pending',
    }));
    setEntries((prev) => [...prev, ...additions]);
  }

  /** Sign -> PUT -> complete, for a brand-new (never-signed) entry. */
  async function signAndUpload(index: number) {
    if (inFlightRef.current.has(index) || finalized) return;
    inFlightRef.current.add(index);
    const entry = entries[index];

    updateEntry(index, { phase: 'signing' });
    try {
      const signResponse = await fetch(`/api/upload/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: entry.filename,
          contentType: entry.declaredContentType,
          sizeBytes: entry.declaredSizeBytes,
        }),
      });
      if (!signResponse.ok) {
        const body = (await signResponse.json().catch(() => null)) as { error?: string } | null;
        updateEntry(index, { phase: 'rejected', message: body?.error || 'File not accepted.' });
        inFlightRef.current.delete(index);
        return;
      }
      const { uploadUrl, storageObjectKey } = (await signResponse.json()) as { uploadUrl: string; storageObjectKey: string };
      updateEntry(index, { phase: 'signed', storageObjectKey, signedUploadUrl: uploadUrl });
      inFlightRef.current.delete(index);
      await uploadEntry(index, { storageObjectKey, signedUploadUrl: uploadUrl });
    } catch {
      updateEntry(index, { phase: 'recoverable_error', message: 'Network error while requesting an upload slot. Please try again.' });
      inFlightRef.current.delete(index);
    }
  }

  /** PUT the file bytes for an already-signed entry. Reusable for retry -- never re-signs, never consumes additional quota. */
  async function uploadEntry(index: number, signed?: { storageObjectKey: string; signedUploadUrl: string }) {
    if (inFlightRef.current.has(index) || finalized) return;
    inFlightRef.current.add(index);
    const entry = entries[index];
    const storageObjectKey = signed?.storageObjectKey ?? entry.storageObjectKey;
    const signedUploadUrl = signed?.signedUploadUrl ?? entry.signedUploadUrl;
    if (!storageObjectKey || !signedUploadUrl || !entry.file) {
      inFlightRef.current.delete(index);
      return;
    }

    updateEntry(index, { phase: 'uploading' });
    try {
      const putResponse = await fetch(signedUploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': entry.declaredContentType },
        body: entry.file,
      });
      if (!putResponse.ok) {
        // R4 §2.2: a failed/ambiguous PUT preserves the reservation
        // -- the customer can retry the SAME signed upload.
        updateEntry(index, { phase: 'recoverable_error', message: 'Upload failed. You can retry without losing your place.' });
        inFlightRef.current.delete(index);
        return;
      }
      updateEntry(index, { phase: 'uploaded_unverified' });
      inFlightRef.current.delete(index);
      await verifyEntry(index, storageObjectKey);
    } catch {
      updateEntry(index, { phase: 'recoverable_error', message: 'Network error during upload. You can retry without losing your place.' });
      inFlightRef.current.delete(index);
    }
  }

  /** Calls .../complete for an already-uploaded (or possibly-uploaded, e.g. recovered-after-reload) entry. Never creates a new reservation. */
  async function verifyEntry(index: number, storageObjectKeyOverride?: string) {
    if (inFlightRef.current.has(index) || finalized) return;
    inFlightRef.current.add(index);
    const entry = entries[index];
    const storageObjectKey = storageObjectKeyOverride ?? entry.storageObjectKey;
    if (!storageObjectKey) {
      inFlightRef.current.delete(index);
      return;
    }

    updateEntry(index, { phase: 'verifying' });
    try {
      const completeResponse = await fetch(`/api/upload/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageObjectKey, finishSession: false }),
      });
      if (!completeResponse.ok) {
        updateEntry(index, {
          phase: 'recoverable_error',
          message: 'Could not verify this file yet. If you already uploaded it, try Verify again; otherwise Cancel and re-select it.',
        });
        inFlightRef.current.delete(index);
        return;
      }
      const completeBody = (await completeResponse.json()) as { fileCount: number; finalized: boolean };
      updateEntry(index, { phase: 'completed', message: undefined });
      setCompletedCount(completeBody.fileCount);
      if (completeBody.finalized) setFinalized(true);
      inFlightRef.current.delete(index);
    } catch {
      updateEntry(index, { phase: 'recoverable_error', message: 'Network error while verifying. Please retry.' });
      inFlightRef.current.delete(index);
    }
  }

  /** R4 §2.3: releases a still-reserved entry's quota entirely. */
  async function cancelEntry(index: number) {
    if (inFlightRef.current.has(index) || finalized) return;
    inFlightRef.current.add(index);
    const entry = entries[index];
    if (!entry.storageObjectKey) {
      // Never signed yet -- nothing server-side to cancel, just drop it locally.
      setEntries((prev) => prev.filter((_, i) => i !== index));
      inFlightRef.current.delete(index);
      return;
    }
    try {
      const response = await fetch(`/api/upload/${encodeURIComponent(token)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageObjectKey: entry.storageObjectKey }),
      });
      if (response.ok) {
        updateEntry(index, { phase: 'cancelled', message: undefined });
        // Refresh remaining-slots display from the token-state
        // endpoint rather than guessing locally.
        const stateResponse = await fetch(`/api/upload/${encodeURIComponent(token)}`);
        if (stateResponse.ok) {
          const body = (await stateResponse.json()) as { remainingFileSlots: number; completedCount: number };
          setRemainingFileSlots(body.remainingFileSlots);
          setCompletedCount(body.completedCount);
        }
      } else {
        updateEntry(index, { message: 'Could not cancel this file. Please try again.' });
      }
    } catch {
      updateEntry(index, { message: 'Network error while cancelling. Please try again.' });
    } finally {
      inFlightRef.current.delete(index);
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

  const anyBusy = entries.some((e) => ['signing', 'uploading', 'verifying'].includes(e.phase));
  const canFinish = !finalized && completedCount > 0 && !anyBusy && finishState !== 'finishing';
  const remaining = remainingFileSlots ?? tokenState.maxFiles;

  return (
    <main className="max-w-2xl mx-auto py-24 px-6">
      <h1 className="text-2xl font-bold text-phx-navy mb-3">Upload your files</h1>
      <p className="text-sm text-gray-600 mb-2">
        You can upload up to {tokenState.maxFiles} files (20 MB per file, 60 MB total). This link expires{' '}
        {new Date(tokenState.expiresAt).toLocaleString()} and can only be used once.
      </p>
      <p className="text-sm text-gray-500 mb-8">
        {completedCount} of {tokenState.maxFiles} files received{!finalized ? ` — ${remaining} remaining` : ''}.
      </p>

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
        {entries.map((entry, index) => (
          <li key={`${entry.filename}-${index}`} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 gap-3">
            <span className="text-sm text-gray-700 truncate">{entry.filename}</span>
            <span className="text-xs flex items-center gap-2 shrink-0">
              {entry.phase === 'pending' && !finalized && (
                <button onClick={() => signAndUpload(index)} className="text-phx-cyan-dark underline" type="button">
                  Upload
                </button>
              )}
              {(entry.phase === 'signing' || entry.phase === 'uploading' || entry.phase === 'verifying') && (
                <span className="text-gray-500">Working…</span>
              )}
              {entry.phase === 'completed' && <span className="text-green-600">Received</span>}
              {entry.phase === 'rejected' && <span className="text-red-600">{entry.message}</span>}
              {entry.phase === 'cancelled' && <span className="text-gray-400">Cancelled</span>}
              {(entry.phase === 'uploaded_unverified' || entry.phase === 'recoverable_error') && !finalized && (
                <>
                  <span className="text-amber-600">{entry.message || 'Not yet confirmed.'}</span>
                  {entry.phase === 'recoverable_error' && entry.file && entry.signedUploadUrl && (
                    <button onClick={() => uploadEntry(index)} className="text-phx-cyan-dark underline" type="button">
                      Retry upload
                    </button>
                  )}
                  {entry.storageObjectKey && (
                    <button onClick={() => verifyEntry(index)} className="text-phx-cyan-dark underline" type="button">
                      Verify
                    </button>
                  )}
                  <button onClick={() => cancelEntry(index)} className="text-red-600 underline" type="button">
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
            disabled={!canFinish}
            className="inline-flex items-center justify-center px-6 py-3 bg-phx-navy text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {finishState === 'finishing' ? 'Finishing…' : 'Finish uploading'}
          </button>
          {completedCount === 0 && (
            <p className="text-xs text-gray-400 mt-2">Upload at least one file before finishing.</p>
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

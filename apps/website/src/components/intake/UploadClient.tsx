'use client';

// ============================================================
// UploadClient — invitation-only private upload UI
// PHX-LAUNCH-001 (R2: PHX-LAUNCH-001-R2 §3)
// ------------------------------------------------------------
// Flow: GET /api/upload/:token (validity) -> for each file,
// POST /api/upload/:token/sign -> PUT the file bytes to the signed
// URL -> POST /api/upload/:token/complete (now just
// { storageObjectKey, finishSession: false } -- R2 removed
// originalFilename/contentType, which the server no longer accepts).
// Finalization is now an explicit "Finish uploading" action calling
// POST /api/upload/:token/finish, NOT inferred from a stale local
// snapshot of `entries` -- concurrent uploads or a rejected file
// could previously leave the session never finalized. Automatic
// server-side finalization at the exact max file count is unaffected
// and still happens without any client action.
// ============================================================

import { useEffect, useRef, useState } from 'react';

interface UploadClientProps {
  token: string;
}

type TokenState =
  | { status: 'checking' }
  | { status: 'invalid' }
  | { status: 'valid'; maxFiles: number; expiresAt: string };

interface FileEntry {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'rejected' | 'error';
  message?: string;
}

type FinishState = 'idle' | 'finishing' | 'error';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function UploadClient({ token }: UploadClientProps) {
  const [tokenState, setTokenState] = useState<TokenState>({ status: 'checking' });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  // R2: completedCount/finalized are always set FROM SERVER RESPONSES
  // (the complete/finish endpoints' own return values), never
  // inferred by counting local `entries` -- see the requirement that
  // completed count and remaining allowance reflect server state.
  const [completedCount, setCompletedCount] = useState(0);
  const [finalized, setFinalized] = useState(false);
  const [finishState, setFinishState] = useState<FinishState>('idle');
  const [finishError, setFinishError] = useState('');
  // R2: guards against a double-click/duplicate parallel call for the
  // SAME entry -- a ref (not state) so the check-then-set is
  // synchronous and cannot race with React's own async state updates.
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
        const body = (await response.json()) as { maxFiles: number; expiresAt: string };
        setTokenState({ status: 'valid', maxFiles: body.maxFiles, expiresAt: body.expiresAt });
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
    const additions: FileEntry[] = Array.from(fileList).map((file) => ({ file, status: 'pending' }));
    setEntries((prev) => [...prev, ...additions]);
  }

  async function uploadOne(index: number) {
    // R2 item 6: prevent parallel clicks from causing duplicate
    // sign/complete calls for the same entry.
    if (inFlightRef.current.has(index) || finalized) return;
    inFlightRef.current.add(index);

    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, status: 'uploading' } : e)));
    const entry = entries[index];

    function fail(status: FileEntry['status'], message: string) {
      setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, status, message } : e)));
      inFlightRef.current.delete(index);
    }

    if (entry.file.size > MAX_FILE_SIZE_BYTES) {
      fail('rejected', 'File exceeds 20 MB limit.');
      return;
    }

    try {
      const signResponse = await fetch(`/api/upload/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: entry.file.name,
          contentType: entry.file.type || 'application/octet-stream',
          sizeBytes: entry.file.size,
        }),
      });
      if (!signResponse.ok) {
        const body = (await signResponse.json().catch(() => null)) as { error?: string } | null;
        fail('rejected', body?.error || 'File not accepted.');
        return;
      }
      const { uploadUrl, storageObjectKey } = (await signResponse.json()) as {
        uploadUrl: string;
        storageObjectKey: string;
      };

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': entry.file.type || 'application/octet-stream' },
        body: entry.file,
      });
      if (!putResponse.ok) {
        fail('error', 'Upload failed. Please retry.');
        return;
      }

      // R2: the completion body is now the minimal server-accepted
      // contract only -- no originalFilename/contentType, and
      // finishSession is always false here; finalization is the
      // separate explicit action below (or automatic at max count,
      // handled entirely server-side).
      const completeResponse = await fetch(`/api/upload/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageObjectKey, finishSession: false }),
      });
      if (!completeResponse.ok) {
        fail('error', 'Could not verify upload.');
        return;
      }
      const completeBody = (await completeResponse.json()) as { fileCount: number; finalized: boolean };

      setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, status: 'done' } : e)));
      setCompletedCount(completeBody.fileCount);
      if (completeBody.finalized) {
        // Reached the exact maximum file count -- the server
        // auto-finalized without any explicit Finish click.
        setFinalized(true);
      }
      inFlightRef.current.delete(index);
    } catch {
      fail('error', 'Network error. Please retry.');
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

  // R2 item 4/10: Finish is enabled only when at least one file has
  // completed, no file is currently uploading, and the session is
  // not already finalized -- and the remaining allowance is computed
  // from the server-reported completedCount, not from counting
  // `entries`.
  const anyUploading = entries.some((e) => e.status === 'uploading');
  const canFinish = !finalized && completedCount > 0 && !anyUploading && finishState !== 'finishing';
  const remaining = Math.max(0, tokenState.maxFiles - completedCount);

  return (
    <main className="max-w-2xl mx-auto py-24 px-6">
      <h1 className="text-2xl font-bold text-phx-navy mb-3">Upload your files</h1>
      <p className="text-sm text-gray-600 mb-2">
        You can upload up to {tokenState.maxFiles} files (20 MB per file, 60 MB total). This link expires{' '}
        {new Date(tokenState.expiresAt).toLocaleString()} and can only be used once.
      </p>
      {/* R2 item 10: completed count and remaining allowance, sourced from server responses. */}
      <p className="text-sm text-gray-500 mb-8">
        {completedCount} of {tokenState.maxFiles} files received{!finalized && remaining > 0 ? ` — ${remaining} remaining` : ''}.
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
          <li key={`${entry.file.name}-${index}`} className="flex items-center justify-between border border-gray-200 rounded-lg p-3">
            <span className="text-sm text-gray-700 truncate">{entry.file.name}</span>
            <span className="text-xs">
              {entry.status === 'pending' && !finalized && (
                <button onClick={() => uploadOne(index)} className="text-phx-cyan-dark underline" type="button">
                  Upload
                </button>
              )}
              {entry.status === 'uploading' && <span className="text-gray-500">Uploading…</span>}
              {entry.status === 'done' && <span className="text-green-600">Received</span>}
              {(entry.status === 'rejected' || entry.status === 'error') && (
                <span className="text-red-600">{entry.message}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* R2 item 3/9: explicit Finish action; once finalized, file selection and all upload actions are disabled above. */}
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

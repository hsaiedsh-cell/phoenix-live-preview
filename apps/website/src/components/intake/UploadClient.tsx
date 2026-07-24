'use client';

// ============================================================
// UploadClient — invitation-only private upload UI
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Flow: GET /api/upload/:token (validity) -> for each file,
// POST /api/upload/:token/sign -> PUT the file bytes to the signed
// URL -> POST /api/upload/:token/complete. No file is ever given a
// public URL, and the last accepted file marks the session
// "finished" via the finishSession flag.
// ============================================================

import { useEffect, useState } from 'react';

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

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export function UploadClient({ token }: UploadClientProps) {
  const [tokenState, setTokenState] = useState<TokenState>({ status: 'checking' });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [finished, setFinished] = useState(false);

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
    if (!fileList) return;
    const additions: FileEntry[] = Array.from(fileList).map((file) => ({ file, status: 'pending' }));
    setEntries((prev) => [...prev, ...additions]);
  }

  async function uploadOne(index: number) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, status: 'uploading' } : e)));
    const entry = entries[index];

    if (entry.file.size > MAX_FILE_SIZE_BYTES) {
      setEntries((prev) =>
        prev.map((e, i) => (i === index ? { ...e, status: 'rejected', message: 'File exceeds 20 MB limit.' } : e))
      );
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
        setEntries((prev) =>
          prev.map((e, i) => (i === index ? { ...e, status: 'rejected', message: body?.error || 'File not accepted.' } : e))
        );
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
        setEntries((prev) =>
          prev.map((e, i) => (i === index ? { ...e, status: 'error', message: 'Upload failed. Please retry.' } : e))
        );
        return;
      }

      const remaining = entries.filter((e, i) => i !== index && e.status !== 'done').length === 0;
      const completeResponse = await fetch(`/api/upload/${encodeURIComponent(token)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storageObjectKey,
          originalFilename: entry.file.name,
          contentType: entry.file.type || 'application/octet-stream',
          finishSession: remaining,
        }),
      });
      if (!completeResponse.ok) {
        setEntries((prev) =>
          prev.map((e, i) => (i === index ? { ...e, status: 'error', message: 'Could not verify upload.' } : e))
        );
        return;
      }

      setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, status: 'done' } : e)));
      if (remaining) setFinished(true);
    } catch {
      setEntries((prev) =>
        prev.map((e, i) => (i === index ? { ...e, status: 'error', message: 'Network error. Please retry.' } : e))
      );
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

  return (
    <main className="max-w-2xl mx-auto py-24 px-6">
      <h1 className="text-2xl font-bold text-phx-navy mb-3">Upload your files</h1>
      <p className="text-sm text-gray-600 mb-8">
        You can upload up to {tokenState.maxFiles} files (20 MB per file, 60 MB total). This link expires{' '}
        {new Date(tokenState.expiresAt).toLocaleString()} and can only be used once.
      </p>

      {!finished && (
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
              {entry.status === 'pending' && (
                <button
                  onClick={() => uploadOne(index)}
                  className="text-phx-cyan-dark underline"
                  type="button"
                >
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

      {finished && (
        <p className="mt-8 text-sm text-green-700">
          Thanks — your files have been received and are pending our team&apos;s review.
        </p>
      )}
    </main>
  );
}

'use client';

// ============================================================
// Phoenix Platform — ReportDetailPoller
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Renders ONE report row's status-appropriate action
// (Start / Retry / Regenerate / Download) and, while that row is
// Generating, polls GET /api/reports/:id for status on a bounded
// interval — real-dev/production-auth only.
//
// ---- No client-side role/ownership inference (Phase 1 Addendum A §9,
// ChatGPT architecture/QA correction) --------------------------------
// This component does NOT attempt to pre-compute whether the current
// user may act on a given report. It renders the status-appropriate
// action to any signed-in workspace member for any report row — the
// same precedent RequestReportButton.tsx already established (no
// client-side permission pre-check; call the endpoint and render
// whatever error comes back). The reason: neither real-dev
// (apiConfig.devUserId — a user id with no client-visible role) nor
// production-auth (a Clerk bearer token — no client-visible Phoenix
// role/ownership mapping) has any real, non-mock source of "what is my
// role/ownership here" on the client today. usePhoenixSession() /
// SessionProvider.tsx exists but is explicitly self-documented as
// mock-only, not a security boundary — using it here to gate a REAL
// action would be exactly the invented-session-contract mistake this
// correction warned against. Backend authorization
// (requirePermission()/requireReportOwnership()) remains the sole
// authority; a denied action surfaces as a sanitized inline 403 message
// here, never a client-side-hidden button.
//
// ---- Bounded polling --------------------------------------------------
// Stops on: reaching a terminal/non-Generating status, hitting
// MAX_POLL_ATTEMPTS, an error response, or component unmount (the
// effect's cleanup clears the timer in every case) — never an
// unbounded loop.
//
// ---- No storage key/path/hash/internal detail ever reaches this file --
// Every value rendered here comes from BackendReport (the canonical,
// already-sanitized read model) or from a RealApiError's `.message`
// (itself already sanitized by real-api-client.ts's
// backendErrorToRealApiError() — see that function; it maps backend
// error codes to short, generic messages, never passing through a raw
// backend error string beyond what the backend itself already
// sanitizes at the API boundary).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import type { BackendReport } from '@/lib/real-api-client';
import { realGenerateReport, realGetReportDetail, realDownloadReport } from '@/lib/real-api-client.client';
import { RealApiError } from '@/lib/real-api-client';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 30; // 30 * 3s = 90s bounded polling window.

interface ReportDetailPollerProps {
  initial: BackendReport;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

export function ReportDetailPoller({ initial }: ReportDetailPollerProps) {
  const [report, setReport] = useState<BackendReport>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollAttemptsRef = useRef(0);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Bounded polling while Generating.
  useEffect(() => {
    if (report.status !== 'Generating') {
      pollAttemptsRef.current = 0;
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled || unmountedRef.current) return;
      pollAttemptsRef.current += 1;

      try {
        const latest = await realGetReportDetail(report.id);
        if (cancelled || unmountedRef.current) return;
        setReport(latest);
        // Stops automatically on the next effect run once status !== 'Generating'.
      } catch {
        // A poll error stops polling for this row rather than retrying
        // indefinitely — the row simply keeps its last-known status; the
        // next user-triggered action (or a page refresh) will reflect
        // the true current state. No raw error is surfaced for a
        // background poll tick.
        if (!cancelled && !unmountedRef.current) pollAttemptsRef.current = MAX_POLL_ATTEMPTS;
      }

      if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS && !cancelled && !unmountedRef.current) {
        setError('Still generating — check back shortly.');
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [report.status, report.id]);

  async function handleGenerateAction() {
    setBusy(true);
    setError(null);
    try {
      const updated = await realGenerateReport(report.id);
      setReport(updated);
      pollAttemptsRef.current = 0;
    } catch (err) {
      setError(err instanceof RealApiError ? err.message : 'This action could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await realDownloadReport(report.id);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      if (err instanceof RealApiError) {
        // A download-time integrity failure transitions the report to
        // Failed server-side (see routes/reports.ts) — refresh this
        // row's state so the UI reflects that immediately, rather than
        // continuing to show a stale "Available" status the user could
        // click "Download" on again.
        try {
          const latest = await realGetReportDetail(report.id);
          setReport(latest);
        } catch {
          // If even the refresh fails, fall through to showing the
          // original download error below.
        }
        setError(err.message);
      } else {
        setError('This report could not be downloaded. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60 align-top">
      <td className="px-5 py-3.5 font-semibold text-phx-navy">{report.name}</td>
      <td className="px-5 py-3.5 text-gray-600">{report.templateName}</td>
      <td className="px-5 py-3.5 text-gray-600">
        {report.assetId ? report.assetName : <span className="text-gray-400">Workspace</span>}
      </td>
      <td className="px-5 py-3.5 text-gray-600">
        <span
          className={
            report.status === 'Available'
              ? 'text-emerald-700'
              : report.status === 'Failed'
                ? 'text-red-600'
                : report.status === 'Generating'
                  ? 'text-amber-600'
                  : 'text-gray-500'
          }
        >
          {report.status}
        </span>
        {report.failureReason && <div className="text-[11px] text-red-500 mt-1">{report.failureReason}</div>}
      </td>
      <td className="px-5 py-3.5 text-gray-400 text-xs">v{report.version}</td>
      <td className="px-5 py-3.5 text-gray-600 uppercase">{report.format}</td>
      <td className="px-5 py-3.5 text-gray-400 text-xs">{formatDate(report.requestedAt)}</td>
      <td className="px-5 py-3.5">
        {report.status === 'Requested' && (
          <button
            onClick={handleGenerateAction}
            disabled={busy}
            className="text-xs font-semibold text-phx-navy border border-gray-200 rounded-md px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Starting…' : 'Start'}
          </button>
        )}
        {report.status === 'Generating' && <span className="text-xs text-gray-400">Generating…</span>}
        {report.status === 'Available' && (
          <button
            onClick={handleDownload}
            disabled={busy}
            className="text-xs font-semibold text-white bg-phx-cyan rounded-md px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Downloading…' : 'Download'}
          </button>
        )}
        {report.status === 'Failed' && (
          <button
            onClick={handleGenerateAction}
            disabled={busy}
            className="text-xs font-semibold text-phx-navy border border-gray-200 rounded-md px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Retrying…' : 'Retry'}
          </button>
        )}
        {report.status === 'Expired' && (
          <button
            onClick={handleGenerateAction}
            disabled={busy}
            className="text-xs font-semibold text-phx-navy border border-gray-200 rounded-md px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Regenerating…' : 'Regenerate'}
          </button>
        )}
        {error && <div className="text-[11px] text-red-500 mt-1 max-w-[220px]">{error}</div>}
      </td>
    </tr>
  );
}

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
// ---- Bounded polling (see lib/report-polling-controller.ts) -----------
// Uses createPollingController(), a pure, framework-free polling loop
// that schedules its OWN next tick from inside itself for as long as
// the latest fetched status is non-terminal — fixing a real bug found
// during ChatGPT architecture/QA review: the original implementation
// scheduled exactly one setTimeout inside a useEffect keyed on
// [report.status, report.id], which never re-ran once the status
// value stopped changing (i.e. stayed 'Generating' across a poll),
// silently stopping after the first tick. See that file's header for
// the full contract this controller guarantees: stops on Requested/
// Available/Failed/Expired, stops after MAX_POLL_ATTEMPTS, stops on
// fetch error, stops on unmount, never overlaps requests, and resets
// cleanly on every start() call (used here after Start/Retry/
// Regenerate).
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
import { createPollingController } from '@/lib/report-polling-controller';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 30; // 30 * 3s = 90s bounded polling window.

interface ReportDetailPollerProps {
  initial: BackendReport;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

function isNonTerminalStatus(report: BackendReport): boolean {
  return report.status === 'Generating';
}

export function ReportDetailPoller({ initial }: ReportDetailPollerProps) {
  const [report, setReport] = useState<BackendReport>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The controller instance and the report id/status it was built for
  // are held in refs, not state — the polling loop itself must not be
  // recreated on every render (only when the report id changes, or when
  // we explicitly (re)start it after an action).
  const controllerRef = useRef<ReturnType<typeof createPollingController<BackendReport>> | null>(null);
  const reportIdRef = useRef(report.id);

  function buildController(reportId: string) {
    return createPollingController<BackendReport>({
      intervalMs: POLL_INTERVAL_MS,
      maxAttempts: MAX_POLL_ATTEMPTS,
      isTerminal: (result) => !isNonTerminalStatus(result),
      fetchLatest: () => realGetReportDetail(reportId),
      onUpdate: (latest) => setReport(latest),
      onError: () => {
        // A poll error stops polling for this row rather than retrying
        // indefinitely — the row simply keeps its last-known status;
        // the next user-triggered action (or a page refresh) reflects
        // the true current state. No raw error is surfaced for a
        // background poll tick.
      },
      onMaxAttemptsReached: () => setError('Still generating — check back shortly.'),
    });
  }

  // (Re)build and (re)start the controller whenever the report id
  // changes (a new row) or the status becomes 'Generating' (a fresh
  // generation attempt, whether from the initial server-rendered state
  // or from a client-triggered action) — and stop it whenever the
  // status is anything else. Stopping is idempotent, so this effect is
  // safe to run on every relevant status change without double-starting.
  useEffect(() => {
    reportIdRef.current = report.id;

    if (!isNonTerminalStatus(report)) {
      controllerRef.current?.stop();
      return;
    }

    const controller = buildController(report.id);
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id, report.status]);

  // Unconditional unmount safety net — stops any in-flight controller
  // even if the effect above's own cleanup somehow did not run first.
  useEffect(() => {
    return () => {
      controllerRef.current?.stop();
    };
  }, []);

  async function handleGenerateAction() {
    setBusy(true);
    setError(null);
    try {
      const updated = await realGenerateReport(report.id);
      // Explicitly stop any existing controller before applying the
      // update — the effect above will build and start a fresh one
      // (fresh attempt budget) once `updated.status` renders as
      // 'Generating', but stopping here first guarantees no stale
      // in-flight poll from the PRIOR generation attempt can race the
      // new one.
      controllerRef.current?.stop();
      setReport(updated);
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

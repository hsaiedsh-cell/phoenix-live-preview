'use client';

// ============================================================
// Phoenix Platform — Request Report Button
// PHX-REPORTS-003 — Report Request API & State Model
// ------------------------------------------------------------
// The one write action this sprint adds to the frontend: calls the
// real POST /api/workspaces/:workspaceId/reports endpoint (see
// apps/backend/src/routes/reports.ts) and displays the real resulting
// status ('Requested') — no fake progress, no fake download, no fake
// PDF, no spinner pretending work is happening, per the task brief.
//
// Only rendered from reports/page.tsx in real-dev/production-auth
// mode (see that file) — mock mode has no backend to call, and
// vercel-supabase-preview mode has no write path (PHX-REPORTS-001
// only migrated the read side for that mode; this sprint does not
// expand it).
//
// ---- templateId source — a documented, honest limitation ----------
// The backend has no "list report templates" endpoint (GET
// .../reports itself is still a stub — there is no templates-only
// listing endpoint either, and adding one is out of this sprint's
// scope). There is therefore nothing live this component could read a
// template choice from. Rather than inventing/hardcoding a template
// id, this component takes `workspaceId`/`templateId` as props,
// sourced by its caller (reports/page.tsx) from
// api-config.ts's devWorkspaceId/productionWorkspaceId and the new
// defaultReportTemplateId interim bridge — see that field's doc
// comment. If either is missing, this component renders a disabled,
// clearly-labeled inert state instead of guessing.
//
// ---- R1 correction: this component NEVER sends assetId -------------
// This component sends only `{ templateId }` — it has no assetId
// input of any kind (there is no asset picker; adding one is out of
// this sprint's scope, same reasoning as the missing template list
// above). R0 configured/documented a SingleAsset-scope template as the
// default, which made every click fail with a 400 (the backend
// correctly requires assetId for SingleAsset-scope templates — see
// routes/reports.ts). The configured `defaultReportTemplateId` MUST
// therefore reference a 'Workspace' or 'CertificationPortfolio'-scope
// template (assetId not required/accepted) for this button to ever
// succeed — see .env.example's corrected guidance and
// scripts/verify-report-request.ts, which exercises this exact call
// against a live backend to prove it.
// ============================================================

import { useState } from 'react';
import { realCreateReportRequest } from '@/lib/real-api-client.client';

interface RequestReportButtonProps {
  workspaceId: string | null;
  templateId: string | null;
}

type RequestState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'requested'; reportId: string; reportName: string; version: number }
  | { status: 'error'; message: string };

export function RequestReportButton({ workspaceId, templateId }: RequestReportButtonProps) {
  const [state, setState] = useState<RequestState>({ status: 'idle' });

  if (!workspaceId || !templateId) {
    return (
      <div className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg px-4 py-3">
        Report requests are not configured for this deployment yet (no default report template is set). No
        report will be requested.
      </div>
    );
  }

  if (state.status === 'requested') {
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg px-4 py-3">
        <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
        Requested — &quot;{state.reportName}&quot; v{state.version} (id: {state.reportId.slice(0, 8)}…)
      </div>
    );
  }

  async function handleClick() {
    setState({ status: 'submitting' });
    try {
      const report = await realCreateReportRequest(workspaceId as string, { templateId: templateId as string });
      setState({ status: 'requested', reportId: report.id, reportName: report.name, version: report.version });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to request report.',
      });
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={state.status === 'submitting'}
        className="text-xs font-semibold px-4 py-2.5 rounded-lg bg-phx-navy text-white disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state.status === 'submitting' ? 'Requesting…' : 'Request Report'}
      </button>
      {state.status === 'error' && <p className="mt-2 text-xs text-red-600">{state.message}</p>}
    </div>
  );
}

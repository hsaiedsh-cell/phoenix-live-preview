// ============================================================
// Phoenix Platform — Report Request Frontend Data-Layer Verification
// PHX-REPORTS-003-R1 — Report Request API & State Model (correction)
// ------------------------------------------------------------
// This is NOT a browser test, and does not claim to be one. It
// executes the actual, shipped frontend function
// (real-api-client.client.ts's realCreateReportRequest()) under
// plain Node (via tsx), against a real, running backend — proving the
// request payload the "Request Report" button will send for the
// CONFIGURED WORKSPACE-SCOPE DEFAULT TEMPLATE is valid end-to-end,
// without needing a browser, a DOM, or a Clerk session.
//
// This is possible without a browser only because, in real-dev mode,
// resolveClientAuthHeaders() (real-api-client.client.ts) touches
// nothing DOM/browser-specific — it reads NEXT_PUBLIC_* env vars via
// api-config.ts's readEnv() (plain process.env, no Next.js runtime
// bundling dependency) and returns a plain X-Phoenix-User-Id header.
// production-auth mode's Clerk path is NOT exercised by this script
// (that genuinely does require a browser session) — see the QA
// report's Limitations for what remains browser-unverified.
//
// Run with:
//   NEXT_PUBLIC_PHOENIX_API_MODE=real-dev \
//   NEXT_PUBLIC_PHOENIX_BACKEND_URL=http://localhost:4000 \
//   NEXT_PUBLIC_PHOENIX_DEV_USER_ID=<a seeded Contributor/Reviewer/Owner/Admin user id> \
//   NEXT_PUBLIC_PHOENIX_DEFAULT_REPORT_TEMPLATE_ID=00000011-1111-4111-8111-000000000002 \
//   WORKSPACE_ID=00000003-1111-4111-8111-000000000001 \
//   npx tsx scripts/verify-report-request.ts
//
// Exits non-zero and prints the real error on any failure. Prints the
// real created report (including version) on success.
// ============================================================

import { getPhoenixApiConfig } from '../src/lib/api-config';
import { realCreateReportRequest } from '../src/lib/real-api-client.client';

async function main() {
  const config = getPhoenixApiConfig();
  const workspaceId = process.env.WORKSPACE_ID;

  console.log('Resolved api-config:', {
    mode: config.mode,
    baseUrl: config.baseUrl,
    devUserId: config.devUserId,
    defaultReportTemplateId: config.defaultReportTemplateId,
  });

  if (config.mode !== 'real-dev') {
    throw new Error(
      `This script only verifies real-dev mode (production-auth requires a browser/Clerk session — ` +
        `see this file's header). Got mode="${config.mode}".`
    );
  }

  if (!workspaceId) {
    throw new Error('Set WORKSPACE_ID to a real, seeded workspace id.');
  }

  if (!config.defaultReportTemplateId) {
    throw new Error('Set NEXT_PUBLIC_PHOENIX_DEFAULT_REPORT_TEMPLATE_ID (the exact env var RequestReportButton reads).');
  }

  // This is the EXACT call RequestReportButton.tsx makes on click —
  // same function, same arguments shape, same templateId source
  // (config.defaultReportTemplateId), no assetId (matching the
  // Workspace-scope template this is meant to be configured with).
  const created = await realCreateReportRequest(workspaceId, {
    templateId: config.defaultReportTemplateId,
  });

  console.log('SUCCESS — created report request:', created);

  if (created.status !== 'Requested') {
    throw new Error(`Expected status "Requested", got "${created.status}".`);
  }
  if (created.version !== 1) {
    throw new Error(`Expected version 1, got ${created.version}.`);
  }
  if (created.assetId !== null) {
    throw new Error(`Expected assetId null for a Workspace-scope template, got "${created.assetId}".`);
  }

  console.log('Verified: status="Requested", version=1, assetId=null. The configured frontend payload is valid.');
}

main().catch((err) => {
  console.error('FAILURE:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

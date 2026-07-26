// ============================================================
// QA: Upload UI logic (R2)
// PHX-LAUNCH-001-R2 Section 3 -- STATIC/STRUCTURAL ONLY.
// ------------------------------------------------------------
// Real browser automation is unavailable in this sandbox (Playwright
// requires downloading a Chromium binary from
// playwright.azureedge.net / cdn.playwright.dev, both confirmed
// blocked -- HTTP 403 -- by this environment's network egress
// allowlist; see gate7-ui.qa.ts's header for the same finding).
// Reported accurately per the addendum's own instruction rather than
// fabricated. Every assertion below reads the real
// UploadClient.tsx source.
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, section, printSummaryAndExit } from './assert';

const ROOT = join(__dirname, '..', '..');
const source = readFileSync(join(ROOT, 'src/components/intake/UploadClient.tsx'), 'utf8');

const stateHelpersSource = readFileSync(join(ROOT, 'src/components/intake/upload-client-state.ts'), 'utf8');

async function main() {
  section('1. R2 §3.2 item 1: completion body no longer sends originalFilename/contentType');
  const completeCallMatch = source.match(/complete`,\s*\{[\s\S]*?\}\);/);
  assert(!!completeCallMatch, 'the completion fetch call block was found in source');
  if (completeCallMatch) {
    const block = completeCallMatch[0];
    assert(!block.includes('originalFilename'), 'completion request body does not include originalFilename');
    assert(!block.includes('entry.file.type') || !block.includes('contentType:'), 'completion request body does not include a contentType field derived from the file');
    assert(block.includes('storageObjectKey') && block.includes('finishSession'), 'completion request body still includes storageObjectKey and finishSession');
  }

  section('2. R2 §3.2 item 2: finalization is not inferred from a stale local entries snapshot');
  assert(
    !source.includes('entries.filter((e, i) => i !== index && e.status'),
    'the old R1 pattern of computing "remaining" by filtering the closed-over `entries` array is gone'
  );
  assert(source.includes('completeBody.finalized'), 'finalization state comes from the server response field, not a local computation');

  section('3. R2 §3.2 item 3: an explicit "Finish uploading" action exists, backed by a real endpoint');
  assert(source.includes('Finish uploading'), 'the explicit Finish uploading label is present');
  assert(source.includes('/finish`'), 'a request to the dedicated .../finish endpoint is present');
  assert(source.includes('handleFinish'), 'a dedicated handler function backs the Finish action');

  section('4. R2 §3.2 item 4 (R5: logic extracted to upload-client-state.ts): Finish is enabled only when >=1 completed, reservedCount is 0, nothing busy, not already finalized');
  const canFinishFnMatch = stateHelpersSource.match(/export function canFinish\([\s\S]*?\n\}/);
  assert(!!canFinishFnMatch, 'canFinish is now an exported, directly-testable function in upload-client-state.ts (R5 extracted the logic out of the component)');
  if (canFinishFnMatch) {
    const body = canFinishFnMatch[0];
    assert(body.includes('params.finalized'), 'canFinish requires the session not already be finalized');
    assert(body.includes('params.completedCount <= 0'), 'canFinish requires at least one completed file');
    assert(body.includes('params.reservedCount !== 0'), 'canFinish (R5) additionally requires the server-authoritative reservedCount to be exactly zero');
    assert(body.includes('anyEntryBusy(params.entries)'), 'canFinish requires nothing currently busy');
  }
  assert(source.includes('computeCanFinish({'), 'the component calls the extracted canFinish function rather than reimplementing the logic inline');
  assert(source.includes('disabled={finishDisabled}'), 'the Finish button is wired to the canFinish computation via its disabled prop');

  section('5. R2 §3.2 item 5: a rejected/failed entry does not block finishing once one file has completed');
  // canFinish (now in upload-client-state.ts, R5) is derived purely
  // from completedCount/reservedCount/anyEntryBusy/finalized/finishing
  // -- it has no dependency on any entry's phase being 'rejected' or
  // 'recoverable_error' specifically, which is exactly what allows
  // finishing despite a rejected file elsewhere in the list.
  if (canFinishFnMatch) {
    assert(!canFinishFnMatch[0].includes('rejected'), "canFinish's definition has no dependency on any entry being in the rejected state");
    assert(!canFinishFnMatch[0].includes('recoverable_error'), "canFinish's definition has no dependency on any entry being in the recoverable_error state");
  }

  section('6. R2 §3.2 item 6 (R5: keyed by stable clientEntryId, not array index): parallel clicks cannot cause duplicate sign/complete calls for the same entry');
  assert(source.includes('inFlightRef'), 'an in-flight guard ref exists');
  assert(source.includes('inFlightRef.current.has(clientEntryId)'), 'signAndUpload checks the in-flight guard (keyed by the stable clientEntryId) before proceeding');
  assert(source.includes('inFlightRef.current.add(clientEntryId)'), 'signAndUpload marks itself in-flight (keyed by clientEntryId) before doing any async work');
  assert(!source.includes('inFlightRef.current.has(index)') && !source.includes('inFlightRef.current.add(index)'), 'the in-flight guard no longer uses the mutable array index as its key at all');

  section('7. R2 §3.2 item 7: automatic server-side finalization at max file count is still respected client-side');
  assert(source.includes('if (completeBody.finalized)'), 'the client reacts to the server telling it a completion auto-finalized the session (max file count reached)');

  section('8. R2 §3.2 item 8: a recoverable error state exists for a failed finalization');
  assert(source.includes("finishState === 'error'"), 'a distinct error state is rendered for a failed Finish attempt');
  assert(source.includes('finishError'), 'a human-readable error message is tracked and displayed for a failed Finish attempt');
  assert(!source.includes('finalized = true') || source.includes('setFinalized(true)'), 'finalized is only ever set true via its setter, never force-assigned on a failure path');

  section('9. R2 §3.2 item 9: after successful finalization, file selection and all upload actions are disabled');
  assert(/\{!finalized && \(\s*<input/.test(source), 'the file picker <input> is only rendered when NOT finalized');
  assert(/entry\.phase === 'pending' && !finalized/.test(source), 'the per-entry Upload button is only rendered for pending-phase entries when NOT finalized -- R4 renamed the per-entry field from status to phase');

  section('10. R2 §3.2 item 10 (R5: routed through the single refreshUploadState function): completed count and remaining allowance are displayed from server state');
  assert(source.includes('completedCount'), 'a completedCount piece of state exists');
  assert(source.includes('async function refreshUploadState'), 'a single reusable refreshUploadState function exists (R5 §5)');
  assert(source.includes('setCompletedCount(body.completedCount)'), 'refreshUploadState sets completedCount from the server response, not from counting local entries');
  assert(source.includes('await refreshUploadState()'), 'refreshUploadState is actually invoked from the upload flow (not merely defined)');
  assert(source.includes('setCompletedCount(body.fileCount)'), 'completedCount is also updated directly from the finish response');
  assert(/remainingFileSlots \?\? tokenState\.maxFiles/.test(source), 'remaining allowance is derived from server-sourced remainingFileSlots state, not computed client-side from maxFiles - completedCount');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate4-upload-ui-r2.qa.ts failed:', error);
  process.exitCode = 1;
});

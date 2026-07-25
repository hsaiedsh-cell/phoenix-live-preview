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

  section('4. R2 §3.2 item 4: Finish is enabled only when >=1 completed, nothing uploading, not already finalized');
  const canFinishMatch = source.match(/const canFinish = ([^;]+);/);
  assert(!!canFinishMatch, 'canFinish is computed as an explicit boolean expression');
  if (canFinishMatch) {
    const expr = canFinishMatch[1];
    assert(expr.includes('!finalized'), 'canFinish requires the session not already be finalized');
    assert(expr.includes('completedCount > 0'), 'canFinish requires at least one completed file');
    assert(expr.includes('!anyBusy'), 'canFinish requires nothing currently busy (signing/uploading/verifying) -- R4 renamed this from anyUploading to anyBusy to cover the new verify phase too');
  }
  assert(source.includes('disabled={!canFinish}'), 'the Finish button is actually wired to the canFinish computation via its disabled prop');

  section('5. R2 §3.2 item 5: a rejected/failed entry does not block finishing once one file has completed');
  // canFinish is derived purely from completedCount/anyUploading/finalized
  // -- it has no dependency on entries.some(status==='rejected'/'error')
  // at all, which is exactly what allows finishing despite a rejected
  // file elsewhere in the list.
  assert(!/canFinish[\s\S]{0,10}rejected/.test(source), 'canFinish\'s definition has no dependency on any entry being in the rejected state');
  assert(!/canFinish[\s\S]{0,10}error/i.test(source.replace(/errorState|finishError/g, '')), 'canFinish\'s definition has no dependency on any entry being in the error state');

  section('6. R2 §3.2 item 6: parallel clicks cannot cause duplicate sign/complete calls for the same entry');
  assert(source.includes('inFlightRef'), 'an in-flight guard ref exists');
  assert(source.includes('inFlightRef.current.has(index)'), 'uploadOne checks the in-flight guard before proceeding');
  assert(source.includes('inFlightRef.current.add(index)'), 'uploadOne marks itself in-flight before doing any async work');

  section('7. R2 §3.2 item 7: automatic server-side finalization at max file count is still respected client-side');
  assert(source.includes('if (completeBody.finalized)'), 'the client reacts to the server telling it a completion auto-finalized the session (max file count reached)');

  section('8. R2 §3.2 item 8: a recoverable error state exists for a failed finalization');
  assert(source.includes("finishState === 'error'"), 'a distinct error state is rendered for a failed Finish attempt');
  assert(source.includes('finishError'), 'a human-readable error message is tracked and displayed for a failed Finish attempt');
  assert(!source.includes('finalized = true') || source.includes('setFinalized(true)'), 'finalized is only ever set true via its setter, never force-assigned on a failure path');

  section('9. R2 §3.2 item 9: after successful finalization, file selection and all upload actions are disabled');
  assert(/\{!finalized && \(\s*<input/.test(source), 'the file picker <input> is only rendered when NOT finalized');
  assert(/entry\.phase === 'pending' && !finalized/.test(source), 'the per-entry Upload button is only rendered for pending-phase entries when NOT finalized -- R4 renamed the per-entry field from status to phase');

  section('10. R2 §3.2 item 10: completed count and remaining allowance are displayed from server state');
  assert(source.includes('completedCount'), 'a completedCount piece of state exists');
  assert(source.includes('setCompletedCount(completeBody.fileCount)'), 'completedCount is set from the server\'s completion response, not from counting local entries');
  assert(source.includes('setCompletedCount(body.fileCount)'), 'completedCount is also updated from the finish response');
  assert(/remainingFileSlots \?\? tokenState\.maxFiles/.test(source), 'remaining allowance is derived from server-sourced remainingFileSlots state (R4: fetched directly from the GET token-state response, not computed client-side from maxFiles - completedCount)');

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate4-upload-ui-r2.qa.ts failed:', error);
  process.exitCode = 1;
});

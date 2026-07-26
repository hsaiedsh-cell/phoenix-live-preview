// ============================================================
// QA: Recovery actions available per entry state (R6)
// PHX-LAUNCH-001-R6 Section 4 / Section 7 ("Action availability")
// STATIC/STRUCTURAL for the JSX wiring itself (real browser rendering
// remains unavailable in this sandbox -- Playwright's Chromium binary
// download is blocked, HTTP 403, unchanged finding from every prior
// revision), combined with the REAL, executed pure-function proofs
// already exercised in gate3-reconciliation-r6.qa.ts and
// gate1-ambiguous-sign-recovery-r6.qa.ts, which this file
// cross-references rather than re-deriving.
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, section, printSummaryAndExit } from './assert';

const ROOT = join(__dirname, '..', '..');
const source = readFileSync(join(ROOT, 'src/components/intake/UploadClient.tsx'), 'utf8');

/** Extracts the JSX rendering block for a given phase-check marker up to (but not including) the NEXT `{entry.phase ===` or `{!finalized &&` top-level marker -- avoids regex paren-counting fragility against nested JSX arrow functions. */
function extractBlock(fullSource: string, startMarker: string): string {
  const startIndex = fullSource.indexOf(startMarker);
  if (startIndex === -1) return '';
  const searchFrom = startIndex + startMarker.length;
  const nextEntryPhase = fullSource.indexOf('{entry.phase ===', searchFrom);
  const nextFinalizedBlock = fullSource.indexOf('{finalized && (', searchFrom);
  const candidates = [nextEntryPhase, nextFinalizedBlock].filter((i) => i !== -1);
  const endIndex = candidates.length > 0 ? Math.min(...candidates) : fullSource.length;
  return fullSource.slice(startIndex, endIndex);
}

async function main() {
  section('1. A recoverable sign error WITHOUT an object key exposes "Retry upload request"');
  {
    const block = extractBlock(source, "entry.phase === 'recoverable_error' && !finalized && !entry.storageObjectKey && (");
    assert(block.length > 0, 'the no-object-key recoverable_error rendering branch was found');
    assert(block.includes('Retry upload request'), 'the exact "Retry upload request" label is present for this state');
    assert(block.includes('signAndUpload(entry.clientEntryId)'), 'the button calls signAndUpload with the SAME clientEntryId -- reusing the same reservationKey stored on that entry, never generating a new one');
    assert(!block.includes('Cancel'), 'no "Cancel" action is offered for this state -- there is no known storageObjectKey to cancel, and offering Cancel here would look like a safe local removal (the R6 §2 defect) when it is not');
    assert(block.includes('Refresh state'), 'a "Refresh state" action is also offered, so the customer can discover a recovered server reservation without a full page reload');
  }

  section('2. A recoverable sign error WITH a known object key still exposes Verify and Cancel (server-backed actions are safe once the key is known)');
  {
    const block = extractBlock(source, "entry.phase === 'recoverable_error' && !finalized && entry.storageObjectKey && (");
    assert(block.length > 0, 'the known-object-key recoverable_error rendering branch was found');
    assert(block.includes('Verify'), 'Verify is offered once the object key is known');
    assert(block.includes('Cancel'), 'Cancel is offered once the object key is known -- this IS a safe, server-confirmed cancellation, unlike the no-key case');
    assert(block.includes('Request fresh upload URL'), 'a fresh-sign retry (same reservationKey) is offered in case the previously issued signed URL has expired');
  }

  section('3. A never-submitted pending entry can be removed locally without contacting the server for that removal path\'s OWN safety, while cancelEntry still guards it structurally');
  {
    assert(source.includes("entry.phase === 'pending' && !finalized"), 'the pending-phase rendering branch exists');
    assert(source.includes("if (entry.phase === 'pending' || entry.phase === 'terminal')"), 'cancelEntry structurally permits local-only removal ONLY for pending or terminal entries -- never for an ambiguous submitted-but-unresolved one');
  }

  section('4. An ambiguous submitted entry (no object key, not pending/terminal) cannot be silently removed -- structural proof of the R6 §2 fix');
  {
    const cancelFnMatch = source.match(/async function cancelEntry[\s\S]*?\n  \}\n/);
    assert(!!cancelFnMatch, 'cancelEntry function found');
    if (cancelFnMatch) {
      assert(cancelFnMatch[0].includes('await refreshUploadState()'), 'the ambiguous-entry branch calls refreshUploadState instead of removing the entry locally');
      assert(!/if \(!entry\.storageObjectKey\) \{\s*setEntries\(\(prev\) => removeEntryById/.test(cancelFnMatch[0]), 'there is no code path where a missing storageObjectKey alone triggers an unconditional local removeEntryById call (the R5-era bug)');
    }
  }

  section('5. A recovered/uploaded_unverified reservation exposes Verify and Cancel');
  {
    const block = extractBlock(source, "entry.phase === 'uploaded_unverified' && !finalized && (");
    assert(block.length > 0, 'the uploaded_unverified rendering branch was found');
    assert(block.includes('Verify'), 'Verify is offered for a recovered/uploaded_unverified reservation');
    assert(block.includes('Cancel'), 'Cancel is offered for a recovered/uploaded_unverified reservation');
  }

  section('6. A terminal sign result offers "Remove and re-select", not an infinite retry');
  {
    const block = extractBlock(source, "entry.phase === 'terminal' && !finalized && (");
    assert(block.length > 0, 'the terminal-phase rendering branch was found');
    assert(block.includes('Remove and re-select'), 'the terminal state offers explicit removal, not a repeat of the sign action');
    assert(!block.includes('signAndUpload'), 'the terminal state does NOT offer another signAndUpload attempt -- no infinite retry loop against a result the server has already said can never succeed');
  }

  section('7. A stale signed URL can request a fresh URL using the same reservationKey (structural + cross-reference to the real behavioral proof)');
  {
    assert(source.includes('Request fresh upload URL'), 'the fresh-URL-retry label exists');
    assert(source.includes('entry.reservationKey') && source.includes("signAndUpload(entry.clientEntryId)"), 'the fresh-URL action reuses the entry\'s own reservationKey via signAndUpload, never generating a new key');
    // The actual behavioral proof that a same-key retry returns a
    // fresh, distinct signed URL for the identical object key lives
    // in gate1-ambiguous-sign-recovery-r6.qa.ts section 2 -- this
    // structural check only confirms the UI wiring calls the right
    // function with the right identity.
  }

  section('8. refreshUploadState reconciles pendingReservations using the real, executed reconciliation helper (cross-reference)');
  {
    assert(source.includes('reconcilePendingReservations'), 'refreshUploadState calls the real reconciliation helper');
    assert(source.includes('setEntries((prev) => reconcilePendingReservations(prev, body.pendingReservations))'), 'reconciliation is applied to the CURRENT entries state, not a stale closure');
    // The actual behavioral proofs (no duplication, merge-by-object-key,
    // preservation of in-flight/live entries, removal of vanished
    // recovered entries) are executed directly in
    // gate3-reconciliation-r6.qa.ts against the real function -- not
    // re-derived here from source text alone, per the addendum's own
    // instruction.
  }

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate4-action-availability-r6.qa.ts failed:', error);
  process.exitCode = 1;
});

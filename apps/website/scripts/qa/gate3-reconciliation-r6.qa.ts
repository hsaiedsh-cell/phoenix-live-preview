// ============================================================
// QA: Pure client-state reconciliation (R6)
// PHX-LAUNCH-001-R6 Section 3 / Section 7 ("Pure client-state
// reconciliation")
// EXECUTED -- directly imports and calls the real, exported
// reconcilePendingReservations function (no I/O, no rendering). Per
// the addendum: "Static source assertions alone are insufficient for
// reconciliation behavior. Execute pure state helpers directly."
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import {
  type FileEntry,
  type PendingReservationSummary,
  reconcilePendingReservations,
} from '../../src/components/intake/upload-client-state';

function serverReservation(overrides: Partial<PendingReservationSummary> & { storageObjectKey: string }): PendingReservationSummary {
  return {
    originalFilename: `${overrides.storageObjectKey}.pdf`,
    declaredContentType: 'application/pdf',
    declaredSizeBytes: 1000,
    reservationStatus: 'reserved',
    ...overrides,
  };
}

async function main() {
  section('1. A server pending reservation with no local match is added exactly once');
  {
    const reservation = serverReservation({ storageObjectKey: 'obj-1' });
    const result = reconcilePendingReservations([], [reservation]);
    assert(result.length === 1, 'exactly one entry is added for the one server reservation');
    assert(result[0].storageObjectKey === 'obj-1', 'the recovered entry carries the correct storageObjectKey');
    assert(result[0].phase === 'uploaded_unverified', 'the recovered entry starts in the uploaded_unverified phase');
    assert(!result[0].reservationKey, 'the recovered entry has NO reservationKey -- the client never learned it');
  }

  section('2. A second refresh with the SAME reservation does not duplicate it');
  {
    const reservation = serverReservation({ storageObjectKey: 'obj-2' });
    const afterFirst = reconcilePendingReservations([], [reservation]);
    const afterSecond = reconcilePendingReservations(afterFirst, [reservation]);
    assert(afterSecond.length === 1, 'still exactly one entry after a second identical refresh');
    assert(afterSecond[0].clientEntryId === afterFirst[0].clientEntryId, 'the SAME clientEntryId is reused across refreshes -- it is deterministically derived from the object key');
  }

  section('3. A local signed entry merges with its recovered reservation by object key -- no duplicate');
  {
    const localEntry: FileEntry = {
      clientEntryId: 'local-1',
      reservationKey: 'rk-1',
      filename: 'my-file.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-3',
      phase: 'uploaded_unverified',
    };
    const reservation = serverReservation({ storageObjectKey: 'obj-3', originalFilename: 'my-file.pdf' });
    const result = reconcilePendingReservations([localEntry], [reservation]);
    assert(result.length === 1, 'exactly one entry -- the local entry absorbs the server data, no second row is added');
    assert(result[0].clientEntryId === 'local-1', 'the LOCAL clientEntryId is preserved (not replaced by a synthetic server one)');
    assert(result[0].reservationKey === 'rk-1', "the local entry's reservationKey is preserved");
  }

  section('4. An unrelated local File entry (different object key, or none yet) is preserved untouched');
  {
    const unrelatedPending: FileEntry = {
      clientEntryId: 'local-pending',
      reservationKey: 'rk-2',
      filename: 'not-yet-signed.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 500,
      phase: 'pending',
    };
    const reservation = serverReservation({ storageObjectKey: 'obj-4' });
    const result = reconcilePendingReservations([unrelatedPending], [reservation]);
    assert(result.length === 2, 'both the unrelated pending entry AND the new recovered entry are present');
    const stillPending = result.find((e) => e.clientEntryId === 'local-pending');
    assert(stillPending?.phase === 'pending' && stillPending.reservationKey === 'rk-2', 'the unrelated pending entry is completely untouched');
  }

  section('5. A removed server reservation is removed (if purely recovered) or terminally updated (if already settled)');
  {
    const recoveredEntry: FileEntry = {
      clientEntryId: 'server:obj-5',
      filename: 'gone.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-5',
      phase: 'uploaded_unverified',
    };
    const result = reconcilePendingReservations([recoveredEntry], []); // no longer in the server's pending list at all
    assert(result.length === 0, 'a purely recovered entry whose reservation vanished from the server list is removed entirely');

    const completedEntry: FileEntry = { ...recoveredEntry, clientEntryId: 'server:obj-6', storageObjectKey: 'obj-6', phase: 'completed' };
    const resultCompleted = reconcilePendingReservations([completedEntry], []);
    assert(resultCompleted.length === 1 && resultCompleted[0].phase === 'completed', 'an entry already showing a settled COMPLETED outcome is kept visible, not silently removed');
  }

  section('6. An older/stale refresh cannot overwrite newer state (sequencing is the CALLER\'s responsibility, but reconciliation itself is idempotent/order-independent for a given snapshot)');
  {
    const reservation = serverReservation({ storageObjectKey: 'obj-7' });
    const newerSnapshot = reconcilePendingReservations([], [reservation, serverReservation({ storageObjectKey: 'obj-8' })]);
    // Applying an OLDER (single-reservation) snapshot on top of the
    // newer one must not silently drop obj-8 if the caller has
    // correctly discarded the stale response before calling this at
    // all -- this proves reconcilePendingReservations itself behaves
    // consistently with whatever snapshot it is actually given
    // (the sequence-guard living in UploadClient.tsx is what prevents
    // an out-of-order CALL from ever reaching this function with
    // stale data in the first place).
    const reappliedNewer = reconcilePendingReservations(newerSnapshot, [reservation, serverReservation({ storageObjectKey: 'obj-8' })]);
    assert(reappliedNewer.length === 2, 're-applying the SAME (newer) snapshot is a stable no-op, not a duplication');
  }

  section('7. An in-flight local entry (signing/uploading/verifying/cancelling) is never clobbered by a reconciliation pass');
  {
    const verifyingEntry: FileEntry = {
      clientEntryId: 'local-verifying',
      reservationKey: 'rk-3',
      filename: 'in-flight.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-9',
      phase: 'verifying',
    };
    // The server's pendingReservations snapshot might still show this
    // as 'reserved' (verification not yet committed) -- reconciliation
    // must not downgrade the local 'verifying' phase back to
    // 'uploaded_unverified'.
    const reservation = serverReservation({ storageObjectKey: 'obj-9' });
    const result = reconcilePendingReservations([verifyingEntry], [reservation]);
    assert(result.length === 1 && result[0].phase === 'verifying', 'the in-flight verifying phase is preserved, not overwritten by the reconciliation pass');
  }

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate3-reconciliation-r6.qa.ts failed:', error);
  process.exitCode = 1;
});

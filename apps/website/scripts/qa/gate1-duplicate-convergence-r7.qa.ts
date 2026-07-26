// ============================================================
// QA: Duplicate client entry convergence for one reservation (R7)
// PHX-LAUNCH-001-R7 Section 1 / Section 7 ("Duplicate convergence")
// EXECUTED -- directly imports and calls the real, exported
// collapseDuplicatesByObjectKey and reconcilePendingReservations
// functions (no I/O, no rendering).
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import {
  type FileEntry,
  type PendingReservationSummary,
  collapseDuplicatesByObjectKey,
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
  section('1. Two local entries sharing one object key collapse to one');
  {
    const localEntry: FileEntry = {
      clientEntryId: 'local-1',
      reservationKey: 'rk-1',
      file: new File(['x'], 'f.pdf'),
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-1',
      phase: 'recoverable_error',
      message: 'ambiguous',
    };
    const recoveredEntry: FileEntry = {
      clientEntryId: 'server:obj-1',
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-1',
      phase: 'uploaded_unverified',
    };
    const result = collapseDuplicatesByObjectKey([localEntry, recoveredEntry]);
    assert(result.length === 1, 'exactly one entry remains for the one shared object key');
  }

  section('2. The local File/reservationKey entry wins identity over the synthetic recovered entry');
  {
    const localEntry: FileEntry = {
      clientEntryId: 'local-2',
      reservationKey: 'rk-2',
      file: new File(['x'], 'f.pdf'),
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-2',
      phase: 'recoverable_error',
    };
    const recoveredEntry: FileEntry = {
      clientEntryId: 'server:obj-2',
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-2',
      phase: 'uploaded_unverified',
    };
    const result = collapseDuplicatesByObjectKey([recoveredEntry, localEntry]); // order-independent -- recovered listed FIRST here
    assert(result.length === 1, 'collapses to one');
    assert(result[0].clientEntryId === 'local-2', 'the LOCAL entry keeps its own clientEntryId, not the synthetic server one');
    assert(result[0].reservationKey === 'rk-2', 'the local reservationKey is preserved');
    assert(!!result[0].file, 'the local File object is preserved');
  }

  section('3. The synthetic recovered entry is removed (not merely hidden) once collapsed');
  {
    const localEntry: FileEntry = {
      clientEntryId: 'local-3',
      reservationKey: 'rk-3',
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-3',
      phase: 'uploaded_unverified',
    };
    const recoveredEntry: FileEntry = {
      clientEntryId: 'server:obj-3',
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-3',
      phase: 'uploaded_unverified',
    };
    const result = collapseDuplicatesByObjectKey([localEntry, recoveredEntry]);
    assert(!result.some((e) => e.clientEntryId === 'server:obj-3'), 'the synthetic recovered entry with its own identity is gone entirely, not just deprioritized');
  }

  section('4. Repeated reconciliation (which now includes the collapse pass) is idempotent -- stays at one entry');
  {
    const localEntry: FileEntry = {
      clientEntryId: 'local-4',
      reservationKey: 'rk-4',
      file: new File(['x'], 'f.pdf'),
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-4',
      phase: 'recoverable_error',
    };
    const reservation = serverReservation({ storageObjectKey: 'obj-4', originalFilename: 'f.pdf' });
    const afterFirst = reconcilePendingReservations([localEntry], [reservation]);
    assert(afterFirst.length === 1, 'one entry after the first reconciliation (no synthetic duplicate was ever added, since the local entry already carried the object key)');
    const afterSecond = reconcilePendingReservations(afterFirst, [reservation]);
    assert(afterSecond.length === 1, 'still one entry after a second identical reconciliation pass');
    assert(afterSecond[0].clientEntryId === 'local-4', 'the local identity survives repeated reconciliation');
  }

  section('5. One reservation cannot expose two concurrent action identities: after collapse, only one clientEntryId targets the object key');
  {
    const localEntry: FileEntry = {
      clientEntryId: 'local-5',
      reservationKey: 'rk-5',
      file: new File(['x'], 'f.pdf'),
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-5',
      phase: 'recoverable_error',
    };
    const recoveredEntry: FileEntry = {
      clientEntryId: 'server:obj-5',
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-5',
      phase: 'uploaded_unverified',
    };
    const result = collapseDuplicatesByObjectKey([localEntry, recoveredEntry]);
    const idsTargetingThisKey = result.filter((e) => e.storageObjectKey === 'obj-5').map((e) => e.clientEntryId);
    assert(idsTargetingThisKey.length === 1, `exactly one clientEntryId targets object key obj-5 after collapse (got ${idsTargetingThisKey.length}) -- a UI wired to clientEntryId can never fire two independent Verify/Cancel/Retry actions against the same server reservation`);
  }

  section('6. An in-flight duplicate is not downgraded by the collapse (busy phase wins over a merely-recovered placeholder)');
  {
    const busyLocal: FileEntry = {
      clientEntryId: 'local-6',
      reservationKey: 'rk-6',
      file: new File(['x'], 'f.pdf'),
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-6',
      phase: 'verifying',
    };
    const recoveredEntry: FileEntry = {
      clientEntryId: 'server:obj-6',
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-6',
      phase: 'uploaded_unverified',
    };
    const result = collapseDuplicatesByObjectKey([busyLocal, recoveredEntry]);
    assert(result.length === 1 && result[0].phase === 'verifying', 'the merged entry keeps the in-flight verifying phase, not the recovered placeholder phase');
  }

  section('7. A completed duplicate wins the merged phase even if the surviving identity itself is not the one marked completed');
  {
    // Realistic scenario: the synthetic recovered entry happened to
    // be the one a background re-verify (R7 §5) marked 'completed',
    // while the LOCAL entry (still the identity winner, since it has
    // File+reservationKey) is stuck at 'recoverable_error' locally.
    const localEntry: FileEntry = {
      clientEntryId: 'local-7',
      reservationKey: 'rk-7',
      file: new File(['x'], 'f.pdf'),
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-7',
      phase: 'recoverable_error',
    };
    const completedRecovered: FileEntry = {
      clientEntryId: 'server:obj-7',
      filename: 'f.pdf',
      declaredContentType: 'application/pdf',
      declaredSizeBytes: 1000,
      storageObjectKey: 'obj-7',
      phase: 'completed',
    };
    const result = collapseDuplicatesByObjectKey([localEntry, completedRecovered]);
    assert(result.length === 1, 'collapses to one');
    assert(result[0].clientEntryId === 'local-7', 'the local entry still keeps its own identity');
    assert(result[0].phase === 'completed', "but the merged phase reflects 'completed' -- the most advanced, safest outcome across the group, not the identity-winner's own stale phase");
  }

  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate1-duplicate-convergence-r7.qa.ts failed:', error);
  process.exitCode = 1;
});

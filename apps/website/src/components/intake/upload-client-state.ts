// ============================================================
// Pure, framework-agnostic state helpers for the upload client
// PHX-LAUNCH-001-R5 §4
// ------------------------------------------------------------
// Extracted out of UploadClient.tsx specifically so QA can import and
// EXECUTE these functions directly (not merely grep the component
// source) -- the addendum is explicit that "a static source-string
// assertion alone is insufficient" for proving stable-identity
// behavior under concurrency.
//
// Every entry carries a stable, client-generated clientEntryId,
// assigned once at creation and never recomputed. Every helper below
// operates on that id -- never a mutable array index -- so removing
// or reordering one entry while another asynchronous action is still
// in flight for a DIFFERENT entry can never cause that in-flight
// action to update the wrong entry (or silently no-op against a
// since-shifted index).
// ============================================================

export type EntryPhase =
  | 'pending'
  | 'signing'
  | 'signed'
  | 'uploading'
  | 'uploaded_unverified'
  | 'verifying'
  | 'completed'
  | 'rejected'
  | 'recoverable_error'
  | 'terminal'
  | 'cancelling'
  | 'cancelled';

export interface FileEntry {
  /** Stable client-generated identity -- the ONLY thing ever used to target an entry for an asynchronous action, a React key, or an in-flight guard. Never the array index. */
  clientEntryId: string;
  /**
   * Client-generated once at entry creation, reused verbatim for
   * every sign retry of this entry (R5 §6). Absent for a "recovered"
   * entry added purely from a server pendingReservations refresh (R6
   * §3) -- the client never learns the original reservationKey for a
   * reservation it didn't itself create in this session, only its
   * storageObjectKey and declared metadata; such an entry can be
   * Verified or Cancelled, but never re-signed (there is no key left
   * to retry with).
   */
  reservationKey?: string;
  /** Only present for a live, same-session file selection -- a reservation recovered from a page reload has no File object to re-PUT. */
  file?: File;
  filename: string;
  declaredContentType: string;
  declaredSizeBytes: number;
  storageObjectKey?: string;
  signedUploadUrl?: string;
  phase: EntryPhase;
  message?: string;
}

/** Mirrors intake-files.repository.ts's PendingReservationSummary (server response shape) -- never includes the reservation-key hash or any database UUID. */
export interface PendingReservationSummary {
  storageObjectKey: string;
  originalFilename: string;
  declaredContentType: string;
  declaredSizeBytes: number;
  reservationStatus: 'reserved';
}

/**
 * R6 (§3): reconciles the server's authoritative pendingReservations
 * list into the local entry array, keyed EXCLUSIVELY by
 * storageObjectKey (the addendum's own required stable server
 * identity) -- never by filename or any other guessable/ambiguous
 * field. Pure, dependency-free (no injected id generator): a
 * recovered entry's clientEntryId is deterministically derived from
 * its storageObjectKey (`server:${storageObjectKey}`), which is
 * itself already server-generated and unique, so repeated calls with
 * the same server state never produce a new id for the same
 * reservation -- this is what makes rule 1 ("do not duplicate the
 * same server reservation after repeated refreshes") hold by
 * construction, not by chance.
 *
 * Rules implemented (R6 §3):
 *  1. No duplication across repeated refreshes (see above).
 *  2. Live local File objects and in-flight phases (signing/
 *     uploading/verifying/cancelling) are never overwritten by a
 *     reconciliation pass -- an in-flight action always wins.
 *  3. A server reservation with no local match at all becomes a new
 *     recovered entry, phase 'uploaded_unverified'.
 *  4. A local entry that already has this storageObjectKey (it was
 *     signed locally, or was already recovered on a prior pass) is
 *     updated in place -- never duplicated.
 *  5. A previously-recovered (no File, no active local sign relationship)
 *     entry whose reservation no longer appears in pendingReservations
 *     is removed, UNLESS it is already displaying a terminal outcome
 *     (completed/cancelled) worth keeping visible, or still has a live
 *     File/in-flight phase of its own (in which case something else
 *     -- e.g. a just-in-flight verify -- is actively handling it and
 *     removal would be premature).
 *  6. Never touches or requires the server-side reservation-key hash
 *     -- entirely out of scope for this pure function.
 */
export function reconcilePendingReservations(entries: FileEntry[], pendingReservations: PendingReservationSummary[]): FileEntry[] {
  const pendingByKey = new Map(pendingReservations.map((r) => [r.storageObjectKey, r]));

  const merged = entries.map((entry) => {
    if (!entry.storageObjectKey) return entry;
    const match = pendingByKey.get(entry.storageObjectKey);
    if (!match) return entry; // handled by the removal pass below
    if (isEntryBusy(entry)) return entry; // rule 2: never clobber an in-flight entry
    if (entry.phase === 'completed' || entry.phase === 'cancelled' || entry.phase === 'terminal') return entry; // already a settled local outcome -- a stale 'reserved' server read must not un-settle it
    return {
      ...entry,
      filename: match.originalFilename,
      declaredContentType: match.declaredContentType,
      declaredSizeBytes: match.declaredSizeBytes,
      phase: 'uploaded_unverified' as const,
    };
  });

  const representedKeys = new Set(merged.filter((e) => e.storageObjectKey).map((e) => e.storageObjectKey as string));
  const recovered: FileEntry[] = pendingReservations
    .filter((r) => !representedKeys.has(r.storageObjectKey))
    .map((r) => ({
      clientEntryId: `server:${r.storageObjectKey}`,
      filename: r.originalFilename,
      declaredContentType: r.declaredContentType,
      declaredSizeBytes: r.declaredSizeBytes,
      storageObjectKey: r.storageObjectKey,
      phase: 'uploaded_unverified' as const,
    }));

  const withRecovered = [...merged, ...recovered];

  return withRecovered.filter((entry) => {
    if (!entry.storageObjectKey) return true; // never signed (or ambiguous/lost response) -- not this reconciliation's concern
    if (pendingByKey.has(entry.storageObjectKey)) return true; // still genuinely pending
    if (entry.file || isEntryBusy(entry)) return true; // a live local relationship or in-flight action is still handling this entry
    if (entry.phase === 'completed' || entry.phase === 'cancelled' || entry.phase === 'terminal') return true; // keep a settled outcome visible
    // rule 5: a purely recovered entry whose reservation has vanished
    // from the server's pending list (completed/cancelled/expired via
    // some other path) and has no local claim on it at all -- remove.
    return false;
  });
}
export function updateEntryById(entries: FileEntry[], clientEntryId: string, patch: Partial<FileEntry>): FileEntry[] {
  return entries.map((entry) => (entry.clientEntryId === clientEntryId ? { ...entry, ...patch } : entry));
}

export function removeEntryById(entries: FileEntry[], clientEntryId: string): FileEntry[] {
  return entries.filter((entry) => entry.clientEntryId !== clientEntryId);
}

export function findEntryById(entries: FileEntry[], clientEntryId: string): FileEntry | undefined {
  return entries.find((entry) => entry.clientEntryId === clientEntryId);
}

/** The set of phases that count as "busy" for disabling Finish and blocking a duplicate action against the SAME entry. */
const BUSY_PHASES: ReadonlySet<EntryPhase> = new Set<EntryPhase>(['signing', 'uploading', 'verifying', 'cancelling']);

export function isEntryBusy(entry: FileEntry): boolean {
  return BUSY_PHASES.has(entry.phase);
}

export function anyEntryBusy(entries: FileEntry[]): boolean {
  return entries.some(isEntryBusy);
}

/**
 * R5 (§3 UI + §4): the authoritative "can Finish" computation --
 * requires at least one completed file, the SERVER-reported
 * reservedCount to be exactly zero (not merely "no entry looks busy
 * locally" -- a recovered uploaded_unverified/recoverable_error entry
 * is not busy but IS still reserved server-side), and no entry
 * currently busy (including the new 'cancelling' phase, so an
 * in-flight cancel blocks Finish exactly like an in-flight
 * sign/upload/verify does).
 */
export function canFinish(params: { completedCount: number; reservedCount: number; entries: FileEntry[]; finalized: boolean; finishing: boolean }): boolean {
  if (params.finalized || params.finishing) return false;
  if (params.completedCount <= 0) return false;
  if (params.reservedCount !== 0) return false;
  if (anyEntryBusy(params.entries)) return false;
  return true;
}

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
  | 'cancelling'
  | 'cancelled';

export interface FileEntry {
  /** Stable client-generated identity -- the ONLY thing ever used to target an entry for an asynchronous action, a React key, or an in-flight guard. Never the array index. */
  clientEntryId: string;
  /** Client-generated once at entry creation, reused verbatim for every sign retry of this entry (R5 §6). */
  reservationKey: string;
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

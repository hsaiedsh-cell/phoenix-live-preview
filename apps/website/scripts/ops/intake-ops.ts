// ============================================================
// Phoenix Website — Intake Operations CLI
// PHX-LAUNCH-001 (R1: PHX-LAUNCH-001-R1 §5)
// ------------------------------------------------------------
// Manual CLI for Private Beta operations. Talks directly to the
// repositories/services (not over HTTP), so it works whether or not
// the Next.js server is running, and is the intended caller of the
// internal-only finalize/upload-session HTTP routes' underlying
// logic (this CLI is a superset -- it can also list and inspect).
//
// R1: `find` (and `list`) now print a REDACTED safe summary by
// default -- never the customer message, email, phone, raw/hashed
// IP, idempotency hash, upload token hash, storage object key, or
// original filename. Pass --show-sensitive to `find` to see the
// full row, which prints a loud terminal warning first.
//
// Never prints the raw upload token after initial issuance: the
// invite command constructs and sends the /upload/<token> URL by
// email only. The raw token is not retrievable from storage at all
// (only a hash is persisted) -- not even --show-sensitive can print
// it, because it was never stored.
//
// Usage:
//   npx tsx scripts/ops/intake-ops.ts list
//   npx tsx scripts/ops/intake-ops.ts find <publicReference> [--show-sensitive]
//   npx tsx scripts/ops/intake-ops.ts review <publicReference>
//   npx tsx scripts/ops/intake-ops.ts invite-upload <publicReference>
//   npx tsx scripts/ops/intake-ops.ts revoke-upload <publicReference>
//   npx tsx scripts/ops/intake-ops.ts reject <publicReference>
//   npx tsx scripts/ops/intake-ops.ts quote <publicReference>
//   npx tsx scripts/ops/intake-ops.ts accept <publicReference>
//   npx tsx scripts/ops/intake-ops.ts close <publicReference>
//   npx tsx scripts/ops/intake-ops.ts cleanup [--dry-run|--apply]
// ============================================================

import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import * as intakeFilesRepo from '../../src/lib/intake/repositories/intake-files.repository';
import { finalizeIntakeRequest, type FinalizeAction } from '../../src/lib/intake/finalize.service';
import { issueUploadSession, revokeUploadSession } from '../../src/lib/intake/upload-session.service';
import { getStorageAdapter } from '../../src/lib/intake/adapters';
import { recordEvent } from '../../src/lib/intake/repositories/intake-events.repository';
import { fileURLToPath } from 'node:url';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

/**
 * R1 (§5): the ONLY fields the default `find`/`list` output may
 * contain. This type has no field for message/email/phone/IP
 * hash/idempotency hash/token hash/object key/filename -- adding one
 * of those to a caller would be a TypeScript error, not just a
 * convention, since buildSafeSummary below is the sole place that
 * constructs this type from a full row.
 */
export interface SafeRequestSummary {
  publicReference: string;
  status: string;
  requestType: string;
  company: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  uploadSessionStatus: string | null;
}

export async function buildSafeSummary(row: intakeRequestsRepo.IntakeRequestRow): Promise<SafeRequestSummary> {
  const session = await uploadSessionsRepo.findActiveSessionForRequest(row.id);
  const filesForSession = session ? await intakeFilesRepo.listFilesForSession(session.id) : [];
  return {
    publicReference: row.public_reference,
    status: row.status,
    requestType: row.request_type,
    company: row.company,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    fileCount: filesForSession.length,
    uploadSessionStatus: session?.status ?? null,
  };
}

async function cmdList(): Promise<void> {
  const rows = await intakeRequestsRepo.listRequests(50);
  for (const row of rows) {
    log(`${row.public_reference}  ${row.status.padEnd(15)}  ${row.request_type.padEnd(10)}  ${row.company}`);
  }
  log(`\n${rows.length} request(s). (safe summary only -- use "find <reference>" for more, or "find <reference> --show-sensitive" for the full record)`);
}

async function requireRequest(publicReference: string) {
  const row = await intakeRequestsRepo.findByPublicReference(publicReference);
  if (!row) {
    log(`No request found with reference ${publicReference}.`);
    process.exitCode = 1;
    return null;
  }
  return row;
}

async function cmdFind(publicReference: string, showSensitive: boolean): Promise<void> {
  const row = await requireRequest(publicReference);
  if (!row) return;

  if (!showSensitive) {
    const summary = await buildSafeSummary(row);
    log(JSON.stringify(summary, null, 2));
    return;
  }

  log('');
  log('!!! SENSITIVE VIEW -- includes customer message, email, phone, and internal hashes. !!!');
  log('!!! Handle this output per the Operations Runbook; do not paste it into chat/tickets. !!!');
  log('');
  log(JSON.stringify(row, null, 2));
}

async function cmdFinalize(publicReference: string, action: FinalizeAction): Promise<void> {
  const row = await requireRequest(publicReference);
  if (!row) return;
  const outcome = await finalizeIntakeRequest(row.id, action);
  log(JSON.stringify(outcome, null, 2));
}

async function cmdInviteUpload(publicReference: string): Promise<void> {
  const row = await requireRequest(publicReference);
  if (!row) return;
  const outcome = await issueUploadSession(row.id);
  // Deliberately never logs the raw token -- only the outcome
  // metadata (expiry, whether the email send succeeded).
  log(JSON.stringify(outcome, null, 2));
}

async function cmdRevokeUpload(publicReference: string): Promise<void> {
  const row = await requireRequest(publicReference);
  if (!row) return;
  const outcome = await revokeUploadSession(row.id);
  log(JSON.stringify(outcome, null, 2));
}

async function cmdCleanup(apply: boolean): Promise<void> {
  const staleSessions = await uploadSessionsRepo.expireStaleSessions(!apply);
  log(`${apply ? 'Expired' : 'Would expire'} ${staleSessions.length} stale upload session(s).`);
  for (const session of staleSessions) {
    log(`  session ${session.id} for request ${session.request_id}`);
  }

  const orphans = await intakeFilesRepo.findOrphanReservations();
  log(`\n${orphans.length} orphaned file reservation(s) found (expired-still-reserved or failed).`);
  // R2 (§4.2 item 7): only counts and reservation/session IDs in
  // normal CLI output -- never the original filename or storage
  // object key.
  for (const orphan of orphans) {
    log(`  ${orphan.reason}  reservation ${orphan.id}  session ${orphan.upload_session_id}`);
  }

  if (!apply) {
    log('\nDry run only -- no provider objects were deleted and no rows were changed. Re-run with --apply to perform the update.');
    return;
  }

  let deleted = 0;
  let retriable = 0;
  const storage = getStorageAdapter();
  for (const orphan of orphans) {
    // R2 (§4.2 items 1-5): never delete a completed file (orphans by
    // definition are 'reserved' or 'failed', never 'completed' --
    // see findOrphanReservations); attempt provider deletion first;
    // "not found" is treated as idempotent success by the adapter
    // itself; only mark the row expired after that success; leave a
    // failed deletion retriable (row untouched, will be found again
    // by the next cleanup run).
    const result = await storage.deleteObject(orphan.storage_object_key);
    if (result.success) {
      await intakeFilesRepo.markReservationExpired(orphan.id);
      await recordEvent(orphan.request_id, 'upload.orphan_object_deleted');
      deleted += 1;
    } else {
      await recordEvent(orphan.request_id, 'upload.orphan_object_delete_failed');
      retriable += 1;
    }
  }
  log(`Deleted ${deleted} orphaned provider object(s) and marked their reservation(s) expired.`);
  if (retriable > 0) {
    log(`${retriable} deletion(s) failed and remain retriable -- re-run cleanup --apply later to retry them.`);
  }
}

async function main(): Promise<void> {
  const [, , command, arg1, arg2] = process.argv;

  switch (command) {
    case 'list':
      return cmdList();
    case 'find':
      return cmdFind(arg1, arg2 === '--show-sensitive');
    case 'review':
      return cmdFinalize(arg1, 'under_review');
    case 'invite-upload':
      return cmdInviteUpload(arg1);
    case 'revoke-upload':
      return cmdRevokeUpload(arg1);
    case 'reject':
      return cmdFinalize(arg1, 'reject');
    case 'quote':
      return cmdFinalize(arg1, 'quote');
    case 'accept':
      return cmdFinalize(arg1, 'accept');
    case 'close':
      return cmdFinalize(arg1, 'close');
    case 'cleanup':
      return cmdCleanup(arg1 === '--apply' || arg2 === '--apply');
    default:
      log('Usage: intake-ops.ts <list|find|review|invite-upload|revoke-upload|reject|quote|accept|close|cleanup> [args]');
      process.exitCode = 1;
  }
}

// Only auto-run when executed directly as a script (e.g. `npx tsx
// scripts/ops/intake-ops.ts ...`), never when imported as a module
// by a QA script wanting to reuse buildSafeSummary/etc.
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('intake-ops failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

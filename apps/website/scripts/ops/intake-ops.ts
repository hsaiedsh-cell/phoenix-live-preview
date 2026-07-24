// ============================================================
// Phoenix Website — Intake Operations CLI
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Manual CLI for Private Beta operations. Talks directly to the
// repositories/services (not over HTTP), so it works whether or not
// the Next.js server is running, and is the intended caller of the
// internal-only finalize/upload-session HTTP routes' underlying
// logic (this CLI is a superset — it can also list and inspect).
//
// Never prints the raw upload token after initial issuance: the
// invite command constructs and sends the /upload/<token> URL by
// email only. Re-running `find` or `list` on that request afterward
// shows only status and metadata — the raw token is not retrievable
// from storage at all (only a hash is persisted).
//
// Usage:
//   npx tsx scripts/ops/intake-ops.ts list
//   npx tsx scripts/ops/intake-ops.ts find <publicReference>
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
import { finalizeIntakeRequest, type FinalizeAction } from '../../src/lib/intake/finalize.service';
import { issueUploadSession, revokeUploadSession } from '../../src/lib/intake/upload-session.service';

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(message);
}

async function cmdList(): Promise<void> {
  const rows = await intakeRequestsRepo.listRequests(50);
  for (const row of rows) {
    log(`${row.public_reference}  ${row.status.padEnd(15)}  ${row.request_type.padEnd(10)}  ${row.company}`);
  }
  log(`\n${rows.length} request(s).`);
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

async function cmdFind(publicReference: string): Promise<void> {
  const row = await requireRequest(publicReference);
  if (!row) return;
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
  // Deliberately never logs the raw token — only the outcome
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
  if (!apply) {
    log('\nDry run only — no rows were changed. Re-run with --apply to perform the update.');
  }
}

async function main(): Promise<void> {
  const [, , command, arg1, arg2] = process.argv;

  switch (command) {
    case 'list':
      return cmdList();
    case 'find':
      return cmdFind(arg1);
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

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('intake-ops failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

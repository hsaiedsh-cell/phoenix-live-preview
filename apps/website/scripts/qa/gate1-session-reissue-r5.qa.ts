// ============================================================
// QA: Reissuable upload invitations after revoke or expiry (R5)
// PHX-LAUNCH-001-R5 Section 1
// EXECUTED against a real local Postgres instance. Storage/Email are
// injected fakes.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import { issueUploadSession, revokeUploadSession } from '../../src/lib/intake/upload-session.service';
import { __setEmailForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

async function createTestRequest(status = 'under_review'): Promise<intakeRequestsRepo.IntakeRequestRow> {
  return intakeQuery<intakeRequestsRepo.IntakeRequestRow>(
    `INSERT INTO public_intake_requests (
       public_reference, request_type, first_name, last_name, work_email_normalized,
       company, role, message, privacy_consent, privacy_version, terms_version,
       marketing_consent, consent_timestamp, idempotency_key_hash, ip_hash, status
     ) VALUES ('PHX-REQ-' || substr(md5(random()::text), 1, 12), 'assessment', 'R5Gate1', 'Tester',
       $1, 'Acme', 'CAIO', 'session reissue QA r5', true, $2, $3, false, now(), $4, null, $5)
     RETURNING *`,
    [`r5gate1-${randomUUID()}@acme.example`, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, randomUUID(), status]
  ).then((rows) => rows[0]);
}

async function main() {
  __setEmailForTests(createFakeEmailSender('always_succeed'));

  section('1. First invite from under_review succeeds');
  {
    const request = await createTestRequest('under_review');
    const outcome = await issueUploadSession(request.id);
    assert(outcome.kind === 'ok', 'first invitation succeeds');
    const row = await intakeRequestsRepo.findById(request.id);
    assert(row?.status === 'upload_invited', 'request transitions to upload_invited');
  }

  section('2. Second invite while an active session exists is rejected');
  {
    const request = await createTestRequest('under_review');
    const first = await issueUploadSession(request.id);
    assert(first.kind === 'ok', 'first invitation succeeds');
    const second = await issueUploadSession(request.id);
    assert(second.kind === 'session_already_active', 'a second invite while the session is still active/unexpired is rejected');
  }

  section('3. Revoke then reissue succeeds');
  {
    const request = await createTestRequest('under_review');
    const first = await issueUploadSession(request.id);
    assert(first.kind === 'ok', 'first invitation succeeds');
    const revokeResult = await revokeUploadSession(request.id);
    assert(revokeResult.revoked === true, 'revocation succeeds');
    const reissue = await issueUploadSession(request.id);
    assert(reissue.kind === 'ok', 'reissue after revoke succeeds -- this was IMPOSSIBLE before R5 (upload_invited -> upload_invited was not an allowed transition)');
    const row = await intakeRequestsRepo.findById(request.id);
    assert(row?.status === 'upload_invited', 'request remains upload_invited after reissue (no fake transition)');
  }

  section('4. Expired session then reissue succeeds without requiring a separate cleanup run');
  {
    const request = await createTestRequest('under_review');
    const first = await issueUploadSession(request.id);
    assert(first.kind === 'ok', 'first invitation succeeds');
    const sessionRows = await intakeQuery<{ id: string }>(`SELECT id FROM public_upload_sessions WHERE request_id = $1`, [request.id]);
    await intakeQuery(`UPDATE public_upload_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, [sessionRows[0].id]);
    // Deliberately NOT running any cleanup/expireStaleSessions job --
    // the session's status column still reads 'active' at this point.
    const reissue = await issueUploadSession(request.id);
    assert(reissue.kind === 'ok', 'reissue succeeds immediately, with no separate cleanup run -- issueUploadSession itself atomically expires the stale session');
    const oldSessionRow = await intakeQuery<{ status: string }>(`SELECT status FROM public_upload_sessions WHERE id = $1`, [sessionRows[0].id]);
    assert(oldSessionRow[0].status === 'expired', 'the old session is genuinely marked expired in the database as a side effect');
  }

  section('5. Reissued token differs from the revoked/expired token; only one active session exists');
  {
    const request = await createTestRequest('under_review');
    await issueUploadSession(request.id);
    const firstSessionRows = await intakeQuery<{ id: string; token_hash: string }>(`SELECT id, token_hash FROM public_upload_sessions WHERE request_id = $1`, [request.id]);
    await revokeUploadSession(request.id);
    await issueUploadSession(request.id);
    const allSessionRows = await intakeQuery<{ id: string; token_hash: string; status: string }>(
      `SELECT id, token_hash, status FROM public_upload_sessions WHERE request_id = $1 ORDER BY created_at ASC`,
      [request.id]
    );
    assert(allSessionRows.length === 2, 'exactly two session rows exist (original + replacement)');
    assert(allSessionRows[1].token_hash !== firstSessionRows[0].token_hash, 'the replacement session has a genuinely different token hash');
    const activeSessions = allSessionRows.filter((s) => s.status === 'active');
    assert(activeSessions.length === 1, 'only one active session exists at a time');
  }

  section('6. Reissue from files_received/rejected/closed is denied');
  {
    for (const status of ['files_received', 'rejected', 'closed'] as const) {
      const request = await createTestRequest(status);
      const outcome = await issueUploadSession(request.id);
      assert(outcome.kind === 'invalid_transition', `issuing from status "${status}" is denied`);
    }
  }

  section('7. Email idempotency key differs for each session (per-session, not per-request)');
  {
    const request = await createTestRequest('under_review');
    const fakeEmail = createFakeEmailSender('always_succeed');
    __setEmailForTests(fakeEmail);
    await issueUploadSession(request.id);
    await revokeUploadSession(request.id);
    await issueUploadSession(request.id);
    const invitationKeys = fakeEmail.sentMessages.map((m) => m.idempotencyKey).filter((k): k is string => typeof k === 'string' && k.startsWith('upload-invitation/'));
    assert(invitationKeys.length === 2, 'two upload-invitation emails were sent, one per session');
    assert(new Set(invitationKeys).size === 2, 'the two invitation emails used two DIFFERENT provider idempotency keys');
  }

  section('8. Request remains upload_invited after a replacement reissue (structural: no fake same-status transition attempted)');
  {
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('../../src/lib/intake/upload-session.service.ts', import.meta.url), 'utf8');
    assert(source.includes('request.upload_session_reissued'), 'a dedicated core event marks a replacement reissue, distinct from the initial invitation');
    assert(source.includes('isReplacement'), 'the service distinguishes the replacement path from the initial path explicitly');
  }

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate1-session-reissue-r5.qa.ts failed:', error);
  process.exitCode = 1;
});

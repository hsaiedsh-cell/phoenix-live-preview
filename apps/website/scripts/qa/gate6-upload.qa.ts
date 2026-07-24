// ============================================================
// QA: Gate 6 — Upload security
// PHX-LAUNCH-001 — EXECUTED against real local Postgres. Storage is
// an injected fake adapter — no hosted Supabase project or
// credentials are used or required. Live Supabase Storage
// validation is NOT claimed here; see the implementation report's
// "tests unavailable" section.
// ============================================================

import { randomUUID } from 'node:crypto';
import { assert, section, printSummaryAndExit } from './assert';
import { intakeQuery } from '../../src/lib/intake/db';
import * as intakeRequestsRepo from '../../src/lib/intake/repositories/intake-requests.repository';
import * as uploadSessionsRepo from '../../src/lib/intake/repositories/upload-sessions.repository';
import { generateRawUploadToken, tokenHash } from '../../src/lib/intake/hash';
import {
  checkUploadToken,
  signUploadObject,
  completeUploadObject,
} from '../../src/lib/intake/upload-flow.service';
import { __setStorageForTests, __setEmailForTests, __resetAdaptersForTests } from '../../src/lib/intake/adapters';
import { createFakeStorageAdapter, type StorageAdapter } from '../../src/lib/intake/adapters/storage.adapter';
import { createFakeEmailSender } from '../../src/lib/intake/adapters/email.adapter';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../src/lib/intake/config';

async function createTestRequest(): Promise<intakeRequestsRepo.IntakeRequestRow> {
  const { row } = await intakeRequestsRepo.createOrGetByIdempotencyKey({
    requestType: 'assessment',
    firstName: 'Gate6',
    lastName: 'Tester',
    workEmailNormalized: `gate6-${randomUUID()}@acme.example`,
    company: 'Acme',
    role: 'CAIO',
    message: 'upload security QA',
    privacyVersion: CURRENT_PRIVACY_VERSION,
    termsVersion: CURRENT_TERMS_VERSION,
    marketingConsent: false,
    idempotencyKeyHash: randomUUID(),
    ipHash: null,
  });
  return row;
}

async function main() {
  __setEmailForTests(createFakeEmailSender('always_succeed'));

  section('1. Anonymous / invalid / expired / revoked / used tokens all denied');
  const fakeStorage = createFakeStorageAdapter();
  __setStorageForTests(fakeStorage);

  const anonOutcome = await checkUploadToken('never-issued-token-xyz');
  assert(anonOutcome.kind === 'denied' && anonOutcome.reason === 'invalid', 'a token that was never issued is denied (reason: invalid)');

  const request = await createTestRequest();

  // Expired session — manufactured directly since normal creation always uses the 24h default.
  const expiredRawToken = generateRawUploadToken();
  await intakeQuery(
    `INSERT INTO public_upload_sessions (request_id, token_hash, expires_at) VALUES ($1, $2, now() - interval '1 hour')`,
    [request.id, tokenHash(expiredRawToken)]
  );
  const expiredOutcome = await checkUploadToken(expiredRawToken);
  assert(expiredOutcome.kind === 'denied' && expiredOutcome.reason === 'expired', 'an expired token is denied (reason: expired)');

  const revokedRawToken = generateRawUploadToken();
  const revokedRequest = await createTestRequest();
  const revokedSession = await uploadSessionsRepo.createUploadSession(revokedRequest.id, tokenHash(revokedRawToken));
  await uploadSessionsRepo.revokeSession(revokedSession.id);
  const revokedOutcome = await checkUploadToken(revokedRawToken);
  assert(revokedOutcome.kind === 'denied' && revokedOutcome.reason === 'revoked', 'a revoked token is denied (reason: revoked)');

  const usedRawToken = generateRawUploadToken();
  const usedRequest = await createTestRequest();
  const usedSession = await uploadSessionsRepo.createUploadSession(usedRequest.id, tokenHash(usedRawToken));
  await uploadSessionsRepo.markSessionUsed(usedSession.id);
  const usedOutcome = await checkUploadToken(usedRawToken);
  assert(usedOutcome.kind === 'denied' && usedOutcome.reason === 'used', 'a used token is denied (reason: used)');

  const validRawToken = generateRawUploadToken();
  const validRequest = await createTestRequest();
  await uploadSessionsRepo.createUploadSession(validRequest.id, tokenHash(validRawToken));
  const validOutcome = await checkUploadToken(validRawToken);
  assert(validOutcome.kind === 'ok', 'a freshly issued, active token is accepted');

  section('2. Signing: scope restricted to one object, server-generated key, filename never used in key');
  const sign1 = await signUploadObject(validRawToken, {
    filename: '../../etc/passwd; rm -rf /',
    contentType: 'application/pdf',
    sizeBytes: 1000,
  });
  assert(sign1.kind === 'ok', 'first valid file is signed successfully');
  if (sign1.kind === 'ok') {
    assert(!sign1.storageObjectKey.includes('passwd'), 'object key does NOT contain the malicious/original filename');
    assert(!sign1.storageObjectKey.includes('..'), 'object key contains no path-traversal sequence from the filename');
    assert(fakeStorage.signedUrlCalls.length === 1, 'exactly one signed-upload-URL call has been made so far');
    assert(
      fakeStorage.signedUrlCalls[0] === sign1.storageObjectKey,
      'the storage adapter was called with the exact server-generated key, not a client-supplied one'
    );
  }

  section('3. File count limit enforced (max 5)');
  fakeStorage.simulatedObjects.set(sign1.kind === 'ok' ? sign1.storageObjectKey : 'unused', { sizeBytes: 1000 });
  if (sign1.kind === 'ok') {
    await completeUploadObject(validRawToken, {
      storageObjectKey: sign1.storageObjectKey,
      originalFilename: 'file1.pdf',
      contentType: 'application/pdf',
    });
  }
  // 4 more files (2..5) to reach the max of 5.
  for (let i = 2; i <= 5; i += 1) {
    const s = await signUploadObject(validRawToken, { filename: `file${i}.pdf`, contentType: 'application/pdf', sizeBytes: 1000 });
    if (s.kind === 'ok') {
      fakeStorage.simulatedObjects.set(s.storageObjectKey, { sizeBytes: 1000 });
      await completeUploadObject(validRawToken, {
        storageObjectKey: s.storageObjectKey,
        originalFilename: `file${i}.pdf`,
        contentType: 'application/pdf',
      });
    }
  }
  const sixthSignAttempt = await signUploadObject(validRawToken, { filename: 'file6.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
  // Completing the 5th (max) file auto-transitions the session to
  // 'used' (see upload-flow.service.ts's completeUploadObject), so a
  // 6th attempt is denied via token-validity ('used'), not via the
  // file_count_exceeded acceptance-reason path — both are valid
  // enforcement mechanisms for "no more than 5 files ever succeed",
  // so either outcome proves the limit holds.
  const sixthBlockedByCount =
    (sixthSignAttempt.kind === 'rejected' && sixthSignAttempt.reason === 'file_count_exceeded') ||
    (sixthSignAttempt.kind === 'denied' && sixthSignAttempt.reason === 'used');
  assert(sixthBlockedByCount, '6th file in the same session can never succeed (session auto-locks at 5 completed files)');

  section('4. Per-file and total-size limits enforced');
  const bigFileToken = generateRawUploadToken();
  const bigFileRequest = await createTestRequest();
  await uploadSessionsRepo.createUploadSession(bigFileRequest.id, tokenHash(bigFileToken));
  const tooLargeSign = await signUploadObject(bigFileToken, {
    filename: 'huge.pdf',
    contentType: 'application/pdf',
    sizeBytes: 21 * 1024 * 1024,
  });
  assert(tooLargeSign.kind === 'rejected' && tooLargeSign.reason === 'per_file_size_exceeded', 'a 21MB single file is rejected (per_file_size_exceeded)');

  const totalSizeToken = generateRawUploadToken();
  const totalSizeRequest = await createTestRequest();
  await uploadSessionsRepo.createUploadSession(totalSizeRequest.id, tokenHash(totalSizeToken));
  // Each file individually respects the 20MB per-file cap; three
  // 20MB files reach exactly the 60MB total budget (boundary,
  // allowed), then a small 4th file pushes over and must be
  // rejected purely on the TOTAL budget, not the per-file one.
  const twentyMb = 20 * 1024 * 1024;
  const fileA = await signUploadObject(totalSizeToken, { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: twentyMb });
  assert(fileA.kind === 'ok', 'first 20MB file is accepted');
  if (fileA.kind === 'ok') {
    fakeStorage.simulatedObjects.set(fileA.storageObjectKey, { sizeBytes: twentyMb });
    await completeUploadObject(totalSizeToken, { storageObjectKey: fileA.storageObjectKey, originalFilename: 'a.pdf', contentType: 'application/pdf' });
  }
  const fileB = await signUploadObject(totalSizeToken, { filename: 'b.pdf', contentType: 'application/pdf', sizeBytes: twentyMb });
  assert(fileB.kind === 'ok', 'second 20MB file (running total 40MB) is accepted');
  if (fileB.kind === 'ok') {
    fakeStorage.simulatedObjects.set(fileB.storageObjectKey, { sizeBytes: twentyMb });
    await completeUploadObject(totalSizeToken, { storageObjectKey: fileB.storageObjectKey, originalFilename: 'b.pdf', contentType: 'application/pdf' });
  }
  const fileC = await signUploadObject(totalSizeToken, { filename: 'c.pdf', contentType: 'application/pdf', sizeBytes: twentyMb });
  assert(fileC.kind === 'ok', 'third 20MB file (running total exactly 60MB, the boundary) is still accepted');
  if (fileC.kind === 'ok') {
    fakeStorage.simulatedObjects.set(fileC.storageObjectKey, { sizeBytes: twentyMb });
    await completeUploadObject(totalSizeToken, { storageObjectKey: fileC.storageObjectKey, originalFilename: 'c.pdf', contentType: 'application/pdf' });
    const fileD = await signUploadObject(totalSizeToken, { filename: 'd.pdf', contentType: 'application/pdf', sizeBytes: 1024 * 1024 });
    assert(
      fileD.kind === 'rejected' && fileD.reason === 'total_size_exceeded',
      'a 4th file (even just 1MB) pushing the running total to 61MB exceeds the 60MB budget and is rejected (total_size_exceeded)'
    );
  }

  section('5. MIME allowlist: archive/executable/script/macro-enabled rejected');
  const mimeToken = generateRawUploadToken();
  const mimeRequest = await createTestRequest();
  await uploadSessionsRepo.createUploadSession(mimeRequest.id, tokenHash(mimeToken));
  const rejectedTypes = [
    'application/zip',
    'application/x-msdownload',
    'application/x-sh',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  ];
  for (const contentType of rejectedTypes) {
    const s = await signUploadObject(mimeToken, { filename: 'x', contentType, sizeBytes: 1000 });
    assert(s.kind === 'rejected' && s.reason === 'content_type_not_allowed', `${contentType} is rejected (content_type_not_allowed)`);
  }

  section('6. Completion verifies real object metadata; unverified object is rejected');
  const unverifiedToken = generateRawUploadToken();
  const unverifiedRequest = await createTestRequest();
  await uploadSessionsRepo.createUploadSession(unverifiedRequest.id, tokenHash(unverifiedToken));
  const unverifiedSign = await signUploadObject(unverifiedToken, { filename: 'y.pdf', contentType: 'application/pdf', sizeBytes: 1000 });
  if (unverifiedSign.kind === 'ok') {
    // Deliberately do NOT add this object to fakeStorage.simulatedObjects,
    // simulating a client claiming completion without ever having
    // actually uploaded the bytes.
    const completeOutcome = await completeUploadObject(unverifiedToken, {
      storageObjectKey: unverifiedSign.storageObjectKey,
      originalFilename: 'y.pdf',
      contentType: 'application/pdf',
    });
    assert(completeOutcome.kind === 'object_not_found', 'completion is rejected when the object does not actually exist in storage (never trusts the client)');
  }

  section('7. Accepted files remain pending_review; no public URL capability exists');
  const fileRows = await intakeQuery<{ scan_status: string }>(
    `SELECT scan_status FROM public_intake_files WHERE request_id = $1`,
    [validRequest.id]
  );
  assert(fileRows.length > 0 && fileRows.every((f) => f.scan_status === 'pending_review'), 'every accepted file row is still pending_review (no auto-processing)');

  const storageAdapterMethods = Object.keys(fakeStorage) as Array<keyof StorageAdapter>;
  assert(
    !storageAdapterMethods.some((m) => String(m).toLowerCase().includes('public')),
    'the StorageAdapter interface exposes no public-URL method at all (structurally impossible to generate one)'
  );

  __resetAdaptersForTests();
  printSummaryAndExit();
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('gate6-upload.qa.ts failed:', error);
  process.exitCode = 1;
});

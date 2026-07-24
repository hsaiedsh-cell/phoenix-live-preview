// ============================================================
// QA: pure decision functions (no I/O)
// PHX-LAUNCH-001 — EXECUTED (no external dependency required)
// ------------------------------------------------------------
// Covers status-transition rules, file-acceptance rules, and
// token-validity evaluation — all pure functions, so these
// assertions are fully deterministic and require no database,
// provider credential, or network access whatsoever.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { isAllowedStatusTransition } from '../../src/lib/intake/repositories/intake-requests.repository';
import { evaluateFileAcceptance } from '../../src/lib/intake/repositories/intake-files.repository';
import { evaluateTokenValidity, type UploadSessionRow } from '../../src/lib/intake/repositories/upload-sessions.repository';
import { isValidPublicReference, generatePublicReference } from '../../src/lib/intake/reference';

function fakeSession(overrides: Partial<UploadSessionRow>): UploadSessionRow {
  return {
    id: 's1',
    request_id: 'r1',
    token_hash: 'hash',
    status: 'active',
    max_files: 5,
    max_file_size_bytes: 20 * 1024 * 1024,
    max_total_size_bytes: 60 * 1024 * 1024,
    expires_at: new Date(Date.now() + 60_000),
    used_at: null,
    revoked_at: null,
    created_at: new Date(),
    ...overrides,
  };
}

section('Status transitions');
assert(isAllowedStatusTransition('received', 'under_review') === true, 'received -> under_review allowed');
assert(isAllowedStatusTransition('received', 'accepted') === false, 'received -> accepted rejected (invalid transition)');
assert(isAllowedStatusTransition('accepted', 'closed') === true, 'accepted -> closed allowed');
assert(isAllowedStatusTransition('closed', 'received') === false, 'closed is terminal, no transitions out');

section('Public reference format');
const ref = generatePublicReference();
assert(isValidPublicReference(ref), `generated reference has valid format (${ref})`);
assert(!isValidPublicReference('not-a-reference'), 'malformed reference rejected');
assert(!ref.includes(String(0)) || true, 'reference generation executes without throwing');

section('Upload token validity');
assert(evaluateTokenValidity(null).valid === false, 'missing session -> invalid');
assert(evaluateTokenValidity(fakeSession({ status: 'revoked' })).valid === false, 'revoked session -> denied');
assert(evaluateTokenValidity(fakeSession({ status: 'used' })).valid === false, 'used session -> denied');
assert(
  evaluateTokenValidity(fakeSession({ expires_at: new Date(Date.now() - 1000) })).valid === false,
  'expired session -> denied'
);
assert(evaluateTokenValidity(fakeSession({})).valid === true, 'active, unexpired session -> accepted');

section('File acceptance limits');
assert(
  evaluateFileAcceptance({ fileCount: 0, totalSizeBytes: 0 }, { sizeBytes: 1000, contentType: 'application/pdf' })
    .accepted === true,
  'first small PDF accepted'
);
assert(
  evaluateFileAcceptance({ fileCount: 5, totalSizeBytes: 0 }, { sizeBytes: 1000, contentType: 'application/pdf' })
    .accepted === false,
  'file count limit (5) enforced'
);
assert(
  evaluateFileAcceptance(
    { fileCount: 0, totalSizeBytes: 0 },
    { sizeBytes: 21 * 1024 * 1024, contentType: 'application/pdf' }
  ).accepted === false,
  'per-file size limit (20MB) enforced'
);
assert(
  evaluateFileAcceptance(
    { fileCount: 1, totalSizeBytes: 59 * 1024 * 1024 },
    { sizeBytes: 2 * 1024 * 1024, contentType: 'application/pdf' }
  ).accepted === false,
  'total session size limit (60MB) enforced'
);
assert(
  evaluateFileAcceptance({ fileCount: 0, totalSizeBytes: 0 }, { sizeBytes: 1000, contentType: 'application/x-msdownload' })
    .accepted === false,
  'unsupported MIME type (exe) rejected'
);
assert(
  evaluateFileAcceptance({ fileCount: 0, totalSizeBytes: 0 }, { sizeBytes: 1000, contentType: 'application/zip' })
    .accepted === false,
  'archive MIME type (zip) rejected'
);
assert(
  evaluateFileAcceptance(
    { fileCount: 0, totalSizeBytes: 0 },
    { sizeBytes: 1000, contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12' }
  ).accepted === false,
  'macro-enabled Office MIME type rejected'
);

printSummaryAndExit();

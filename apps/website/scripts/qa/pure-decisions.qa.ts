// ============================================================
// QA: pure decision functions (no I/O)
// PHX-LAUNCH-001 / R1 -- EXECUTED (no external dependency required)
// ------------------------------------------------------------
// Covers status-transition rules, token-validity evaluation, R1's
// extension validation, and R1's HTML escaping -- all pure
// functions, so these assertions are fully deterministic and
// require no database, provider credential, or network access
// whatsoever.
// ============================================================

import { assert, section, printSummaryAndExit } from './assert';
import { isAllowedStatusTransition } from '../../src/lib/intake/repositories/intake-requests.repository';
import { evaluateTokenValidity, type UploadSessionRow } from '../../src/lib/intake/repositories/upload-sessions.repository';
import { isValidPublicReference, generatePublicReference } from '../../src/lib/intake/reference';
import { isDangerousExtension, isExtensionCompatibleWithMimeType, extractExtension } from '../../src/lib/intake/extension-validation';
import { escapeHtml } from '../../src/lib/intake/html-escape';

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
    finalized_at: null,
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

section('Upload token validity');
assert(evaluateTokenValidity(null).valid === false, 'missing session -> invalid');
assert(evaluateTokenValidity(fakeSession({ status: 'revoked' })).valid === false, 'revoked session -> denied');
assert(evaluateTokenValidity(fakeSession({ status: 'used' })).valid === false, 'used session -> denied');
assert(
  evaluateTokenValidity(fakeSession({ expires_at: new Date(Date.now() - 1000) })).valid === false,
  'expired session -> denied'
);
assert(evaluateTokenValidity(fakeSession({})).valid === true, 'active, unexpired session -> accepted');

section('R1: extension extraction and dangerous-extension denylist');
assert(extractExtension('report.PDF') === '.pdf', 'extension extraction is case-insensitive');
assert(extractExtension('no-extension') === '', 'filename with no extension returns empty string');
for (const dangerous of ['a.zip', 'a.rar', 'a.7z', 'a.exe', 'a.dll', 'a.sh', 'a.bat', 'a.cmd', 'a.js', 'a.mjs', 'a.ps1', 'a.docm', 'a.dotm', 'a.xlsm', 'a.xltm', 'a.pptm', 'a.potm', 'a.ppam']) {
  assert(isDangerousExtension(dangerous), `${dangerous} is flagged as a dangerous extension`);
}
assert(!isDangerousExtension('report.pdf'), 'a genuinely safe extension is not flagged as dangerous');

section('R1: extension/MIME compatibility map');
assert(isExtensionCompatibleWithMimeType('report.pdf', 'application/pdf'), 'report.pdf + application/pdf is compatible');
assert(!isExtensionCompatibleWithMimeType('malware.exe', 'application/pdf'), 'malware.exe claiming application/pdf is rejected (wrong extension for MIME)');
assert(
  !isExtensionCompatibleWithMimeType('macro.docm', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  'macro.docm is rejected even though .docx is the allowed extension for that exact MIME type (macro extension always denied)'
);
assert(!isExtensionCompatibleWithMimeType('image.png', 'image/jpeg'), 'mismatched image extension/MIME pair rejected');
assert(isExtensionCompatibleWithMimeType('photo.JPEG', 'image/jpeg'), 'extension matching is case-insensitive');
assert(!isExtensionCompatibleWithMimeType('noextension', 'application/pdf'), 'a filename with no extension at all is rejected');

section('R1: HTML escaping');
assert(escapeHtml('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'angle brackets are escaped');
assert(
  escapeHtml('<a href="https://attacker.example">click</a>') ===
    '&lt;a href=&quot;https://attacker.example&quot;&gt;click&lt;/a&gt;',
  'a full anchor tag with quotes is fully escaped, not just angle brackets'
);
assert(escapeHtml("O'Brien & Co.") === 'O&#39;Brien &amp; Co.', 'apostrophe and ampersand both escaped');
assert(escapeHtml('plain text') === 'plain text', 'text with no special characters is unchanged');

printSummaryAndExit();

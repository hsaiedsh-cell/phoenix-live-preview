// ============================================================
// Storage object key generator — server-only
// PHX-LAUNCH-001
// ------------------------------------------------------------
// The storage object key is always generated here from random
// bytes plus the (trusted, server-side) upload-session id. The
// customer-supplied original filename is NEVER used to build a
// storage path — it is retained only as display/audit metadata in
// public_intake_files.original_filename.
// ============================================================

import { randomBytes } from 'node:crypto';

export function generateStorageObjectKey(uploadSessionId: string): string {
  const random = randomBytes(16).toString('hex');
  return `intake/${uploadSessionId}/${random}`;
}

// ============================================================
// Public reference generator — server-only
// PHX-LAUNCH-001
// ------------------------------------------------------------
// Generates the customer-facing request reference, e.g.
// "PHX-REQ-9F3KQJ2XA7B1". Never the database UUID/primary key.
// Uses Crockford-style base32 (no 0/O/1/I ambiguity) over
// cryptographically random bytes so references are safe to read
// aloud or type back into a support conversation.
// ============================================================

import { randomBytes } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I

export function generatePublicReference(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `PHX-REQ-${out}`;
}

const REFERENCE_PATTERN = /^PHX-REQ-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;

export function isValidPublicReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value);
}

// ============================================================
// Phoenix Platform — Shared Mock Identifiers
// PHX-PLATFORM-004 — Entity View & Audit Fixtures
// ------------------------------------------------------------
// Fixed placeholder IDs shared by api-adapters.ts and every file
// under mock-fixtures/. Kept in their own module (rather than
// defined in api-adapters.ts) so fixture files can reference them
// without importing api-adapters.ts and creating a circular
// dependency (api-adapters.ts imports the fixtures to build
// contract-aligned view models).
// ============================================================

export const MOCK_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const MOCK_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000000';
export const MOCK_OWNER_USER_ID = '00000000-0000-4000-8000-0000000000aa';

/**
 * Small roster of mock users so different sample assets can be attributed to
 * different owners/actors, rather than everything collapsing onto one user.
 * Not a full User contract fixture set — just id + display name, sufficient
 * for ownerName / actorDisplayName presentation fields.
 */
export const MOCK_USERS: Record<string, string> = {
  '00000000-0000-4000-8000-0000000000aa': 'Hossam M.',
  '00000000-0000-4000-8000-0000000000ab': 'S. Al-Farsi',
  '00000000-0000-4000-8000-0000000000ac': 'M. Khoury',
  '00000000-0000-4000-8000-0000000000ad': 'R. Haddad',
  '00000000-0000-4000-8000-0000000000ae': 'L. Nasser',
  '00000000-0000-4000-8000-0000000000af': 'T. Rahim',
};

/** Deterministic mock ownerUserId lookup for the sample asset owners in sample-data.ts. */
export const MOCK_OWNER_USER_ID_BY_NAME: Record<string, string> = {
  'S. Al-Farsi': '00000000-0000-4000-8000-0000000000ab',
  'M. Khoury': '00000000-0000-4000-8000-0000000000ac',
  'R. Haddad': '00000000-0000-4000-8000-0000000000ad',
  'L. Nasser': '00000000-0000-4000-8000-0000000000ae',
  'T. Rahim': '00000000-0000-4000-8000-0000000000af',
};

export function ownerUserIdForName(name: string): string {
  return MOCK_OWNER_USER_ID_BY_NAME[name] ?? MOCK_OWNER_USER_ID;
}

export function ownerNameForUserId(userId: string): string {
  return MOCK_USERS[userId] ?? 'Unknown User';
}

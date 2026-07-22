# Security Scan Report — PHX-PASSPORTS-001 — Live Passport Endpoint Foundation

## .env file scan

```
$ find . \( -name ".env" -o -name ".env.local" -o -name ".env.production" -o -name ".env.development" \) -not -path "*/node_modules/*"
(no output)
```

**Result: PASS.** No `.env`, `.env.local`, `.env.production`, or `.env.development`
file exists anywhere in the uploaded source tree. Only the pre-existing
`.env.example` / `.env.local.example` templates (root and `apps/platform`) and
`apps/backend/.env.example` are present — all templates, no real values.

## Secret pattern scan

```
$ grep -RIn --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  -E "sk_test_|sk_live_|CLERK_SECRET_KEY=.*[A-Za-z0-9_-]{20,}|DATABASE_URL=postgres|PHOENIX_DATABASE_URL=postgres|eyJ[A-Za-z0-9_-]{20,}" .
```

Matches found (all reviewed individually):

| File | Match | Assessment |
|---|---|---|
| `apps/backend/.env.example:16` | `DATABASE_URL=postgresql://phoenix:phoenix_dev_password@localhost:5432/phoenix_dev` | Benign — a documented, fake local-dev-only password matching `docker-compose.yml`'s own defaults, in a template file explicitly meant to be copied and filled in. Not a real credential, not for the live Supabase database. |
| `docs/platform/PHX_PLATFORM_011_R1_QA_REPORT.md:108` | `export DATABASE_URL=postgresql://phoenix:phoenix_dev_password@localhost:5432/phoenix_dev` | Same fake local-dev value, quoted in a prior sprint's QA report showing the command a tester ran locally. Not a live secret. |
| `docs/platform/PHX_PLATFORM_010_IMPLEMENTATION_REPORT.md:246` | prose mentioning `pk_test_...` / `sk_test_...` | Prose describing a syntactically-valid-looking placeholder used at build time in a prior sprint. Not an actual key value. |
| `docs/platform/PHX_PLATFORM_011_R1_IMPLEMENTATION_REPORT.md:278` | prose mentioning `pk_test_.../sk_test_...` | Same — confirms *no* Clerk secret was committed. |
| `docs/deployment/PHX_DEPLOY_004C_SECURITY_QA_REPORT.md:38` | a `grep` command shown as an example, referencing `sk_test_fake_key_for_build_qa_only` | The string itself says "fake" and "qa_only" — a placeholder used to test the scanner, not a real key. |
| `docs/deployment/PHX_DEPLOY_003_SECURITY_SCAN_REPORT.md:11,31` | table row + `CLERK_SECRET_KEY=sk_test_<base64 of "fake-secret-key-for-local-qa-only">` | Explicitly labeled fake in-line. Not a real key. |
| `docs/deployment/PHX_DEPLOY_003_R1_SECURITY_SCAN_REPORT.md:12,26` | same as above | Same. |
| `docs/deployment/PHX_DEPLOY_003_RUNTIME_QA_REPORT.md:224,286` | prose/commands referencing `pk_test_...`/`sk_test_...` patterns | Documentation of a scan methodology, not a real key. |

**Result: PASS.** No real, usable secret (Clerk secret key, live database credential,
or JWT) was found anywhere in the repository. All matches are either fake/documented
local-dev placeholders or prose describing prior scans.

## Browser exposure review

- `apps/platform/src/lib/db/preview-db.server.ts` — the only file that imports `pg` /
  constructs a `Pool` / reads `process.env.PHOENIX_DATABASE_URL`'s *value*. It throws
  immediately if evaluated with `typeof window !== 'undefined'`, and is only imported
  by `preview-api-client.server.ts`, which is only imported by
  `platform-data-source.ts`, which is only called from Server Component pages (none
  of which are `'use client'`). This chain was not modified by this sprint.
- New file `LivePassportCard.tsx` has **no** `'use client'` directive (confirmed by
  inspection) and imports no server-only module — it is a plain Server Component,
  consistent with the existing `LiveAssessmentsTable.tsx`.
- `grep -n "PHOENIX_DATABASE_URL"` across `apps/platform/src` (excluding
  `*.server.ts` files) returns only: (1) a string literal used as a *label* in
  `ClerkSignInPanel.tsx`'s pre-existing "missing config" message (names the env var,
  never reads or displays its value), and (2) comments/status strings in
  `api-config.ts` that likewise only name the variable. Neither was touched by this
  sprint, and neither exposes a value.
- No `pg` import and no `Pool` reference appears in `LivePassportCard.tsx` or in
  `app/(platform)/passports/page.tsx`.

**Result: PASS.** `PHOENIX_DATABASE_URL`'s value is never read outside
`preview-db.server.ts`, and no new code path bundles server-only DB access toward the
client.

## PHOENIX_DATABASE_URL server-only verification

Confirmed via the chain above: `preview-db.server.ts` → `preview-api-client.server.ts`
→ `platform-data-source.ts` → Server Component pages only. This sprint added one new
consumer (`previewGetPassports()` inside `preview-api-client.server.ts` itself) and
one new caller (`loadPassportsListData()` inside `platform-data-source.ts` itself) —
both already inside the existing server-only boundary; neither is a new entry point
into that boundary from client code.

## Token storage verification

```
$ grep -n "localStorage\|sessionStorage" [new/changed files]
(no output)
```

**Result: PASS.** No `localStorage`/`sessionStorage` usage was added by this sprint.
Session state continues to be resolved server-side via `@clerk/nextjs/server`'s
`auth()`, exactly as every other migrated page already does.

## Known security limitations (unchanged from before this sprint, or newly documented)

- The permission gating this sprint chose for passport reads (`assessment.read`) is a
  documented **assumption**, not a confirmed match to a real backend endpoint's
  enforcement (no such endpoint exists yet — see Implementation Report). If a future
  real backend passports endpoint enforces a stricter or different permission, this
  preview-mode implementation would need to be updated to match, or a workspace member
  could see live passport data in the preview environment that a production endpoint
  would restrict more tightly.
- `PHOENIX_DATABASE_URL`'s pooled connection uses `ssl: { rejectUnauthorized: false }`
  (pre-existing, in `preview-db.server.ts`, unchanged by this sprint) — a documented
  trade-off for serverless/edge Postgres clients connecting to Supabase, not a new
  finding.
- This scan covers the source tree only. It cannot and does not confirm the *actual*
  deployed Vercel environment variables, the actual Supabase project's network/access
  rules, or the actual Clerk application's configuration — those remain the
  operator's responsibility to verify post-deployment.

**Overall: PASS**, with the assumption and limitations above disclosed for the
reviewer's judgment rather than omitted.

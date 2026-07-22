# BUILD REPORT — PHX-PASSPORTS-001 — Live Passport Endpoint Foundation

**Sprint:** PHX-PASSPORTS-001 — Live Passport Endpoint Foundation
**Source basis:** `phoenix-live-preview-main.zip`, uploaded by the operator as a direct
export of `hsaiedsh-cell/phoenix-live-preview` (branch not independently confirmed —
see Limitations).
**Live URL (per task brief, not independently verified by this build):**
`https://phoenix-live-preview-platform.vercel.app`
**Environment this report was produced in:** a sandboxed local container with no
access to the operator's GitHub repo, Vercel project, or live Supabase database.
All commands below were run against the extracted source tree only.

---

## 1. Files changed

| File | Type |
|---|---|
| `apps/platform/src/lib/real-api-client.ts` | Modified — added `BackendPassport` shared type |
| `apps/platform/src/lib/preview-api-client.server.ts` | Modified — added `previewGetPassports()` |
| `apps/platform/src/lib/platform-data-source.ts` | Modified — added `loadPassportsListData()` |
| `apps/platform/src/components/LivePassportCard.tsx` | Added — new component |
| `apps/platform/src/app/(platform)/passports/page.tsx` | Modified — mode branch for vercel-supabase-preview |

No other file in the repository was touched. Confirmed by a full `diff -rq` between
the untouched extracted source and the modified tree (excluding `node_modules`,
`.next`, `*.tsbuildinfo`) — see `PHX-PASSPORTS-001.patch` for the full unified diff.

## 2. Commands run and results

All commands run from the repo root after `corepack enable && corepack prepare
pnpm@8.15.9 --activate` (matches `package.json`'s `packageManager` field).

```
$ pnpm install --frozen-lockfile
Scope: all 11 workspace projects
Lockfile is up to date, resolution step is skipped
Packages: +471
Done in 28.5s
```
Result: **PASS**. No lockfile drift, no resolution changes required.

```
$ pnpm --filter @phoenix/platform type-check
> tsc --noEmit
(no output)
```
Result: **PASS**. Zero type errors.

```
$ pnpm --filter @phoenix/platform lint
> next lint
✔ No ESLint warnings or errors
```
Result: **PASS**.

```
$ pnpm --filter @phoenix/platform build
> next build
✓ Compiled successfully
✓ Generating static pages (12/12)

Route (app)                              Size     First Load JS
├ ƒ /passports                           1.7 kB          108 kB
...
ƒ  (Dynamic)  server-rendered on demand
```
Result: **PASS**. `/passports` builds as a dynamic (`ƒ`) route, confirming
`export const dynamic = 'force-dynamic'` is respected — it is not statically
generated/cached at build time.

### Security / safety scans (see `docs/passports/PHX_PASSPORTS_001_SECURITY_SCAN_REPORT.md` for full detail)

```
$ find . \( -name ".env" -o -name ".env.local" -o -name ".env.production" -o -name ".env.development" \) -not -path "*/node_modules/*"
(no output)
```
Result: **PASS**. No `.env*` files present anywhere in the repo.

```
$ grep -RIn --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
  -E "sk_test_|sk_live_|CLERK_SECRET_KEY=.*[A-Za-z0-9_-]{20,}|DATABASE_URL=postgres|PHOENIX_DATABASE_URL=postgres|eyJ[A-Za-z0-9_-]{20,}" .
```
Result: **PASS with benign matches** — every match is either a fake, documented
local-dev-only Postgres password in `apps/backend/.env.example` (matches
`docker-compose.yml`'s own defaults) or prose in prior sprints' documentation
*discussing* secret-pattern scanning, not an actual secret. No real credential
found. Full match list in the security scan report.

```
$ grep -RIn "createdAt\.slice\|updatedAt\.slice" apps/platform/src
(no output)
```
Result: **PASS**. No unsafe direct `.slice()` calls on `createdAt`/`updatedAt`
anywhere in the platform app, including the new files.

## 3. Deployment status

**Not performed by this build.** This environment has no credentials for and no
network access to `github.com/hsaiedsh-cell/phoenix-live-preview`, Vercel, or the
live Supabase instance. Per the task brief's explicit instruction ("If live
deployment cannot be performed from your environment, produce a patch/diff,
updated files, and release docs clearly stating that deployment must be performed
by the operator"), this release package contains:

- `PHX-PASSPORTS-001.patch` — a unified diff against the uploaded source
- `updated-files/` — the five changed/added files in full, at their correct paths
- This documentation set

**The operator must**: apply the patch (or copy `updated-files/` over the repo),
commit, and push to `hsaiedsh-cell/phoenix-live-preview` (`main`) to trigger the
Vercel redeploy. No commit or push was performed from this environment.

## 4. Final build result

**PASS** — `pnpm install`, `type-check`, `lint`, and `build` all succeeded with
zero errors and zero warnings against the real, uploaded source tree. This is a
local-source verification only; it does not confirm behavior against the live
Supabase database or the live Vercel deployment (see QA report's explicit
"not tested" list).

Status: **PHX-PASSPORTS-001 — Ready for ChatGPT QA Review.** Not self-approved.

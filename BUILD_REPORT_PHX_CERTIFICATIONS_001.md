# Build Report — PHX-CERTIFICATIONS-001

## Source archive verified

`PHX-CERTIFICATIONS-001-CURRENT-MAIN-SOURCE.tar.gz` — exported after
fetching and fast-forwarding from `origin/main`.

Pre-flight checks performed before any code was written:
- `LivePassportCard`, `previewGetPassports`, `loadPassportsListData` all
  confirmed present (`grep -rl`, three separate searches).
- `apps/backend/src/routes/passports.ts` confirmed still a
  PHX-BACKEND-001 stub (read in full).
- `apps/backend/src/routes/certifications.ts` confirmed still a
  PHX-BACKEND-001 stub, no `certifications.repository.ts` present.

## Toolchain

```
corepack enable
corepack prepare pnpm@8.15.9 --activate
pnpm install --frozen-lockfile
```
Result: 471 packages resolved, lockfile unchanged, `Done in 9s`.

## Commands run and results

| Step | Command | Result |
|---|---|---|
| Baseline backend type-check | `pnpm --filter=./apps/backend type-check` | Pass |
| Baseline backend build | `pnpm --filter=./apps/backend build` | Pass |
| Baseline platform type-check | `pnpm --filter=./apps/platform type-check` | Pass |
| Post-change backend type-check | `pnpm --filter=./apps/backend type-check` | Pass |
| Post-change backend build | `pnpm --filter=./apps/backend build` | Pass |
| Post-change platform type-check | `pnpm --filter=./apps/platform type-check` | Pass |
| Post-change platform lint | `pnpm --filter=./apps/platform lint` | Pass — `✔ No ESLint warnings or errors` |
| Post-change platform build | `pnpm --filter=./apps/platform build` | Pass — 12/12 static pages generated, `/certifications` compiles as a dynamic (`ƒ`) route |

## Files changed

```
 M apps/platform/src/lib/real-api-client.ts
 M apps/platform/src/lib/preview-api-client.server.ts
 M apps/platform/src/lib/platform-data-source.ts
 M apps/platform/src/app/(platform)/certifications/page.tsx
 A apps/platform/src/components/LiveCertificationsTable.tsx
```

No file under `apps/backend/`, `apps/backend/db/`, `packages/pbrs/`,
`packages/core/`, or any auth/permissions file was touched.

## Deliverables in this package

- `certifications-001.patch` — unified diff of all five changed/added files
- `docs/certification/PHX_CERTIFICATIONS_001_IMPLEMENTATION_REPORT.md`
- `docs/certification/PHX_CERTIFICATIONS_001_QA_REPORT.md`
- `docs/certification/PHX_CERTIFICATIONS_001_SETUP_GUIDE.md`
- `docs/certification/RELEASE_NOTES_PHX_CERTIFICATIONS_001.md`
- `BUILD_REPORT_PHX_CERTIFICATIONS_001.md` (this file)
- `PHX-CERTIFICATIONS-001-UPDATED-FILES/` — the five changed/added source
  files in their full, final form (not just diff hunks), for direct
  copy-in

## Explicitly not claimed

No deployment was performed. No live Supabase/Postgres verification was
performed (no network path to one in this sandbox) — see QA Report §6–§7.

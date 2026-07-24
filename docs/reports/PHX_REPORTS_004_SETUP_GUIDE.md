# PHX-REPORTS-004 — Setup & Run Guide

## Prerequisites

- Node.js >= 18, pnpm 8.15.9 (via `corepack enable && corepack prepare pnpm@8.15.9 --activate`)
- PostgreSQL 16 (matches `apps/backend/docker-compose.yml`'s pin)

## 1. Install

```bash
pnpm install --frozen-lockfile
```

## 2. Database

```bash
cd apps/backend
cp .env.example .env   # edit DATABASE_URL, set PHOENIX_ENABLE_DATABASE=true
pnpm db:migrate:dev    # applies 0001-0006 (fresh) or just the new ones (upgrade)
pnpm db:seed:dev       # idempotent — safe to re-run
```

## 3. Backend API server

```bash
cd apps/backend
pnpm dev   # or: pnpm build && pnpm start
```

## 4. Report generation worker

The worker is a **separate process** from the API server — start it independently.

**Continuous (development):**
```bash
cd apps/backend
pnpm db:worker:dev
```

**Deterministic once/batch (QA/CI):**
```bash
cd apps/backend
pnpm db:worker:once:dev
```

## 5. Local artifact storage

No setup needed — the local adapter creates its storage directory
(`REPORT_STORAGE_LOCAL_DIR`, default `./storage`, relative to `apps/backend`)
automatically on first write. This directory is never committed to Git.

## 6. New environment variables

All have safe defaults — see `apps/backend/.env.example` for the full,
commented list:

| Variable | Default | Purpose |
|---|---|---|
| `REPORT_STORAGE_LOCAL_DIR` | `./storage` | Local artifact storage root. |
| `REPORT_MAX_ARTIFACT_BYTES` | `26214400` (25MB) | Size cap enforced on write and read. |
| `REPORT_RETENTION_SECONDS` | `604800` (7 days) | `Available → Expired` window. |
| `REPORT_WORKER_POLL_INTERVAL_SECONDS` | `5` | Continuous worker poll interval. |
| `REPORT_WORKER_LEASE_SECONDS` | `120` | Stale-Processing-job threshold. |
| `REPORT_WORKER_HEARTBEAT_SECONDS` | `30` | Must be `<` lease seconds (validated at boot). |
| `REPORT_ARTIFACT_RECONCILIATION_GRACE_SECONDS` | `300` | Must be `>` lease seconds (validated at boot). |
| `REPORT_WORKER_MAX_ATTEMPTS` | `3` | Must be `>= 1` (validated at boot). |
| `REPORT_WORKER_BACKOFF_BASE_SECONDS` | `10` | Must be `> 0` (validated at boot). |
| `REPORT_PORTFOLIO_MAX_ASSETS` | `500` | Bounded portfolio-template size. |

An invalid combination of these (e.g. heartbeat >= lease) causes both the API
server and the worker to refuse to start, with a specific error naming which
invariant failed.

## 7. Platform app

```bash
cd apps/platform
cp .env.local.example .env.local
# real-dev mode:
#   NEXT_PUBLIC_PHOENIX_API_MODE=real-dev
#   NEXT_PUBLIC_PHOENIX_BACKEND_URL=http://localhost:4000
#   NEXT_PUBLIC_PHOENIX_DEV_WORKSPACE_ID=<a real seeded workspace id>
#   NEXT_PUBLIC_PHOENIX_DEV_USER_ID=<a real seeded user id>
#   NEXT_PUBLIC_PHOENIX_DEFAULT_REPORT_TEMPLATE_ID=<a real seeded template id>
pnpm dev
```

## 8. QA scripts referenced in this sprint's documentation

These were written for this sprint's QA and are not part of the shipped
application — they live at the repository root of `apps/backend` during
development and are not committed (see the clean-archive exclusions in the
handoff). To reproduce:
1. Ensure the backend server and a fresh migrated/seeded database are running.
2. Adjust the hardcoded seed IDs at the top of a script if your seed data
   differs.
3. Run with `npx tsx <script-name>.ts` from `apps/backend`.

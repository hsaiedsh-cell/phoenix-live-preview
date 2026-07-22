# Phoenix Backend — Database

**Task IDs:** PHX-BACKEND-001 (schema scaffold), PHX-BACKEND-002 (local
PostgreSQL + migration execution).

**Status:** A local/dev PostgreSQL database can now be provisioned and
the baseline migration executed against it via a manual command. No ORM
is installed. No frontend integration exists. `apps/backend`'s server
still boots and answers `/health`, `/api/health`, `/api/version`, and
`/api/readiness` whether or not a database is configured — see
`src/db/client.ts` and `src/config/env.ts`.

## Quick start (local development)

```bash
cd apps/backend

# 1. Start a local, dev-only PostgreSQL instance.
docker compose up -d

# 2. Point the backend at it and opt in to database checks.
export DATABASE_URL="postgresql://phoenix:phoenix_dev_password@localhost:5432/phoenix_dev"
export PHOENIX_ENABLE_DATABASE=true

# 3. Run the baseline migration (manual command — never runs at boot).
pnpm db:migrate:dev

# 4. Optional — verify the connection and inspect the schema.
pnpm db:smoke:dev

# 5. Start the backend as usual. GET /api/readiness will now report
#    database.status as "connected".
pnpm dev
```

If Docker is not available in your environment, any local PostgreSQL 16
instance works — just point `DATABASE_URL` at it. `docker-compose.yml`
is a convenience, not a requirement.

The `POSTGRES_PASSWORD` in `docker-compose.yml` is a **local development
placeholder only**. It is intentionally simple and checked into this
repository — never reuse it, and never point `DATABASE_URL` at a
non-local database using these credentials.

## What was scaffold-only in PHX-BACKEND-001 and is now real in PHX-BACKEND-002

- A local PostgreSQL instance can be started (`docker-compose.yml`).
- `src/db/client.ts` provides a lazily-created `pg.Pool` and a
  `checkDatabaseConnection()` health check.
- `src/db/migrate.ts` is a minimal raw-SQL migration runner that tracks
  applied migrations (by filename + sha256 checksum) in a
  `schema_migrations` table and can execute `0001_initial_schema.sql`.
- `src/db/smoke.ts` verifies connectivity and reports basic schema stats.
- `GET /api/readiness` reports a real `connected` / `connection_failed`
  status when `PHOENIX_ENABLE_DATABASE=true` and `DATABASE_URL` is set.

None of this connects the frontend to the backend, changes Platform mock
mode, or implements authentication or business endpoints — see
`docs/backend/PHX_BACKEND_002_IMPLEMENTATION_REPORT.md` for the full
scope and constraints of this sprint.

## Contents

- **`schema/PHOENIX_DATABASE_SCHEMA_BASELINE.md`** — entity-by-entity
  documentation (purpose, key fields, relationships, indexes, audit
  considerations, deletion/retention notes) for every table, translated
  from `docs/platform/DATABASE_SCHEMA_PHX_PLATFORM_002.md`.
- **`migrations/0001_initial_schema.sql`** — a PostgreSQL-oriented DDL
  baseline implementing that schema: UUID primary keys, `created_at` /
  `updated_at` / (where applicable) `deleted_at`, foreign keys, and the
  indexes called out in the schema doc.

## Why no ORM (Prisma/Drizzle) this sprint either

PHX-BACKEND-002 introduces a real, lazily-connected `pg.Pool` and a
minimal raw-SQL migration runner (`src/db/migrate.ts`) — but still no
ORM, by explicit task constraint ("Do not add Prisma or Drizzle in this
sprint").

1. **The baseline SQL migration already exists and is now proven.**
   `0001_initial_schema.sql` has been executed against a real local
   PostgreSQL 16 instance as part of this sprint — see
   `docs/backend/PHX_BACKEND_002_MIGRATION_EXECUTION_REPORT.md`. That
   validates the schema without requiring a schema-definition DSL.
2. **Minimal dependency footprint, still.** `pg` + `@types/pg` is the
   entire new dependency surface this sprint. No code generation step,
   no additional build stage.
3. **The hand-authored SQL remains the most reviewable artifact.** Now
   that it has actually been run, it is both the schema of record and a
   proven migration — the natural literal first migration for whichever
   ORM (if any) is introduced in a future sprint.

**Recommended next step (future sprint, not this one):** once real query
patterns exist (business endpoints reading/writing these tables),
introduce Drizzle or Prisma as a deliberate, separate decision.

## Running the migration

```bash
cd apps/backend
docker compose up -d   # or point DATABASE_URL at any local PostgreSQL 16
export DATABASE_URL="postgresql://phoenix:phoenix_dev_password@localhost:5432/phoenix_dev"
export PHOENIX_ENABLE_DATABASE=true
pnpm db:migrate:dev
```

`src/db/migrate.ts` is the only thing that executes this file. It is
never invoked at backend startup (see `src/index.ts` / `src/server.ts`)
— it is a manual, explicit command only. Migrations are tracked by
filename and a sha256 checksum of file content in a `schema_migrations`
table; re-running `db:migrate:dev` after the first successful run skips
already-applied migrations and is safe.

## Non-goals of this sprint

- No row-level security policies.
- No seed data.
- No connection pooling tuning beyond `pg.Pool` defaults.
- No ORM (Prisma, Drizzle) — raw SQL + `pg` only, by explicit constraint.
- No execution of the `audit_records` `REVOKE`/trigger defense-in-depth
  noted as a TODO at the bottom of `0001_initial_schema.sql`.
- No business endpoints reading/writing these tables.
- No authentication.
- No frontend/backend integration — Platform stays in mock mode.

All of the above are reasonable candidates for future sprints.

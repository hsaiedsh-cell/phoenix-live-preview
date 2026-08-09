-- ============================================================
-- Phoenix Backend — Migration 0009: PostgREST security hardening
-- PHX-LAUNCH-002-R8
-- ------------------------------------------------------------
-- Backend tables are accessed only through the authenticated Phoenix
-- Backend over its server-side PostgreSQL connection. They are not a
-- public Supabase Data API. Supabase grants its `anon` and
-- `authenticated` roles privileges on new public-schema tables by
-- default, so every Backend-owned table must fail closed through both
-- RLS and explicit privilege revocation.
-- ============================================================

DO $$
DECLARE
  exposed_role TEXT;
  backend_table TEXT;
  backend_tables CONSTANT TEXT[] := ARRAY[
    'activity_logs',
    'assessment_steps',
    'assessments',
    'asset_versions',
    'assets',
    'audit_records',
    'auth_identities',
    'departments',
    'derived_signals',
    'evidence_items',
    'intake_workspace_handoffs',
    'integrations',
    'notifications',
    'onboarding_invitation_deliveries',
    'onboarding_invitations',
    'organizations',
    'pbrs_certifications',
    'pbrs_dimension_scores',
    'pbrs_passports',
    'pbrs_scores',
    'report_artifacts',
    'report_generation_jobs',
    'report_templates',
    'reports',
    'users',
    'workspace_users',
    'workspaces'
  ];
BEGIN
  -- Preview environments created before the report-job migration may not
  -- contain every table yet. Secure the tables that exist; future tables
  -- are covered by the default-privilege revocation below.
  FOREACH backend_table IN ARRAY backend_tables LOOP
    IF to_regclass(format('public.%I', backend_table)) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
        backend_table
      );
    END IF;
  END LOOP;

  FOREACH exposed_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = exposed_role) THEN
      FOREACH backend_table IN ARRAY backend_tables LOOP
        IF to_regclass(format('public.%I', backend_table)) IS NOT NULL THEN
          EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I',
            backend_table,
            exposed_role
          );
        END IF;
      END LOOP;

      -- Prevent later Backend migrations run by this same owner from
      -- recreating the PostgREST exposure on newly-created tables.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        exposed_role
      );
    END IF;
  END LOOP;
END;
$$;

-- Fix the two mutable-search-path findings without changing trigger
-- behavior. `pg_catalog` is resolved first and application tables are
-- deliberately constrained to `public`.
ALTER FUNCTION public.enforce_intake_workspace_handoff_immutability()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.enforce_onboarding_invitation_lifecycle()
  SET search_path = pg_catalog, public;

-- `citext` remains in public for this migration. Moving an installed
-- extension is a separate compatibility change and is not required to
-- close the exposed-table findings.

-- Make the 26 Jul 2026 RLS incident structurally impossible to repeat.
--
-- Background: push_dispatch_queue and host_join_notification_batches shipped
-- without RLS and were readable and writable with the public anon key. The
-- cause is visible in one file: 20260407120000_add_web_push_notifications.sql
-- creates three tables and enables RLS on exactly two of them.
--
--     1:   CREATE TABLE ... public.push_subscriptions
--     20:  CREATE TABLE ... public.notification_preferences
--     32:  CREATE TABLE ... public.push_dispatch_queue      <-- never enabled
--     331: ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
--     332: ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
--
-- One missing line, 114 days of exposure, and nothing anywhere in review, CI or
-- deploy that would notice. 20260729090000_enable_rls_on_push_dispatch_tables.sql
-- fixed the two tables; this migration addresses the cause.
--
-- Two independent controls:
--   1. New tables no longer receive anon/authenticated grants automatically.
--   2. An event trigger enables RLS on every new public table at creation.
--
-- Either alone would have prevented this. With both, the April migration would
-- have been harmless.
--
-- WORKFLOW CHANGE, please read: this project drives most reads from the browser
-- with the anon key, so it matters here. EXISTING tables and their grants are
-- untouched, and nothing about the current app changes. But a NEW public table
-- that needs to be reachable from the browser now needs BOTH an explicit GRANT
-- to anon and/or authenticated AND an RLS policy. A forgotten grant fails
-- closed and visibly in development instead of silently exposing data.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Stop handing anon and authenticated a blanket grant on every new table.
-- ---------------------------------------------------------------------------
-- pg_default_acl carries two entries for schema public, one per grantor role:
-- supabase_admin and postgres. Only the grantor's own entry applies to objects
-- it creates. Migrations, the SQL editor and the dashboard all run as postgres,
-- so the postgres entry is the one that governs tables we create. The
-- supabase_admin entry cannot be altered from this role (permission denied,
-- verified) and covers Supabase-internal objects only.
--
-- service_role is deliberately untouched; the push-dispatch edge function
-- depends on it and it bypasses RLS anyway.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Enable RLS automatically on every new public table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_rls_on_new_public_tables()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    obj record;
BEGIN
    FOR obj IN
        SELECT ddl.objid, ddl.object_identity
        FROM pg_event_trigger_ddl_commands() AS ddl
        WHERE ddl.command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
          AND ddl.object_type = 'table'
          AND ddl.schema_name = 'public'
    LOOP
        -- Tables belonging to an extension are not ours to alter, and failing
        -- here would break extension installation.
        IF EXISTS (
            SELECT 1
            FROM pg_depend d
            WHERE d.classid = 'pg_class'::regclass
              AND d.objid = obj.objid
              AND d.deptype = 'e'
        ) THEN
            CONTINUE;
        END IF;

        BEGIN
            EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
            RAISE NOTICE 'RLS automatically enabled on %', obj.object_identity;
        EXCEPTION WHEN OTHERS THEN
            -- Warn rather than abort. Blocking a deploy because the guard
            -- tripped would be worse than the gap it leaves, and the nightly
            -- security audit in lalo-admin catches anything that slips past.
            RAISE WARNING 'Could not auto-enable RLS on %: %', obj.object_identity, SQLERRM;
        END;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION public.enforce_rls_on_new_public_tables() IS
    'Enables RLS on newly created public tables. Added after the 26 Jul 2026 incident where push_dispatch_queue shipped without RLS and was readable with the public anon key.';

DROP EVENT TRIGGER IF EXISTS trg_enforce_rls_on_new_public_tables;
CREATE EVENT TRIGGER trg_enforce_rls_on_new_public_tables
    ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    EXECUTE FUNCTION public.enforce_rls_on_new_public_tables();

-- Note: FORCE ROW LEVEL SECURITY is deliberately never set here. Without it the
-- table owner and SECURITY DEFINER functions stay exempt, which is what keeps
-- the six definer functions behind the push pipeline working.

COMMIT;

-- Enable Row-Level Security on the two public tables that were missing it.
--
-- Supabase's security advisor flagged these as `rls_disabled_in_public` on
-- 26 Jul 2026. Since Supabase grants `anon` and `authenticated` full CRUD on
-- public tables by default, RLS being off let anyone with the anon key read
-- and write them over PostgREST. Verified live: an unauthenticated GET
-- returned rows from push_dispatch_queue.
--
-- Every other public table in this project already has RLS enabled; these two
-- were introduced by 20260407120000_add_web_push_notifications.sql and
-- 20260412172000_batch_host_join_notifications.sql without an ENABLE.
--
-- No policies are added on purpose. Both tables are reached only by the
-- push-dispatch edge function (service_role, which has BYPASSRLS) and by these
-- SECURITY DEFINER functions owned by postgres:
--   enqueue_notification_for_push_dispatch, enqueue_host_join_notification_batch,
--   flush_host_join_notification_batches, invoke_host_join_batch_flush,
--   requeue_stale_push_dispatch_jobs, get_my_push_diagnostics
-- Definer functions run as the table owner and are exempt from RLS, so the
-- notification pipeline is unaffected.
--
-- Note: FORCE ROW LEVEL SECURITY is deliberately NOT set, which is what keeps
-- the definer functions above exempt.

BEGIN;

ALTER TABLE public.push_dispatch_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_dispatch_queue FROM anon, authenticated;

ALTER TABLE public.host_join_notification_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.host_join_notification_batches FROM anon, authenticated;

COMMIT;

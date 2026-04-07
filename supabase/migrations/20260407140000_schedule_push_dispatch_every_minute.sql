CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

CREATE OR REPLACE FUNCTION public.invoke_push_dispatch()
RETURNS BIGINT AS $$
DECLARE
    v_request_id BIGINT;
    v_dispatch_secret TEXT;
    v_function_url TEXT := 'https://qxktbdjzhctfxnafiaxk.functions.supabase.co/push-dispatch';
BEGIN
    SELECT ds.decrypted_secret
    INTO v_dispatch_secret
    FROM vault.decrypted_secrets ds
    WHERE ds.name = 'push_dispatch_secret'
    ORDER BY ds.updated_at DESC NULLS LAST, ds.created_at DESC
    LIMIT 1;

    IF COALESCE(v_dispatch_secret, '') = '' THEN
        RAISE EXCEPTION 'Vault secret "push_dispatch_secret" is required before scheduling push dispatch.';
    END IF;

    SELECT net.http_post(
        url := v_function_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-push-dispatch-secret', v_dispatch_secret
        ),
        body := jsonb_build_object('limit', 20)
    )
    INTO v_request_id;

    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions;

DO $$
DECLARE
    v_job_id BIGINT;
BEGIN
    SELECT jobid
    INTO v_job_id
    FROM cron.job
    WHERE jobname = 'push-dispatch-every-minute'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
        'push-dispatch-every-minute',
        '* * * * *',
        $cron$SELECT public.invoke_push_dispatch();$cron$
    );
END $$;

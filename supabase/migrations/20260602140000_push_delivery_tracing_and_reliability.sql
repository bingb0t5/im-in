-- Push delivery tracing, retry, immediate dispatch, and subscription hygiene.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.push_dispatch_queue
    ADD COLUMN IF NOT EXISTS dispatch_attempted_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS dispatch_success_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS dispatch_failed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS delivery_trace JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS push_dispatch_queue_processing_stuck_idx
    ON public.push_dispatch_queue (dispatch_attempted_at ASC)
    WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS push_dispatch_queue_failed_retry_idx
    ON public.push_dispatch_queue (dispatch_failed_at ASC, attempts ASC)
    WHERE status = 'failed';

ALTER TABLE public.push_subscriptions
    ADD COLUMN IF NOT EXISTS endpoint_hash TEXT NULL;

CREATE INDEX IF NOT EXISTS push_subscriptions_endpoint_hash_idx
    ON public.push_subscriptions (endpoint_hash)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.push_delivery_receipts (
    id BIGSERIAL PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    displayed_at TIMESTAMPTZ NULL,
    skip_reason TEXT NULL,
    client_platform TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (notification_id, recipient_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS push_delivery_receipts_recipient_received_idx
    ON public.push_delivery_receipts (recipient_user_id, received_at DESC);

CREATE OR REPLACE FUNCTION public.hash_push_endpoint(p_endpoint TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN encode(digest(trim(COALESCE(p_endpoint, '')), 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.requeue_stale_push_dispatch_jobs(
    p_processing_stale_after INTERVAL DEFAULT interval '5 minutes',
    p_failed_retry_after INTERVAL DEFAULT interval '2 minutes',
    p_max_attempts INTEGER DEFAULT 5
) RETURNS JSONB AS $$
DECLARE
    v_requeued_processing INTEGER := 0;
    v_requeued_failed INTEGER := 0;
BEGIN
    UPDATE public.push_dispatch_queue q
    SET
        status = 'pending',
        last_error = COALESCE(q.last_error, 'Requeued after stale processing state.')
    WHERE q.status = 'processing'
      AND q.dispatch_attempted_at IS NOT NULL
      AND q.dispatch_attempted_at <= now() - p_processing_stale_after;

    GET DIAGNOSTICS v_requeued_processing = ROW_COUNT;

    UPDATE public.push_dispatch_queue q
    SET
        status = 'pending',
        last_error = COALESCE(q.last_error, 'Retrying failed push dispatch.')
    WHERE q.status = 'failed'
      AND q.attempts < p_max_attempts
      AND COALESCE(q.dispatch_failed_at, q.processed_at, q.created_at) <= now() - p_failed_retry_after;

    GET DIAGNOSTICS v_requeued_failed = ROW_COUNT;

    RETURN jsonb_build_object(
        'requeued_processing', v_requeued_processing,
        'requeued_failed', v_requeued_failed
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.trigger_immediate_push_dispatch()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM public.invoke_push_dispatch();
    RETURN NEW;
EXCEPTION
    WHEN others THEN
        RAISE WARNING 'Immediate push dispatch trigger failed: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions;

DROP TRIGGER IF EXISTS trg_immediate_push_dispatch_on_enqueue ON public.push_dispatch_queue;
CREATE TRIGGER trg_immediate_push_dispatch_on_enqueue
AFTER INSERT ON public.push_dispatch_queue
FOR EACH ROW
WHEN (NEW.status = 'pending')
EXECUTE FUNCTION public.trigger_immediate_push_dispatch();

CREATE OR REPLACE FUNCTION public.invoke_push_dispatch()
RETURNS BIGINT AS $$
DECLARE
    v_request_id BIGINT;
    v_dispatch_secret TEXT;
    v_function_url TEXT := 'https://qxktbdjzhctfxnafiaxk.functions.supabase.co/push-dispatch';
BEGIN
    PERFORM public.requeue_stale_push_dispatch_jobs();

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
        body := jsonb_build_object('limit', 100)
    )
    INTO v_request_id;

    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions;

CREATE OR REPLACE FUNCTION public.upsert_my_push_subscription(
    p_endpoint TEXT,
    p_p256dh TEXT,
    p_auth TEXT,
    p_user_agent TEXT DEFAULT NULL,
    p_platform TEXT DEFAULT NULL,
    p_is_standalone BOOLEAN DEFAULT false
) RETURNS public.push_subscriptions AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_row public.push_subscriptions%ROWTYPE;
    v_endpoint TEXT := trim(COALESCE(p_endpoint, ''));
    v_endpoint_hash TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF COALESCE(v_endpoint, '') = ''
       OR COALESCE(nullif(trim(p_p256dh), ''), '') = ''
       OR COALESCE(nullif(trim(p_auth), ''), '') = '' THEN
        RAISE EXCEPTION 'Push subscription payload is incomplete.';
    END IF;

    IF COALESCE(p_is_standalone, false) = false THEN
        RAISE EXCEPTION 'Push notifications are only available in the installed app.';
    END IF;

    PERFORM public.assert_user_has_whatsapp_link(v_user_id);

    v_endpoint_hash := public.hash_push_endpoint(v_endpoint);

    UPDATE public.push_subscriptions ps
    SET revoked_at = now(), updated_at = now()
    WHERE ps.user_id = v_user_id
      AND ps.revoked_at IS NULL
      AND ps.endpoint <> v_endpoint
      AND ps.last_seen_at < now() - interval '60 days';

    INSERT INTO public.push_subscriptions (
        user_id,
        endpoint,
        endpoint_hash,
        p256dh,
        auth,
        user_agent,
        platform,
        is_standalone,
        last_seen_at,
        revoked_at
    )
    VALUES (
        v_user_id,
        v_endpoint,
        v_endpoint_hash,
        trim(p_p256dh),
        trim(p_auth),
        nullif(trim(COALESCE(p_user_agent, '')), ''),
        nullif(trim(COALESCE(p_platform, '')), ''),
        true,
        now(),
        NULL
    )
    ON CONFLICT (endpoint) DO UPDATE
    SET
        user_id = EXCLUDED.user_id,
        endpoint_hash = EXCLUDED.endpoint_hash,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        platform = EXCLUDED.platform,
        is_standalone = EXCLUDED.is_standalone,
        last_seen_at = now(),
        revoked_at = NULL,
        updated_at = now()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.record_my_push_delivery_receipt(
    p_notification_id UUID,
    p_idempotency_key TEXT,
    p_received_at TIMESTAMPTZ DEFAULT now(),
    p_displayed_at TIMESTAMPTZ DEFAULT NULL,
    p_skip_reason TEXT DEFAULT NULL,
    p_client_platform TEXT DEFAULT NULL
) RETURNS public.push_delivery_receipts AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_row public.push_delivery_receipts%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_notification_id IS NULL OR COALESCE(nullif(trim(p_idempotency_key), ''), '') = '' THEN
        RAISE EXCEPTION 'Notification id and idempotency key are required.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.id = p_notification_id
          AND n.recipient_user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Notification not found for current user.';
    END IF;

    INSERT INTO public.push_delivery_receipts (
        notification_id,
        recipient_user_id,
        idempotency_key,
        received_at,
        displayed_at,
        skip_reason,
        client_platform
    )
    VALUES (
        p_notification_id,
        v_user_id,
        trim(p_idempotency_key),
        COALESCE(p_received_at, now()),
        p_displayed_at,
        nullif(trim(COALESCE(p_skip_reason, '')), ''),
        nullif(trim(COALESCE(p_client_platform, '')), '')
    )
    ON CONFLICT (notification_id, recipient_user_id, idempotency_key)
    DO UPDATE
    SET
        received_at = LEAST(public.push_delivery_receipts.received_at, EXCLUDED.received_at),
        displayed_at = COALESCE(public.push_delivery_receipts.displayed_at, EXCLUDED.displayed_at),
        skip_reason = COALESCE(public.push_delivery_receipts.skip_reason, EXCLUDED.skip_reason),
        client_platform = COALESCE(EXCLUDED.client_platform, public.push_delivery_receipts.client_platform)
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_my_push_diagnostics()
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_subscriptions JSONB := '[]'::jsonb;
    v_recent_queue JSONB := '[]'::jsonb;
    v_recent_receipts JSONB := '[]'::jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(ps) ORDER BY ps.last_seen_at DESC), '[]'::jsonb)
    INTO v_subscriptions
    FROM public.push_subscriptions ps
    WHERE ps.user_id = v_user_id;

    SELECT COALESCE(
        jsonb_agg(row_data ORDER BY row_data->>'created_at' DESC),
        '[]'::jsonb
    )
    INTO v_recent_queue
    FROM (
        SELECT jsonb_build_object(
            'queue_id', q.id,
            'notification_id', q.notification_id,
            'status', q.status,
            'attempts', q.attempts,
            'scheduled_at', q.scheduled_at,
            'dispatch_attempted_at', q.dispatch_attempted_at,
            'dispatch_success_at', q.dispatch_success_at,
            'dispatch_failed_at', q.dispatch_failed_at,
            'processed_at', q.processed_at,
            'last_error', q.last_error,
            'notification_type', n.type,
            'notification_created_at', n.created_at,
            'delivery_trace', q.delivery_trace,
            'created_at', q.created_at
        ) AS row_data
        FROM public.push_dispatch_queue q
        JOIN public.notifications n ON n.id = q.notification_id
        WHERE q.recipient_user_id = v_user_id
        ORDER BY q.created_at DESC
        LIMIT 25
    ) queue_rows;

    SELECT COALESCE(
        jsonb_agg(to_jsonb(r) ORDER BY r.received_at DESC),
        '[]'::jsonb
    )
    INTO v_recent_receipts
    FROM (
        SELECT *
        FROM public.push_delivery_receipts pr
        WHERE pr.recipient_user_id = v_user_id
        ORDER BY pr.received_at DESC
        LIMIT 25
    ) r;

    RETURN jsonb_build_object(
        'subscriptions', v_subscriptions,
        'recent_queue', v_recent_queue,
        'recent_receipts', v_recent_receipts
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

ALTER TABLE public.push_delivery_receipts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'push_delivery_receipts'
          AND policyname = 'Users can read their own push delivery receipts'
    ) THEN
        CREATE POLICY "Users can read their own push delivery receipts"
            ON public.push_delivery_receipts
            FOR SELECT
            TO authenticated
            USING (auth.uid() = recipient_user_id);
    END IF;
END $$;

GRANT SELECT ON public.push_delivery_receipts TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_my_push_delivery_receipt(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_push_diagnostics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_stale_push_dispatch_jobs(INTERVAL, INTERVAL, INTEGER) TO service_role;

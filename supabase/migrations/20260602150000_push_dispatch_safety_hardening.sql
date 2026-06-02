-- Safety hardening: debounced immediate dispatch, stuck-row recovery, redacted diagnostics.

CREATE TABLE IF NOT EXISTS public.push_dispatch_coordinator (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_invoked_at TIMESTAMPTZ NULL
);

INSERT INTO public.push_dispatch_coordinator (id, last_invoked_at)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

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
      AND (
        (q.dispatch_attempted_at IS NOT NULL AND q.dispatch_attempted_at <= now() - p_processing_stale_after)
        OR (q.dispatch_attempted_at IS NULL AND q.created_at <= now() - p_processing_stale_after)
      );

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
DECLARE
    v_should_invoke BOOLEAN := false;
BEGIN
    UPDATE public.push_dispatch_coordinator c
    SET last_invoked_at = now()
    WHERE c.id = 1
      AND (
        c.last_invoked_at IS NULL
        OR c.last_invoked_at <= now() - interval '5 seconds'
      )
    RETURNING true INTO v_should_invoke;

    IF NOT COALESCE(v_should_invoke, false) THEN
        RETURN NEW;
    END IF;

    BEGIN
        PERFORM public.invoke_push_dispatch();
    EXCEPTION
        WHEN others THEN
            RAISE WARNING 'Immediate push dispatch invoke failed: %', SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault, extensions;

CREATE OR REPLACE FUNCTION public.get_my_push_diagnostics()
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_subscriptions JSONB := '[]'::jsonb;
    v_recent_queue JSONB := '[]'::jsonb;
    v_recent_receipts JSONB := '[]'::jsonb;
    v_last_dispatch_success_at TIMESTAMPTZ := NULL;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', ps.id,
                'endpoint_hash', ps.endpoint_hash,
                'platform', ps.platform,
                'is_standalone', ps.is_standalone,
                'last_seen_at', ps.last_seen_at,
                'revoked_at', ps.revoked_at,
                'created_at', ps.created_at,
                'updated_at', ps.updated_at
            )
            ORDER BY ps.last_seen_at DESC
        ),
        '[]'::jsonb
    )
    INTO v_subscriptions
    FROM public.push_subscriptions ps
    WHERE ps.user_id = v_user_id;

    SELECT MAX(q.dispatch_success_at)
    INTO v_last_dispatch_success_at
    FROM public.push_dispatch_queue q
    WHERE q.recipient_user_id = v_user_id
      AND q.dispatch_success_at IS NOT NULL;

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
        jsonb_agg(
            jsonb_build_object(
                'notification_id', r.notification_id,
                'idempotency_key', r.idempotency_key,
                'received_at', r.received_at,
                'displayed_at', r.displayed_at,
                'skip_reason', r.skip_reason,
                'client_platform', r.client_platform,
                'created_at', r.created_at
            )
            ORDER BY r.received_at DESC
        ),
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
        'last_dispatch_success_at', v_last_dispatch_success_at,
        'recent_queue', v_recent_queue,
        'recent_receipts', v_recent_receipts
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

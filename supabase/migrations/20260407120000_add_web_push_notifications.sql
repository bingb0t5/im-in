CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NULL,
    platform TEXT NULL,
    is_standalone BOOLEAN NOT NULL DEFAULT false,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_active_idx
    ON public.push_subscriptions (user_id, last_seen_at DESC)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    push_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category)
);

CREATE INDEX IF NOT EXISTS notification_preferences_user_idx
    ON public.notification_preferences (user_id);

CREATE TABLE IF NOT EXISTS public.push_dispatch_queue (
    id BIGSERIAL PRIMARY KEY,
    notification_id UUID NOT NULL UNIQUE REFERENCES public.notifications(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_dispatch_queue_pending_idx
    ON public.push_dispatch_queue (status, scheduled_at ASC)
    WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.push_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_push_subscriptions_set_updated_at ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_set_updated_at
BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.push_set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_preferences_set_updated_at ON public.notification_preferences;
CREATE TRIGGER trg_notification_preferences_set_updated_at
BEFORE UPDATE ON public.notification_preferences
FOR EACH ROW
EXECUTE FUNCTION public.push_set_updated_at();

CREATE OR REPLACE FUNCTION public.is_notification_category_valid(p_category TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN COALESCE(p_category, '') = ANY (ARRAY[
        'activity_shared',
        'activity_updated',
        'waitlist_added',
        'waitlist_promoted',
        'attendance_changed',
        'host_message',
        'guest_reply',
        'system'
    ]);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.assert_user_has_whatsapp_link(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_has_link BOOLEAN := false;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.attendee_profiles ap
        WHERE ap.user_id = p_user_id
          AND ap.lalo_user_id IS NOT NULL
          AND nullif(trim(ap.lalo_user_id), '') IS NOT NULL
    ) INTO v_has_link;

    IF NOT v_has_link THEN
        RAISE EXCEPTION 'Push notifications require a linked WhatsApp account.';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF COALESCE(nullif(trim(p_endpoint), ''), '') = ''
       OR COALESCE(nullif(trim(p_p256dh), ''), '') = ''
       OR COALESCE(nullif(trim(p_auth), ''), '') = '' THEN
        RAISE EXCEPTION 'Push subscription payload is incomplete.';
    END IF;

    IF COALESCE(p_is_standalone, false) = false THEN
        RAISE EXCEPTION 'Push notifications are only available in the installed app.';
    END IF;

    PERFORM public.assert_user_has_whatsapp_link(v_user_id);

    INSERT INTO public.push_subscriptions (
        user_id,
        endpoint,
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
        trim(p_endpoint),
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

CREATE OR REPLACE FUNCTION public.revoke_my_push_subscription(
    p_endpoint TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_count INTEGER := 0;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    UPDATE public.push_subscriptions ps
    SET revoked_at = now(), updated_at = now()
    WHERE ps.user_id = v_user_id
      AND ps.revoked_at IS NULL
      AND (
        p_endpoint IS NULL
        OR nullif(trim(p_endpoint), '') IS NULL
        OR ps.endpoint = trim(p_endpoint)
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.list_my_push_subscriptions()
RETURNS SETOF public.push_subscriptions AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN QUERY
    SELECT ps.*
    FROM public.push_subscriptions ps
    WHERE ps.user_id = auth.uid()
    ORDER BY ps.last_seen_at DESC, ps.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.set_my_notification_preference(
    p_category TEXT,
    p_push_enabled BOOLEAN
) RETURNS public.notification_preferences AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_row public.notification_preferences%ROWTYPE;
    v_category TEXT := trim(COALESCE(p_category, ''));
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT public.is_notification_category_valid(v_category) THEN
        RAISE EXCEPTION 'Unsupported notification category: %', v_category;
    END IF;

    INSERT INTO public.notification_preferences (user_id, category, push_enabled)
    VALUES (v_user_id, v_category, COALESCE(p_push_enabled, true))
    ON CONFLICT (user_id, category) DO UPDATE
    SET push_enabled = EXCLUDED.push_enabled, updated_at = now()
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.list_my_notification_preferences()
RETURNS TABLE (
    category TEXT,
    push_enabled BOOLEAN
) AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    RETURN QUERY
    WITH categories AS (
        SELECT unnest(ARRAY[
            'activity_shared',
            'activity_updated',
            'waitlist_added',
            'waitlist_promoted',
            'attendance_changed',
            'host_message',
            'guest_reply',
            'system'
        ]) AS category
    )
    SELECT
        c.category,
        COALESCE(np.push_enabled, true) AS push_enabled
    FROM categories c
    LEFT JOIN public.notification_preferences np
      ON np.user_id = auth.uid()
     AND np.category = c.category
    ORDER BY c.category;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.is_push_enabled_for_notification(
    p_recipient_user_id UUID,
    p_notification_type TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_pref BOOLEAN;
BEGIN
    IF p_recipient_user_id IS NULL THEN
        RETURN false;
    END IF;

    IF NOT public.is_notification_category_valid(trim(COALESCE(p_notification_type, ''))) THEN
        RETURN true;
    END IF;

    SELECT np.push_enabled
    INTO v_pref
    FROM public.notification_preferences np
    WHERE np.user_id = p_recipient_user_id
      AND np.category = trim(COALESCE(p_notification_type, ''))
    LIMIT 1;

    RETURN COALESCE(v_pref, true);
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.enqueue_notification_for_push_dispatch()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.push_dispatch_queue (
        notification_id,
        recipient_user_id,
        status,
        attempts,
        scheduled_at
    )
    VALUES (
        NEW.id,
        NEW.recipient_user_id,
        'pending',
        0,
        now()
    )
    ON CONFLICT (notification_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enqueue_notification_for_push_dispatch ON public.notifications;
CREATE TRIGGER trg_enqueue_notification_for_push_dispatch
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_notification_for_push_dispatch();

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'push_subscriptions'
          AND policyname = 'Users can read their own push subscriptions'
    ) THEN
        CREATE POLICY "Users can read their own push subscriptions"
            ON public.push_subscriptions
            FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'push_subscriptions'
          AND policyname = 'Users can modify their own push subscriptions'
    ) THEN
        CREATE POLICY "Users can modify their own push subscriptions"
            ON public.push_subscriptions
            FOR ALL
            TO authenticated
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'notification_preferences'
          AND policyname = 'Users can read their own notification preferences'
    ) THEN
        CREATE POLICY "Users can read their own notification preferences"
            ON public.notification_preferences
            FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'notification_preferences'
          AND policyname = 'Users can modify their own notification preferences'
    ) THEN
        CREATE POLICY "Users can modify their own notification preferences"
            ON public.notification_preferences
            FOR ALL
            TO authenticated
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_my_push_subscription(TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_push_subscription(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_push_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_my_notification_preference(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_notification_preferences() TO authenticated;

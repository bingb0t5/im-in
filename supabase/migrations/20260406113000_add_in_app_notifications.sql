CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    actor_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    event_id UUID NULL REFERENCES public.events(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_url TEXT NULL,
    action_label TEXT NULL,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_at_idx
    ON public.notifications (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_unread_recipient_created_at_idx
    ON public.notifications (recipient_user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_event_created_at_idx
    ON public.notifications (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_type_created_at_idx
    ON public.notifications (type, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'notifications'
          AND policyname = 'Users can read their own notifications'
    ) THEN
        CREATE POLICY "Users can read their own notifications"
            ON public.notifications
            FOR SELECT
            TO authenticated
            USING (auth.uid() = recipient_user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'notifications'
          AND policyname = 'Users can update their own notifications'
    ) THEN
        CREATE POLICY "Users can update their own notifications"
            ON public.notifications
            FOR UPDATE
            TO authenticated
            USING (auth.uid() = recipient_user_id)
            WITH CHECK (auth.uid() = recipient_user_id);
    END IF;
END $$;

GRANT SELECT, UPDATE ON public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.create_notification(
    p_recipient_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_event_id UUID DEFAULT NULL,
    p_actor_user_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_action_url TEXT DEFAULT NULL,
    p_action_label TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_notification_id UUID;
BEGIN
    IF p_recipient_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.notifications (
        recipient_user_id,
        actor_user_id,
        event_id,
        type,
        title,
        message,
        metadata,
        action_url,
        action_label
    )
    VALUES (
        p_recipient_user_id,
        p_actor_user_id,
        p_event_id,
        p_type,
        p_title,
        p_message,
        COALESCE(p_metadata, '{}'::jsonb),
        p_action_url,
        p_action_label
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.create_notification(UUID, TEXT, TEXT, TEXT, UUID, UUID, JSONB, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_my_notification_read(
    p_notification_id UUID
) RETURNS public.notifications AS $$
DECLARE
    v_row public.notifications%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    UPDATE public.notifications n
    SET read_at = COALESCE(n.read_at, now())
    WHERE n.id = p_notification_id
      AND n.recipient_user_id = auth.uid()
    RETURNING n.* INTO v_row;

    RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.mark_my_notification_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_my_notifications_read()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    UPDATE public.notifications n
    SET read_at = COALESCE(n.read_at, now())
    WHERE n.recipient_user_id = auth.uid()
      AND n.read_at IS NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.mark_all_my_notifications_read() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_notification_read_only_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
       OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
       OR NEW.event_id IS DISTINCT FROM OLD.event_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.message IS DISTINCT FROM OLD.message
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.action_url IS DISTINCT FROM OLD.action_url
       OR NEW.action_label IS DISTINCT FROM OLD.action_label
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Only read_at can be updated on notifications';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_enforce_notification_read_only_update ON public.notifications;
CREATE TRIGGER trg_enforce_notification_read_only_update
BEFORE UPDATE ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.enforce_notification_read_only_update();

CREATE OR REPLACE FUNCTION public.host_list_notification_recipients(
    p_event_id UUID
) RETURNS TABLE (
    user_id UUID,
    display_name TEXT,
    email TEXT,
    source TEXT,
    attendee_status TEXT
) AS $$
BEGIN
    IF p_event_id IS NULL THEN
        RETURN;
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RAISE EXCEPTION 'Not authorized to list notification recipients';
    END IF;

    RETURN QUERY
    WITH attendees AS (
        SELECT
            COALESCE(ea.user_id, ap.user_id) AS user_id,
            ea.guest_name,
            ea.guest_email,
            ea.status,
            'attendee'::TEXT AS source
        FROM public.event_attendees ea
        LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
        WHERE ea.event_id = p_event_id
          AND ea.status <> 'cancelled'
          AND COALESCE(ea.user_id, ap.user_id) IS NOT NULL
    ),
    shared AS (
        SELECT
            es.user_id,
            NULL::TEXT AS guest_name,
            NULL::TEXT AS guest_email,
            NULL::TEXT AS status,
            'shared'::TEXT AS source
        FROM public.event_shared_with_users es
        WHERE es.event_id = p_event_id
    ),
    combined AS (
        SELECT * FROM attendees
        UNION ALL
        SELECT * FROM shared
    ),
    deduped AS (
        SELECT
            c.user_id,
            min(c.guest_name) FILTER (WHERE nullif(trim(coalesce(c.guest_name, '')), '') IS NOT NULL) AS guest_name,
            min(c.guest_email) FILTER (WHERE nullif(trim(coalesce(c.guest_email, '')), '') IS NOT NULL) AS guest_email,
            string_agg(DISTINCT c.source, ', ' ORDER BY c.source) AS source,
            min(c.status) FILTER (WHERE c.status IS NOT NULL) AS attendee_status
        FROM combined c
        GROUP BY c.user_id
    ),
    profile_best AS (
        SELECT DISTINCT ON (ap.user_id)
            ap.user_id,
            ap.full_name,
            ap.first_name,
            ap.last_name,
            ap.email
        FROM public.attendee_profiles ap
        WHERE ap.user_id IN (SELECT d.user_id FROM deduped d)
        ORDER BY ap.user_id, ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
    )
    SELECT
        d.user_id,
        COALESCE(
            NULLIF(trim(p.full_name), ''),
            NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
            NULLIF(trim(d.guest_name), ''),
            NULLIF(trim(regexp_replace(split_part(COALESCE(p.email, d.guest_email, ''), '@', 1), '[._-]+', ' ', 'g')), ''),
            'Community member'
        ) AS display_name,
        COALESCE(p.email, d.guest_email) AS email,
        d.source,
        d.attendee_status
    FROM deduped d
    LEFT JOIN profile_best p ON p.user_id = d.user_id
    WHERE d.user_id <> auth.uid()
      AND NOT public.is_event_host(p_event_id, d.user_id)
    ORDER BY
        CASE WHEN d.attendee_status = 'confirmed' THEN 0 WHEN d.attendee_status = 'waitlist' THEN 1 ELSE 2 END,
        display_name ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_list_notification_recipients(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_send_activity_notification(
    p_event_id UUID,
    p_target TEXT DEFAULT 'all_access',
    p_user_ids UUID[] DEFAULT NULL,
    p_title TEXT DEFAULT NULL,
    p_message TEXT DEFAULT NULL,
    p_action_url TEXT DEFAULT NULL,
    p_action_label TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_target TEXT := lower(trim(coalesce(p_target, 'all_access')));
    v_title TEXT := nullif(trim(coalesce(p_title, '')), '');
    v_message TEXT := nullif(trim(coalesce(p_message, '')), '');
    v_event_title TEXT;
    v_submitted_count INTEGER := 0;
    v_sent_count INTEGER := 0;
BEGIN
    IF p_event_id IS NULL THEN
        RETURN json_build_object('error', 'Missing event');
    END IF;

    IF auth.uid() IS NULL OR NOT public.is_event_host(p_event_id, auth.uid()) THEN
        RETURN json_build_object('error', 'Not authorized to send notifications for this activity');
    END IF;

    IF v_target NOT IN ('all_access', 'confirmed', 'waitlist', 'selected') THEN
        RETURN json_build_object('error', 'Invalid target');
    END IF;

    IF v_message IS NULL THEN
        RETURN json_build_object('error', 'Message is required');
    END IF;

    SELECT e.title
    INTO v_event_title
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_event_title IS NULL THEN
        RETURN json_build_object('error', 'Activity not found');
    END IF;

    IF v_title IS NULL THEN
        v_title := format('Message from host: %s', v_event_title);
    END IF;

    WITH recipients AS (
        SELECT r.user_id, r.attendee_status
        FROM public.host_list_notification_recipients(p_event_id) r
        WHERE (
            v_target = 'all_access'
            OR (v_target = 'confirmed' AND r.attendee_status = 'confirmed')
            OR (v_target = 'waitlist' AND r.attendee_status = 'waitlist')
            OR (v_target = 'selected' AND r.user_id = ANY(COALESCE(p_user_ids, ARRAY[]::UUID[])))
        )
    ),
    inserted AS (
        INSERT INTO public.notifications (
            recipient_user_id,
            actor_user_id,
            event_id,
            type,
            title,
            message,
            metadata,
            action_url,
            action_label
        )
        SELECT
            r.user_id,
            auth.uid(),
            p_event_id,
            'host_message',
            v_title,
            v_message,
            jsonb_build_object(
                'target', v_target,
                'event_title', v_event_title,
                'attendee_status', r.attendee_status
            ),
            p_action_url,
            p_action_label
        FROM recipients r
        RETURNING 1
    )
    SELECT
        (SELECT count(*) FROM recipients),
        (SELECT count(*) FROM inserted)
    INTO
        v_submitted_count,
        v_sent_count;

    RETURN json_build_object(
        'success', true,
        'submitted_count', v_submitted_count,
        'sent_count', v_sent_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.host_send_activity_notification(UUID, TEXT, UUID[], TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_event_shared_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_event_title TEXT;
    v_event_slug TEXT;
BEGIN
    SELECT
        e.title,
        COALESCE(NULLIF(trim(e.private_slug), ''), NULLIF(trim(e.join_code), ''), COALESCE(e.public_slug, e.slug))
    INTO
        v_event_title,
        v_event_slug
    FROM public.events e
    WHERE e.id = NEW.event_id;

    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM public.create_notification(
        NEW.user_id,
        'activity_shared',
        format('Activity shared with you: %s', COALESCE(v_event_title, 'Activity')),
        format('A host shared %s with you.', COALESCE(v_event_title, 'an activity')),
        NEW.event_id,
        NULL,
        jsonb_build_object('source', NEW.source),
        CASE WHEN v_event_slug IS NOT NULL THEN format('/events/%s', v_event_slug) ELSE NULL END,
        'Open activity'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_notify_event_shared_insert ON public.event_shared_with_users;
CREATE TRIGGER trg_notify_event_shared_insert
AFTER INSERT ON public.event_shared_with_users
FOR EACH ROW
EXECUTE FUNCTION public.notify_event_shared_insert();

CREATE OR REPLACE FUNCTION public.notify_event_updated()
RETURNS TRIGGER AS $$
DECLARE
    v_changed_fields TEXT[] := ARRAY[]::TEXT[];
    v_event_slug TEXT;
    v_event_title TEXT;
BEGIN
    IF NEW.id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
        v_changed_fields := array_append(v_changed_fields, 'date_time');
    END IF;
    IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN
        v_changed_fields := array_append(v_changed_fields, 'timezone');
    END IF;
    IF NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN
        v_changed_fields := array_append(v_changed_fields, 'duration');
    END IF;
    IF NEW.location_text IS DISTINCT FROM OLD.location_text THEN
        v_changed_fields := array_append(v_changed_fields, 'location');
    END IF;
    IF NEW.public_location_text IS DISTINCT FROM OLD.public_location_text THEN
        v_changed_fields := array_append(v_changed_fields, 'public_location');
    END IF;
    IF NEW.description IS DISTINCT FROM OLD.description THEN
        v_changed_fields := array_append(v_changed_fields, 'description');
    END IF;
    IF NEW.public_summary IS DISTINCT FROM OLD.public_summary THEN
        v_changed_fields := array_append(v_changed_fields, 'summary');
    END IF;
    IF NEW.title IS DISTINCT FROM OLD.title THEN
        v_changed_fields := array_append(v_changed_fields, 'title');
    END IF;

    IF COALESCE(array_length(v_changed_fields, 1), 0) = 0 THEN
        RETURN NEW;
    END IF;

    v_event_title := COALESCE(NEW.title, OLD.title, 'Activity');
    v_event_slug := COALESCE(NULLIF(trim(NEW.private_slug), ''), NULLIF(trim(NEW.join_code), ''), COALESCE(NEW.public_slug, NEW.slug));

    INSERT INTO public.notifications (
        recipient_user_id,
        actor_user_id,
        event_id,
        type,
        title,
        message,
        metadata,
        action_url,
        action_label
    )
    SELECT
        recipients.user_id,
        NEW.host_user_id,
        NEW.id,
        'activity_updated',
        format('Activity updated: %s', v_event_title),
        format('Important details changed for %s.', v_event_title),
        jsonb_build_object(
            'changed_fields', v_changed_fields,
            'event_title', v_event_title
        ),
        CASE WHEN v_event_slug IS NOT NULL THEN format('/events/%s', v_event_slug) ELSE NULL END,
        'View updates'
    FROM (
        SELECT DISTINCT x.user_id
        FROM (
            SELECT es.user_id
            FROM public.event_shared_with_users es
            WHERE es.event_id = NEW.id
            UNION ALL
            SELECT COALESCE(ea.user_id, ap.user_id) AS user_id
            FROM public.event_attendees ea
            LEFT JOIN public.attendee_profiles ap ON ap.id = ea.attendee_profile_id
            WHERE ea.event_id = NEW.id
              AND ea.status IN ('confirmed', 'waitlist', 'pending_approval')
        ) x
        WHERE x.user_id IS NOT NULL
          AND x.user_id <> NEW.host_user_id
    ) recipients;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_notify_event_updated ON public.events;
CREATE TRIGGER trg_notify_event_updated
AFTER UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.notify_event_updated();

CREATE OR REPLACE FUNCTION public.notify_attendee_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_event_title TEXT;
    v_event_slug TEXT;
    v_event_host UUID;
    v_type TEXT;
    v_title TEXT;
    v_message TEXT;
BEGIN
    SELECT
        e.title,
        COALESCE(NULLIF(trim(e.private_slug), ''), NULLIF(trim(e.join_code), ''), COALESCE(e.public_slug, e.slug)),
        e.host_user_id
    INTO
        v_event_title,
        v_event_slug,
        v_event_host
    FROM public.events e
    WHERE e.id = COALESCE(NEW.event_id, OLD.event_id);

    v_user_id := COALESCE(
        NEW.user_id,
        OLD.user_id,
        (
            SELECT ap.user_id
            FROM public.attendee_profiles ap
            WHERE ap.id = COALESCE(NEW.attendee_profile_id, OLD.attendee_profile_id)
            LIMIT 1
        )
    );

    IF v_user_id IS NULL OR v_user_id = v_event_host THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'waitlist' THEN
            v_type := 'waitlist_added';
            v_title := format('You joined the waitlist: %s', COALESCE(v_event_title, 'Activity'));
            v_message := format('You are currently on the waitlist for %s.', COALESCE(v_event_title, 'this activity'));
        ELSIF NEW.status IN ('confirmed', 'pending_approval') THEN
            v_type := 'attendance_changed';
            v_title := format('Attendance updated: %s', COALESCE(v_event_title, 'Activity'));
            v_message := format('Your attendance status is now %s for %s.', NEW.status, COALESCE(v_event_title, 'this activity'));
        ELSE
            RETURN NEW;
        END IF;
    ELSE
        IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
            RETURN NEW;
        END IF;

        IF OLD.status = 'waitlist' AND NEW.status = 'confirmed' THEN
            v_type := 'waitlist_promoted';
            v_title := format('You were moved off the waitlist: %s', COALESCE(v_event_title, 'Activity'));
            v_message := format('Good news - you now have a confirmed spot for %s.', COALESCE(v_event_title, 'this activity'));
        ELSIF NEW.status = 'waitlist' THEN
            v_type := 'waitlist_added';
            v_title := format('Waitlist update: %s', COALESCE(v_event_title, 'Activity'));
            v_message := format('Your status changed to waitlist for %s.', COALESCE(v_event_title, 'this activity'));
        ELSIF NEW.status = 'cancelled' THEN
            v_type := 'attendance_changed';
            v_title := format('Attendance removed: %s', COALESCE(v_event_title, 'Activity'));
            v_message := format('Your attendance was removed for %s.', COALESCE(v_event_title, 'this activity'));
        ELSE
            v_type := 'attendance_changed';
            v_title := format('Attendance updated: %s', COALESCE(v_event_title, 'Activity'));
            v_message := format('Your attendance status changed from %s to %s for %s.', OLD.status, NEW.status, COALESCE(v_event_title, 'this activity'));
        END IF;
    END IF;

    PERFORM public.create_notification(
        v_user_id,
        v_type,
        v_title,
        v_message,
        COALESCE(NEW.event_id, OLD.event_id),
        v_event_host,
        jsonb_build_object(
            'new_status', COALESCE(NEW.status, OLD.status),
            'old_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END
        ),
        CASE WHEN v_event_slug IS NOT NULL THEN format('/events/%s', v_event_slug) ELSE NULL END,
        'Open activity'
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_notify_attendee_status_insert ON public.event_attendees;
CREATE TRIGGER trg_notify_attendee_status_insert
AFTER INSERT ON public.event_attendees
FOR EACH ROW
EXECUTE FUNCTION public.notify_attendee_status_change();

DROP TRIGGER IF EXISTS trg_notify_attendee_status_update ON public.event_attendees;
CREATE TRIGGER trg_notify_attendee_status_update
AFTER UPDATE ON public.event_attendees
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION public.notify_attendee_status_change();

CREATE TABLE IF NOT EXISTS public.host_join_notification_batches (
    id BIGSERIAL PRIMARY KEY,
    recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL,
    guest_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    join_count INTEGER NOT NULL DEFAULT 0,
    latest_status TEXT NOT NULL DEFAULT 'confirmed',
    flush_after TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS host_join_notification_batches_key
    ON public.host_join_notification_batches (recipient_user_id, event_id, actor_user_id);

CREATE INDEX IF NOT EXISTS host_join_notification_batches_flush_idx
    ON public.host_join_notification_batches (flush_after ASC);

CREATE OR REPLACE FUNCTION public.enqueue_host_join_notification_batch(
    p_recipient_user_id UUID,
    p_event_id UUID,
    p_actor_user_id UUID,
    p_guest_name TEXT,
    p_status TEXT
) RETURNS VOID AS $$
DECLARE
    v_actor_user_id UUID := COALESCE(p_actor_user_id, '00000000-0000-0000-0000-000000000000'::UUID);
    v_guest_name TEXT := COALESCE(NULLIF(trim(COALESCE(p_guest_name, '')), ''), 'Someone');
BEGIN
    IF p_recipient_user_id IS NULL OR p_event_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.host_join_notification_batches (
        recipient_user_id,
        event_id,
        actor_user_id,
        guest_names,
        join_count,
        latest_status,
        flush_after
    )
    VALUES (
        p_recipient_user_id,
        p_event_id,
        v_actor_user_id,
        ARRAY[v_guest_name],
        1,
        COALESCE(NULLIF(trim(COALESCE(p_status, '')), ''), 'confirmed'),
        now() + interval '30 seconds'
    )
    ON CONFLICT (recipient_user_id, event_id, actor_user_id)
    DO UPDATE
    SET
        guest_names = (
            SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[])
            FROM (
                SELECT DISTINCT trim(name) AS name
                FROM unnest(public.host_join_notification_batches.guest_names || EXCLUDED.guest_names) AS raw_name(name)
                WHERE COALESCE(trim(name), '') <> ''
            ) unique_names
        ),
        join_count = public.host_join_notification_batches.join_count + 1,
        latest_status = EXCLUDED.latest_status,
        flush_after = GREATEST(public.host_join_notification_batches.flush_after, now() + interval '30 seconds'),
        updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.flush_host_join_notification_batches(
    p_limit INTEGER DEFAULT 100
) RETURNS INTEGER AS $$
DECLARE
    v_batch RECORD;
    v_event_title TEXT;
    v_names_text TEXT;
    v_title TEXT;
    v_message TEXT;
    v_action_url TEXT;
    v_processed_count INTEGER := 0;
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
BEGIN
    FOR v_batch IN
        SELECT hb.*
        FROM public.host_join_notification_batches hb
        WHERE hb.flush_after <= now()
        ORDER BY hb.flush_after ASC, hb.id ASC
        LIMIT v_limit
        FOR UPDATE SKIP LOCKED
    LOOP
        SELECT e.title
        INTO v_event_title
        FROM public.events e
        WHERE e.id = v_batch.event_id;

        IF v_event_title IS NULL THEN
            DELETE FROM public.host_join_notification_batches WHERE id = v_batch.id;
            CONTINUE;
        END IF;

        IF COALESCE(array_length(v_batch.guest_names, 1), 0) = 0 THEN
            v_names_text := 'Someone';
        ELSIF array_length(v_batch.guest_names, 1) = 1 THEN
            v_names_text := v_batch.guest_names[1];
        ELSIF array_length(v_batch.guest_names, 1) = 2 THEN
            v_names_text := format('%s and %s', v_batch.guest_names[1], v_batch.guest_names[2]);
        ELSE
            v_names_text := format(
                '%s, and %s',
                array_to_string(v_batch.guest_names[1:array_length(v_batch.guest_names, 1) - 1], ', '),
                v_batch.guest_names[array_length(v_batch.guest_names, 1)]
            );
        END IF;

        IF v_batch.join_count <= 1 THEN
            v_title := format('%s joined your activity: %s', v_names_text, v_event_title);
            IF v_batch.latest_status = 'waitlist' THEN
                v_message := format('%s joined the waitlist for %s.', v_names_text, v_event_title);
            ELSIF v_batch.latest_status = 'pending_approval' THEN
                v_message := format('%s requested to join %s.', v_names_text, v_event_title);
            ELSE
                v_message := format('%s joined %s.', v_names_text, v_event_title);
            END IF;
        ELSE
            v_title := format('%s people joined your activity: %s', v_batch.join_count, v_event_title);
            v_message := format('%s joined or requested to join %s: %s.', v_batch.join_count, v_event_title, v_names_text);
        END IF;

        v_action_url := format('/host/events/%s', v_batch.event_id);

        PERFORM public.create_notification(
            v_batch.recipient_user_id,
            'host_join',
            v_title,
            v_message,
            v_batch.event_id,
            NULLIF(v_batch.actor_user_id, '00000000-0000-0000-0000-000000000000'::UUID),
            jsonb_build_object(
                'guest_names', to_jsonb(v_batch.guest_names),
                'join_count', v_batch.join_count,
                'new_status', v_batch.latest_status
            ),
            v_action_url,
            'Open host dashboard'
        );

        DELETE FROM public.host_join_notification_batches WHERE id = v_batch.id;
        v_processed_count := v_processed_count + 1;
    END LOOP;

    RETURN v_processed_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.invoke_host_join_batch_flush()
RETURNS INTEGER AS $$
BEGIN
    RETURN public.flush_host_join_notification_batches(200);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

CREATE OR REPLACE FUNCTION public.notify_attendee_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_attendee_user_id UUID;
    v_attendee_profile_id UUID;
    v_actor_user_id UUID;
    v_event_title TEXT;
    v_event_slug TEXT;
    v_event_host UUID;
    v_type TEXT;
    v_title TEXT;
    v_message TEXT;
    v_guest_name TEXT;
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

    v_attendee_profile_id := COALESCE(NEW.attendee_profile_id, OLD.attendee_profile_id);

    v_attendee_user_id := COALESCE(
        NEW.user_id,
        OLD.user_id,
        (
            SELECT ap.user_id
            FROM public.attendee_profiles ap
            WHERE ap.id = v_attendee_profile_id
            LIMIT 1
        )
    );

    v_actor_user_id := COALESCE(auth.uid(), v_attendee_user_id);

    IF TG_OP = 'INSERT'
       AND NEW.status IN ('waitlist', 'pending_approval', 'confirmed')
       AND v_event_host IS NOT NULL
       AND v_attendee_user_id IS DISTINCT FROM v_event_host THEN
        v_guest_name := NULLIF(trim(COALESCE(NEW.guest_name, OLD.guest_name, '')), '');

        IF v_guest_name IS NULL AND v_attendee_profile_id IS NOT NULL THEN
            SELECT
                COALESCE(
                    NULLIF(trim(ap.full_name), ''),
                    NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                    CASE
                        WHEN nullif(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), '') IS NOT NULL
                            THEN concat('WhatsApp user ', right(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), 4))
                        ELSE NULL
                    END
                )
            INTO v_guest_name
            FROM public.attendee_profiles ap
            WHERE ap.id = v_attendee_profile_id
            LIMIT 1;
        END IF;

        IF v_guest_name IS NULL AND v_attendee_user_id IS NOT NULL THEN
            SELECT
                COALESCE(
                    NULLIF(trim(ap.full_name), ''),
                    NULLIF(trim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                    CASE
                        WHEN nullif(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), '') IS NOT NULL
                            THEN concat('WhatsApp user ', right(regexp_replace(COALESCE(ap.whatsapp_number, ''), '\D', '', 'g'), 4))
                        ELSE NULL
                    END
                )
            INTO v_guest_name
            FROM public.attendee_profiles ap
            WHERE ap.user_id = v_attendee_user_id
            ORDER BY ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
            LIMIT 1;
        END IF;

        v_guest_name := COALESCE(v_guest_name, 'Someone');

        PERFORM public.enqueue_host_join_notification_batch(
            v_event_host,
            COALESCE(NEW.event_id, OLD.event_id),
            v_actor_user_id,
            v_guest_name,
            NEW.status
        );
    END IF;

    IF v_attendee_user_id IS NULL OR v_attendee_user_id = v_event_host THEN
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
        v_attendee_user_id,
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

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
DECLARE
    v_job_id BIGINT;
BEGIN
    SELECT jobid
    INTO v_job_id
    FROM cron.job
    WHERE jobname = 'host-join-batch-flush-every-minute'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
        'host-join-batch-flush-every-minute',
        '* * * * *',
        $cron$SELECT public.invoke_host_join_batch_flush();$cron$
    );
END $$;

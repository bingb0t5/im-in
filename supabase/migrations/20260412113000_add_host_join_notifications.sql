CREATE OR REPLACE FUNCTION public.notify_attendee_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_attendee_user_id UUID;
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

    v_attendee_user_id := COALESCE(
        NEW.user_id,
        OLD.user_id,
        (
            SELECT ap.user_id
            FROM public.attendee_profiles ap
            WHERE ap.id = COALESCE(NEW.attendee_profile_id, OLD.attendee_profile_id)
            LIMIT 1
        )
    );

    IF TG_OP = 'INSERT'
       AND NEW.status IN ('waitlist', 'pending_approval', 'confirmed')
       AND v_event_host IS NOT NULL
       AND v_attendee_user_id IS DISTINCT FROM v_event_host THEN
        v_guest_name := COALESCE(
            NULLIF(trim(COALESCE(NEW.resolved_display_name, OLD.resolved_display_name, '')), ''),
            NULLIF(trim(COALESCE(NEW.guest_name, OLD.guest_name, '')), ''),
            'Someone'
        );

        v_title := format('%s joined your activity: %s', v_guest_name, COALESCE(v_event_title, 'Activity'));
        IF NEW.status = 'waitlist' THEN
            v_message := format('%s joined the waitlist for %s.', v_guest_name, COALESCE(v_event_title, 'this activity'));
        ELSIF NEW.status = 'pending_approval' THEN
            v_message := format('%s requested to join %s.', v_guest_name, COALESCE(v_event_title, 'this activity'));
        ELSE
            v_message := format('%s joined %s.', v_guest_name, COALESCE(v_event_title, 'this activity'));
        END IF;

        PERFORM public.create_notification(
            v_event_host,
            'host_join',
            v_title,
            v_message,
            COALESCE(NEW.event_id, OLD.event_id),
            v_attendee_user_id,
            jsonb_build_object(
                'guest_name', v_guest_name,
                'new_status', NEW.status
            ),
            CASE WHEN v_event_slug IS NOT NULL THEN format('/events/%s', v_event_slug) ELSE NULL END,
            'View activity'
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

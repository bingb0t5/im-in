CREATE OR REPLACE FUNCTION public.reply_to_event_hosts(
    p_event_id UUID,
    p_message TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_message TEXT := nullif(trim(coalesce(p_message, '')), '');
    v_event_title TEXT;
    v_sender_name TEXT;
    v_sent_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN json_build_object('error', 'You must be signed in to reply.');
    END IF;

    IF p_event_id IS NULL THEN
        RETURN json_build_object('error', 'Missing activity.');
    END IF;

    IF v_message IS NULL THEN
        RETURN json_build_object('error', 'Reply message is required.');
    END IF;

    IF public.is_event_host(p_event_id, auth.uid()) THEN
        RETURN json_build_object('error', 'Hosts cannot use the guest reply action.');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.recipient_user_id = auth.uid()
          AND n.event_id = p_event_id
          AND n.type = 'host_message'
    ) THEN
        RETURN json_build_object('error', 'You cannot reply to this activity message.');
    END IF;

    SELECT e.title
    INTO v_event_title
    FROM public.events e
    WHERE e.id = p_event_id;

    IF v_event_title IS NULL THEN
        RETURN json_build_object('error', 'Activity not found.');
    END IF;

    SELECT COALESCE(
        nullif(trim(p.full_name), ''),
        nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
        'Someone'
    )
    INTO v_sender_name
    FROM public.profiles p
    WHERE p.id = auth.uid();

    WITH host_recipients AS (
        SELECT DISTINCT e.host_user_id AS user_id
        FROM public.events e
        WHERE e.id = p_event_id
          AND e.host_user_id IS NOT NULL
          AND e.host_user_id <> auth.uid()

        UNION

        SELECT DISTINCT eh.user_id
        FROM public.event_hosts eh
        WHERE eh.event_id = p_event_id
          AND eh.user_id <> auth.uid()
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
            hr.user_id,
            auth.uid(),
            p_event_id,
            'guest_reply',
            format('Reply from %s', coalesce(v_sender_name, 'Someone')),
            v_message,
            jsonb_build_object(
                'event_title', v_event_title,
                'sender_name', coalesce(v_sender_name, 'Someone')
            ),
            format('/host/events/%s', p_event_id),
            'View activity'
        FROM host_recipients hr
        RETURNING 1
    )
    SELECT count(*)
    INTO v_sent_count
    FROM inserted;

    RETURN json_build_object(
        'success', true,
        'sent_count', v_sent_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reply_to_event_hosts(UUID, TEXT) TO authenticated;

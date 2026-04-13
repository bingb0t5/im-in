CREATE OR REPLACE FUNCTION public.is_notification_category_valid(p_category TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN COALESCE(p_category, '') = ANY (ARRAY[
        'activity_shared',
        'activity_updated',
        'waitlist_added',
        'waitlist_promoted',
        'attendance_changed',
        'host_join',
        'host_message',
        'guest_reply',
        'system'
    ]);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

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
            'host_join',
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

DROP FUNCTION IF EXISTS public.list_public_moderation_log(TEXT, UUID, INTEGER, INTEGER);

CREATE FUNCTION public.list_public_moderation_log(
    p_action TEXT DEFAULT NULL,
    p_target_id UUID DEFAULT NULL,
    p_limit INTEGER DEFAULT 30,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
    id UUID,
    target_type TEXT,
    target_id UUID,
    target_visibility_snapshot TEXT,
    public_title_snapshot TEXT,
    public_slug_snapshot TEXT,
    action TEXT,
    reason_code TEXT,
    public_explanation TEXT,
    moderator_public_handle TEXT,
    moderator_display_name TEXT,
    target_created_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
    SELECT
        entry.id,
        entry.target_type,
        entry.target_id,
        entry.target_visibility_snapshot,
        entry.public_title_snapshot,
        entry.public_slug_snapshot,
        entry.action,
        entry.reason_code,
        entry.public_explanation,
        entry.moderator_public_handle,
        COALESCE(
            NULLIF(TRIM((
                SELECT COALESCE(
                    NULLIF(TRIM(concat_ws(' ', ap.first_name, ap.last_name)), ''),
                    NULLIF(TRIM(ap.full_name), '')
                )
                FROM public.attendee_profiles ap
                WHERE ap.user_id = entry.moderator_internal_id
                ORDER BY ap.updated_at DESC NULLS LAST, ap.created_at DESC NULLS LAST
                LIMIT 1
            )), ''),
            NULLIF(TRIM(entry.moderator_public_handle), ''),
            CASE
                WHEN entry.moderator_internal_id IS NULL THEN 'System'
                ELSE 'Moderator'
            END
        ) AS moderator_display_name,
        target_event.created_at AS target_created_at,
        entry.created_at
    FROM public.public_moderation_log_entries entry
    LEFT JOIN public.events target_event
      ON target_event.id = entry.target_id
    WHERE (p_action IS NULL OR entry.action = p_action)
      AND (p_target_id IS NULL OR entry.target_id = p_target_id)
      AND entry.target_visibility_snapshot IN ('public', 'semi_public')
    ORDER BY entry.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_public_moderation_log(TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;

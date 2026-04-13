DROP FUNCTION IF EXISTS public.list_event_gallery_for_view(TEXT, TEXT);

CREATE FUNCTION public.list_event_gallery_for_view(
    p_slug TEXT,
    p_access_code TEXT DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    event_id UUID,
    storage_bucket TEXT,
    storage_path TEXT,
    original_file_name TEXT,
    content_type TEXT,
    file_size_bytes INTEGER,
    width INTEGER,
    height INTEGER,
    sort_order INTEGER,
    public_visibility_status TEXT,
    public_moderation_reasons TEXT[],
    public_moderation_confidence NUMERIC,
    public_moderated_at TIMESTAMPTZ,
    public_hidden_at TIMESTAMPTZ,
    public_hidden_reason TEXT,
    review_requested_at TIMESTAMPTZ,
    report_count INTEGER,
    is_public_preview_visible BOOLEAN,
    can_report BOOLEAN,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
DECLARE
    v_event RECORD;
    v_visibility TEXT;
    v_gallery_visibility TEXT;
    v_can_view_full BOOLEAN := false;
    v_host_viewer BOOLEAN := false;
BEGIN
    SELECT *
    INTO v_event
    FROM public.get_event_for_view(p_slug, p_access_code)
    LIMIT 1;

    IF NOT FOUND OR v_event.id IS NULL THEN
        RETURN;
    END IF;

    SELECT
        COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END),
        COALESCE(e.gallery_visibility, 'private_only')
    INTO
        v_visibility,
        v_gallery_visibility
    FROM public.events e
    WHERE e.id = v_event.id;

    v_can_view_full := COALESCE(v_event.can_view_full_details, false);
    v_host_viewer := auth.uid() IS NOT NULL AND public.is_event_host(v_event.id, auth.uid());

    RETURN QUERY
    SELECT
        img.id,
        img.event_id,
        img.storage_bucket,
        img.storage_path,
        img.original_file_name,
        img.content_type,
        img.file_size_bytes,
        img.width,
        img.height,
        img.sort_order,
        img.public_visibility_status,
        img.public_moderation_reasons,
        img.public_moderation_confidence,
        img.public_moderated_at,
        img.public_hidden_at,
        img.public_hidden_reason,
        img.review_requested_at,
        img.report_count,
        (
            v_visibility <> 'private'
            AND v_gallery_visibility = 'public_preview'
            AND img.public_visibility_status = 'approved'
            AND img.public_hidden_at IS NULL
        ) AS is_public_preview_visible,
        (
            auth.uid() IS NOT NULL
            AND NOT v_host_viewer
            AND v_visibility <> 'private'
            AND v_gallery_visibility = 'public_preview'
            AND img.public_visibility_status = 'approved'
            AND img.public_hidden_at IS NULL
        ) AS can_report,
        img.created_at,
        img.updated_at
    FROM public.event_gallery_images img
    WHERE img.event_id = v_event.id
      AND (
          v_can_view_full
          OR (
              v_gallery_visibility = 'public_preview'
              AND img.public_visibility_status = 'approved'
              AND img.public_hidden_at IS NULL
          )
      )
    ORDER BY img.sort_order ASC, img.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_event_gallery_for_view(TEXT, TEXT) TO anon, authenticated;

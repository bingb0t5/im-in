ALTER TABLE public.events
    ADD COLUMN IF NOT EXISTS gallery_visibility TEXT NOT NULL DEFAULT 'private_only'
    CHECK (gallery_visibility IN ('private_only', 'public_preview'));

CREATE TABLE IF NOT EXISTS public.event_gallery_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    storage_bucket TEXT NOT NULL DEFAULT 'event-gallery',
    storage_path TEXT NOT NULL UNIQUE,
    original_file_name TEXT,
    content_type TEXT,
    file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes > 0),
    width INTEGER,
    height INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    public_visibility_status TEXT NOT NULL DEFAULT 'private_only'
        CHECK (public_visibility_status IN ('private_only', 'pending', 'approved', 'blocked', 'error', 'report_hidden')),
    public_moderation_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    public_moderation_confidence NUMERIC(4,3),
    public_moderated_at TIMESTAMPTZ,
    public_hidden_at TIMESTAMPTZ,
    public_hidden_reason TEXT,
    review_requested_at TIMESTAMPTZ,
    report_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_gallery_images_event_id_sort_order
    ON public.event_gallery_images (event_id, sort_order, created_at);

CREATE INDEX IF NOT EXISTS idx_event_gallery_images_public_visibility
    ON public.event_gallery_images (public_visibility_status, public_hidden_at);

CREATE INDEX IF NOT EXISTS idx_event_gallery_images_review_requested_at
    ON public.event_gallery_images (review_requested_at DESC);

CREATE TABLE IF NOT EXISTS public.event_gallery_image_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id UUID NOT NULL REFERENCES public.event_gallery_images(id) ON DELETE CASCADE,
    reporter_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    report_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (image_id, reporter_user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_gallery_image_reports_image_id
    ON public.event_gallery_image_reports (image_id, created_at DESC);

ALTER TABLE public.event_gallery_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_gallery_image_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_gallery_images_host_manage_select ON public.event_gallery_images;
CREATE POLICY event_gallery_images_host_manage_select
ON public.event_gallery_images
FOR SELECT TO authenticated
USING (public.is_event_host(event_id, auth.uid()));

DROP POLICY IF EXISTS event_gallery_images_host_manage_insert ON public.event_gallery_images;
CREATE POLICY event_gallery_images_host_manage_insert
ON public.event_gallery_images
FOR INSERT TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_event_host(event_id, auth.uid())
    AND (
        created_by_user_id IS NULL
        OR created_by_user_id = auth.uid()
    )
);

DROP POLICY IF EXISTS event_gallery_images_host_manage_update ON public.event_gallery_images;
CREATE POLICY event_gallery_images_host_manage_update
ON public.event_gallery_images
FOR UPDATE TO authenticated
USING (public.is_event_host(event_id, auth.uid()))
WITH CHECK (public.is_event_host(event_id, auth.uid()));

DROP POLICY IF EXISTS event_gallery_images_host_manage_delete ON public.event_gallery_images;
CREATE POLICY event_gallery_images_host_manage_delete
ON public.event_gallery_images
FOR DELETE TO authenticated
USING (public.is_event_host(event_id, auth.uid()));

REVOKE ALL ON public.event_gallery_image_reports FROM anon, authenticated;
GRANT SELECT ON public.event_gallery_image_reports TO authenticated;

DROP POLICY IF EXISTS event_gallery_image_reports_none ON public.event_gallery_image_reports;
CREATE POLICY event_gallery_image_reports_none
ON public.event_gallery_image_reports
FOR ALL TO authenticated
USING (false)
WITH CHECK (false);

DROP TRIGGER IF EXISTS event_gallery_images_touch_updated_at ON public.event_gallery_images;
CREATE TRIGGER event_gallery_images_touch_updated_at
    BEFORE UPDATE ON public.event_gallery_images
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_updated_at();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
        INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES (
            'event-gallery',
            'event-gallery',
            false,
            8388608,
            ARRAY['image/png', 'image/jpeg', 'image/webp']::TEXT[]
        )
        ON CONFLICT (id) DO UPDATE
        SET
            public = false,
            file_size_limit = EXCLUDED.file_size_limit,
            allowed_mime_types = EXCLUDED.allowed_mime_types;
    END IF;
END $$;

DROP POLICY IF EXISTS event_gallery_storage_select_host ON storage.objects;
CREATE POLICY event_gallery_storage_select_host
ON storage.objects
FOR SELECT TO authenticated
USING (
    bucket_id = 'event-gallery'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND public.is_event_host(split_part(name, '/', 1)::UUID, auth.uid())
);

DROP POLICY IF EXISTS event_gallery_storage_insert_host ON storage.objects;
CREATE POLICY event_gallery_storage_insert_host
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'event-gallery'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND public.is_event_host(split_part(name, '/', 1)::UUID, auth.uid())
);

DROP POLICY IF EXISTS event_gallery_storage_update_host ON storage.objects;
CREATE POLICY event_gallery_storage_update_host
ON storage.objects
FOR UPDATE TO authenticated
USING (
    bucket_id = 'event-gallery'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND public.is_event_host(split_part(name, '/', 1)::UUID, auth.uid())
)
WITH CHECK (
    bucket_id = 'event-gallery'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND public.is_event_host(split_part(name, '/', 1)::UUID, auth.uid())
);

DROP POLICY IF EXISTS event_gallery_storage_delete_host ON storage.objects;
CREATE POLICY event_gallery_storage_delete_host
ON storage.objects
FOR DELETE TO authenticated
USING (
    bucket_id = 'event-gallery'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
    AND public.is_event_host(split_part(name, '/', 1)::UUID, auth.uid())
);

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
          OR v_visibility = 'private'
          OR v_gallery_visibility = 'private_only'
          OR (
              img.public_visibility_status = 'approved'
              AND img.public_hidden_at IS NULL
          )
      )
    ORDER BY img.sort_order ASC, img.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_event_gallery_for_view(TEXT, TEXT) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.report_event_gallery_image(UUID, TEXT);
CREATE FUNCTION public.report_event_gallery_image(
    p_image_id UUID,
    p_report_reason TEXT DEFAULT NULL
) RETURNS TABLE (
    image_id UUID,
    report_count INTEGER,
    already_reported BOOLEAN,
    image_hidden BOOLEAN
) AS $$
DECLARE
    v_image RECORD;
    v_visibility TEXT;
    v_gallery_visibility TEXT;
    v_is_preview_visible BOOLEAN := false;
    v_already_reported BOOLEAN := false;
    v_report_count INTEGER := 0;
    v_image_hidden BOOLEAN := false;
    v_inserted_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign-in required to report gallery images.';
    END IF;

    SELECT img.*, e.visibility, e.is_public, e.gallery_visibility
    INTO v_image
    FROM public.event_gallery_images img
    JOIN public.events e
      ON e.id = img.event_id
    WHERE img.id = p_image_id
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Gallery image not found.';
    END IF;

    v_visibility := COALESCE(v_image.visibility, CASE WHEN v_image.is_public THEN 'public' ELSE 'private' END);
    v_gallery_visibility := COALESCE(v_image.gallery_visibility, 'private_only');
    v_is_preview_visible := (
        v_visibility <> 'private'
        AND v_gallery_visibility = 'public_preview'
        AND v_image.public_visibility_status = 'approved'
        AND v_image.public_hidden_at IS NULL
    );

    IF NOT v_is_preview_visible THEN
        RAISE EXCEPTION 'This image is not currently available for public reporting.';
    END IF;

    INSERT INTO public.event_gallery_image_reports (image_id, reporter_user_id, report_reason)
    VALUES (p_image_id, auth.uid(), nullif(trim(coalesce(p_report_reason, '')), ''))
    ON CONFLICT (image_id, reporter_user_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    v_already_reported := v_inserted_count = 0;

    IF NOT v_already_reported THEN
        UPDATE public.event_gallery_images
        SET
            report_count = COALESCE(report_count, 0) + 1,
            review_requested_at = COALESCE(review_requested_at, now())
        WHERE id = p_image_id
        RETURNING report_count INTO v_report_count;

        IF v_report_count >= 3 THEN
            UPDATE public.event_gallery_images
            SET
                public_visibility_status = 'report_hidden',
                public_hidden_at = COALESCE(public_hidden_at, now()),
                public_hidden_reason = COALESCE(public_hidden_reason, 'reported_by_users'),
                review_requested_at = COALESCE(review_requested_at, now())
            WHERE id = p_image_id
              AND public_hidden_at IS NULL;
        END IF;
    ELSE
        SELECT COALESCE(report_count, 0)
        INTO v_report_count
        FROM public.event_gallery_images
        WHERE id = p_image_id;
    END IF;

    SELECT (public_hidden_at IS NOT NULL OR public_visibility_status = 'report_hidden')
    INTO v_image_hidden
    FROM public.event_gallery_images
    WHERE id = p_image_id;

    RETURN QUERY
    SELECT
        p_image_id,
        COALESCE(v_report_count, 0),
        v_already_reported,
        COALESCE(v_image_hidden, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER VOLATILE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.report_event_gallery_image(UUID, TEXT) TO authenticated;

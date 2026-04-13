CREATE OR REPLACE FUNCTION public.list_public_calendar_events(
    p_now TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE (
    id UUID,
    slug TEXT,
    title TEXT,
    location_text TEXT,
    public_location_text TEXT,
    starts_at TIMESTAMPTZ,
    timezone TEXT,
    duration_minutes INTEGER,
    capacity INTEGER,
    visibility TEXT,
    is_public BOOLEAN,
    public_discovery_enabled BOOLEAN,
    status TEXT,
    access_code TEXT,
    confirmed_count INTEGER,
    thinking_count INTEGER
) AS $$
    SELECT
        e.id,
        COALESCE(e.public_slug, e.slug) AS slug,
        e.title,
        CASE
            WHEN COALESCE(e.visibility, CASE WHEN e.is_public THEN 'public' ELSE 'private' END) = 'semi_public' THEN NULL
            ELSE e.location_text
        END AS location_text,
        e.public_location_text,
        e.starts_at,
        e.timezone,
        e.duration_minutes,
        e.capacity,
        e.visibility,
        e.is_public,
        e.public_discovery_enabled,
        e.status,
        NULL::TEXT AS access_code,
        (
            SELECT count(*)::INTEGER
            FROM public.event_attendees ea
            WHERE ea.event_id = e.id
              AND ea.status = 'confirmed'
        ) AS confirmed_count,
        (
            SELECT count(*)::INTEGER
            FROM public.event_interests ei
            WHERE ei.event_id = e.id
        ) AS thinking_count
    FROM public.events e
    WHERE e.status = 'scheduled'
      AND e.is_public = true
      AND e.public_discovery_enabled = true
      AND COALESCE(
            e.ends_at,
            CASE
                WHEN COALESCE(e.duration_minutes, 0) > 0
                    THEN e.starts_at + make_interval(mins => e.duration_minutes)
                ELSE e.starts_at
            END
          ) >= COALESCE(p_now, now())
    ORDER BY e.starts_at ASC;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_public_calendar_events(TIMESTAMPTZ) TO anon, authenticated;

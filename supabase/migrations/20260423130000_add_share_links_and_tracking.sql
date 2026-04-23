CREATE TABLE IF NOT EXISTS public.share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL UNIQUE,
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    target_slug TEXT NOT NULL,
    access_type TEXT NOT NULL CHECK (access_type IN ('public', 'private')),
    source TEXT,
    share_channel TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_opened_at TIMESTAMPTZ,
    open_count INTEGER NOT NULL DEFAULT 0 CHECK (open_count >= 0)
);

CREATE INDEX IF NOT EXISTS share_links_event_created_at_idx
    ON public.share_links (event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.share_link_opens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_link_id UUID NOT NULL REFERENCES public.share_links(id) ON DELETE CASCADE,
    session_id TEXT,
    referrer_domain TEXT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_link_opens_link_opened_at_idx
    ON public.share_link_opens (share_link_id, opened_at DESC);

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_link_opens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.share_links FROM anon, authenticated;
REVOKE ALL ON public.share_link_opens FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_share_link(
    p_event_id UUID,
    p_target_slug TEXT,
    p_access_type TEXT,
    p_source TEXT DEFAULT NULL,
    p_share_channel TEXT DEFAULT NULL
) RETURNS TABLE (
    link_id UUID,
    token TEXT,
    event_id UUID,
    target_slug TEXT,
    access_type TEXT,
    source TEXT,
    share_channel TEXT
) AS $$
DECLARE
    v_event public.events%ROWTYPE;
    v_token TEXT;
    v_target_slug TEXT := trim(coalesce(p_target_slug, ''));
    v_access_type TEXT := lower(trim(coalesce(p_access_type, '')));
    v_source TEXT := nullif(trim(coalesce(p_source, '')), '');
    v_share_channel TEXT := nullif(trim(coalesce(p_share_channel, '')), '');
    v_public_slug TEXT;
    v_private_slug TEXT;
BEGIN
    IF p_event_id IS NULL OR v_target_slug = '' THEN
        RAISE EXCEPTION 'Share link target is required';
    END IF;

    IF v_access_type NOT IN ('public', 'private') THEN
        RAISE EXCEPTION 'Invalid share link access type';
    END IF;

    SELECT *
    INTO v_event
    FROM public.events
    WHERE id = p_event_id
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Activity not found';
    END IF;

    v_public_slug := COALESCE(nullif(trim(v_event.public_slug), ''), nullif(trim(v_event.slug), ''));
    v_private_slug := COALESCE(nullif(trim(v_event.private_slug), ''), nullif(trim(v_event.join_code), ''));

    IF v_access_type = 'public' AND v_target_slug <> v_public_slug THEN
        RAISE EXCEPTION 'Public share link target does not match activity';
    END IF;

    IF v_access_type = 'private' AND v_target_slug <> v_private_slug THEN
        RAISE EXCEPTION 'Private share link target does not match activity';
    END IF;

    FOR i IN 1..5 LOOP
        v_token := substring(replace(gen_random_uuid()::TEXT, '-', '') from 1 for 12);

        BEGIN
            INSERT INTO public.share_links (
                token,
                event_id,
                target_slug,
                access_type,
                source,
                share_channel
            )
            VALUES (
                v_token,
                p_event_id,
                v_target_slug,
                v_access_type,
                v_source,
                v_share_channel
            )
            RETURNING
                public.share_links.id,
                public.share_links.token,
                public.share_links.event_id,
                public.share_links.target_slug,
                public.share_links.access_type,
                public.share_links.source,
                public.share_links.share_channel
            INTO
                link_id,
                token,
                event_id,
                target_slug,
                access_type,
                source,
                share_channel;

            RETURN NEXT;
            RETURN;
        EXCEPTION
            WHEN unique_violation THEN
                CONTINUE;
        END;
    END LOOP;

    RAISE EXCEPTION 'Could not create a unique share link';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.create_share_link(UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.open_share_link(
    p_token TEXT,
    p_session_id TEXT DEFAULT NULL,
    p_referrer_domain TEXT DEFAULT NULL
) RETURNS TABLE (
    link_id UUID,
    token TEXT,
    event_id UUID,
    target_slug TEXT,
    access_type TEXT,
    source TEXT,
    share_channel TEXT
) AS $$
DECLARE
    v_link public.share_links%ROWTYPE;
BEGIN
    IF nullif(trim(coalesce(p_token, '')), '') IS NULL THEN
        RETURN;
    END IF;

    SELECT *
    INTO v_link
    FROM public.share_links
    WHERE token = trim(p_token)
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    INSERT INTO public.share_link_opens (
        share_link_id,
        session_id,
        referrer_domain
    )
    VALUES (
        v_link.id,
        nullif(left(trim(coalesce(p_session_id, '')), 120), ''),
        nullif(left(trim(coalesce(p_referrer_domain, '')), 255), '')
    );

    UPDATE public.share_links
    SET
        open_count = open_count + 1,
        last_opened_at = now()
    WHERE id = v_link.id;

    RETURN QUERY
    SELECT
        v_link.id,
        v_link.token,
        v_link.event_id,
        v_link.target_slug,
        v_link.access_type,
        v_link.source,
        v_link.share_channel;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.open_share_link(TEXT, TEXT, TEXT) TO anon, authenticated;

# Supabase SQL Migration

-- 1. Tables

CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    public_summary TEXT,
    location_text TEXT,
    public_location_text TEXT,
    google_maps_url TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes >= 15 AND duration_minutes <= 360 AND duration_minutes % 15 = 0),
    ends_at TIMESTAMPTZ,
    capacity INTEGER NOT NULL,
    host_user_id UUID REFERENCES auth.users(id),
    host_name TEXT,
    host_contact_text TEXT,
    show_host_publicly BOOLEAN DEFAULT false,
    access_code TEXT DEFAULT gen_random_uuid()::text,
    visibility TEXT CHECK (visibility IN ('public', 'semi_public', 'private')) DEFAULT 'semi_public',
    allow_waitlist BOOLEAN DEFAULT true,
    is_public BOOLEAN DEFAULT false,
    public_discovery_enabled BOOLEAN NOT NULL DEFAULT false,
    moderation_status TEXT NOT NULL DEFAULT 'not_required' CHECK (moderation_status IN ('not_required', 'pending', 'approved', 'limited', 'review', 'blocked', 'error')),
    moderation_risk_level TEXT CHECK (moderation_risk_level IS NULL OR moderation_risk_level IN ('low', 'medium', 'high')),
    moderation_action TEXT CHECK (moderation_action IS NULL OR moderation_action IN ('allow', 'limit_visibility', 'require_review', 'block')),
    moderation_confidence NUMERIC(4,3),
    moderation_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    moderation_input_hash TEXT,
    moderated_at TIMESTAMPTZ,
    moderation_override TEXT CHECK (moderation_override IS NULL OR moderation_override IN ('force_visible', 'force_limited', 'hide', 'mark_safe', 'mark_spam')),
    status TEXT CHECK (status IN ('scheduled', 'cancelled', 'completed')) DEFAULT 'scheduled',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_attendees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    status TEXT CHECK (status IN ('confirmed', 'waitlist', 'cancelled')) NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT now(),
    promoted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    UNIQUE(event_id, guest_email)
);

CREATE TABLE IF NOT EXISTS public.event_hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    added_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.event_waitlist_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    attendee_id UUID REFERENCES public.event_attendees(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(event_id, attendee_id),
    UNIQUE(event_id, position)
);

CREATE TABLE IF NOT EXISTS public.event_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    requester_name TEXT NOT NULL,
    requester_whatsapp TEXT NOT NULL,
    requester_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'contacted')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

UPDATE public.events
SET public_discovery_enabled = CASE
    WHEN COALESCE(visibility, CASE WHEN is_public THEN 'public' ELSE 'private' END) IN ('public', 'semi_public')
        THEN true
    ELSE false
END
WHERE moderation_override IS NULL
  AND moderated_at IS NULL
  AND moderation_input_hash IS NULL;

UPDATE public.events
SET moderation_status = CASE
    WHEN COALESCE(visibility, CASE WHEN is_public THEN 'public' ELSE 'private' END) = 'private'
        THEN 'not_required'
    ELSE 'approved'
END
WHERE moderation_override IS NULL
  AND moderated_at IS NULL
  AND moderation_input_hash IS NULL;

-- 2. RLS Policies

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_waitlist_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_access_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_event_host(
    p_event_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.events e
        WHERE e.id = p_event_id
          AND e.host_user_id = p_user_id
    )
    OR EXISTS (
        SELECT 1
        FROM public.event_hosts eh
        WHERE eh.event_id = p_event_id
          AND eh.user_id = p_user_id
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_event_host(UUID, UUID) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.event_host_count(
    p_event_id UUID
) RETURNS INTEGER AS $$
    SELECT count(*)::INTEGER
    FROM public.event_hosts eh
    WHERE eh.event_id = p_event_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.event_host_count(UUID) TO anon, authenticated;

-- Events: Anyone can read, only host can create/update
CREATE POLICY "Public events are viewable by everyone" ON public.events
    FOR SELECT USING (true);

CREATE POLICY "Hosts can create events" ON public.events
    FOR INSERT WITH CHECK (auth.uid() = host_user_id);

CREATE POLICY "Hosts can update their own events" ON public.events
    FOR UPDATE USING (
        auth.uid() = host_user_id
        OR auth.uid() IN (
            SELECT eh.user_id
            FROM public.event_hosts eh
            WHERE eh.event_id = events.id
        )
    );

-- Attendees: Anyone can read (for attendee preview), anyone can insert (RSVP), only host or owner can update
CREATE POLICY "Attendees are viewable by everyone" ON public.event_attendees
    FOR SELECT USING (true);

CREATE POLICY "Anyone can RSVP" ON public.event_attendees
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Hosts or owners can update attendee status" ON public.event_attendees
    FOR UPDATE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        ) OR auth.uid() IN (
            SELECT eh.user_id FROM public.event_hosts eh WHERE eh.event_id = event_id
        ) OR auth.uid() = user_id
    );

CREATE POLICY "Hosts can delete their own events" ON public.events
    FOR DELETE USING (
        auth.uid() = host_user_id
        OR auth.uid() IN (
            SELECT eh.user_id
            FROM public.event_hosts eh
            WHERE eh.event_id = events.id
        )
    );

CREATE POLICY "Hosts can delete attendees" ON public.event_attendees
    FOR DELETE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        )
        OR auth.uid() IN (
            SELECT eh.user_id FROM public.event_hosts eh WHERE eh.event_id = event_id
        )
    );

CREATE POLICY "Hosts can view event host rows" ON public.event_hosts
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND public.is_event_host(event_id, auth.uid())
    );

CREATE POLICY "Hosts can add co-host rows" ON public.event_hosts
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND public.is_event_host(event_id, auth.uid())
    );

CREATE POLICY "Hosts can leave their own host row" ON public.event_hosts
    FOR DELETE USING (
        auth.uid() = user_id
        AND public.event_host_count(event_id) > 1
    );

-- Waitlist positions: Anyone can read, managed by system/host
CREATE POLICY "Waitlist positions are viewable by everyone" ON public.event_waitlist_positions
    FOR SELECT USING (true);

CREATE POLICY "Anyone can create event access requests" ON public.event_access_requests
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Hosts can view event access requests" ON public.event_access_requests
    FOR SELECT USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        )
        OR auth.uid() IN (
            SELECT eh.user_id FROM public.event_hosts eh WHERE eh.event_id = event_id
        )
    );

CREATE POLICY "Hosts can update event access requests" ON public.event_access_requests
    FOR UPDATE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        )
        OR auth.uid() IN (
            SELECT eh.user_id FROM public.event_hosts eh WHERE eh.event_id = event_id
        )
    );

-- 3. Functions & Triggers

-- Function to handle waitlist promotion when someone cancels
CREATE OR REPLACE FUNCTION public.handle_attendee_cancellation()
RETURNS TRIGGER AS $$
DECLARE
    next_waitlist_id UUID;
    event_capacity INTEGER;
    current_confirmed_count INTEGER;
BEGIN
    IF NEW.status = 'cancelled' AND OLD.status = 'confirmed' THEN
        -- Get event capacity
        SELECT capacity INTO event_capacity FROM public.events WHERE id = NEW.event_id;
        
        -- Count current confirmed (excluding the one just cancelled)
        SELECT count(*) INTO current_confirmed_count FROM public.event_attendees 
        WHERE event_id = NEW.event_id AND status = 'confirmed';

        -- If we have space, promote the first person from waitlist
        IF current_confirmed_count < event_capacity THEN
            SELECT attendee_id INTO next_waitlist_id 
            FROM public.event_waitlist_positions 
            WHERE event_id = NEW.event_id 
            ORDER BY position ASC 
            LIMIT 1;

            IF next_waitlist_id IS NOT NULL THEN
                -- Promote attendee
                UPDATE public.event_attendees 
                SET status = 'confirmed', promoted_at = now() 
                WHERE id = next_waitlist_id;

                -- Remove from waitlist positions
                DELETE FROM public.event_waitlist_positions WHERE attendee_id = next_waitlist_id;

                -- Reorder remaining waitlist positions
                UPDATE public.event_waitlist_positions
                SET position = position - 1
                WHERE event_id = NEW.event_id;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Thinking-about-it rows
CREATE TABLE IF NOT EXISTS public.event_interests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    attendee_profile_id UUID REFERENCES public.attendee_profiles(id) ON DELETE SET NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    visibility_mode TEXT NOT NULL DEFAULT 'named' CHECK (visibility_mode IN ('count_only', 'named')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_interests_event_id_created_at_idx
    ON public.event_interests (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS events_public_discovery_status_starts_at_idx
    ON public.events (public_discovery_enabled, status, starts_at);

CREATE INDEX IF NOT EXISTS events_moderation_status_idx
    ON public.events (moderation_status);

CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_user_uidx
    ON public.event_interests (event_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_profile_uidx
    ON public.event_interests (event_id, attendee_profile_id)
    WHERE attendee_profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_interests_event_email_uidx
    ON public.event_interests (event_id, lower(guest_email));

ALTER TABLE public.event_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view count-only interest rows" ON public.event_interests
    FOR SELECT USING (visibility_mode = 'count_only');

CREATE POLICY "Hosts and members can view named interest rows" ON public.event_interests
    FOR SELECT USING (
        auth.uid() IS NOT NULL
        AND (
            auth.uid() IN (
                SELECT e.host_user_id
                FROM public.events e
                WHERE e.id = event_id
            )
            OR auth.uid() IN (
                SELECT eh.user_id
                FROM public.event_hosts eh
                WHERE eh.event_id = event_id
            )
            OR auth.uid() IN (
                SELECT ea.user_id
                FROM public.event_attendees ea
                WHERE ea.event_id = event_id
                  AND ea.status <> 'cancelled'
                  AND ea.user_id IS NOT NULL
            )
            OR auth.uid() IN (
                SELECT ap.user_id
                FROM public.attendee_profiles ap
                WHERE ap.id = attendee_profile_id
            )
        )
    );

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.apply_event_moderation_defaults()
RETURNS TRIGGER AS $$
DECLARE
    next_visibility TEXT := COALESCE(NEW.visibility, CASE WHEN COALESCE(NEW.is_public, false) THEN 'public' ELSE 'private' END);
    should_reset BOOLEAN := false;
BEGIN
    IF NEW.moderation_reasons IS NULL THEN
        NEW.moderation_reasons := ARRAY[]::TEXT[];
    END IF;

    IF TG_OP = 'INSERT' THEN
        should_reset := true;
    ELSE
        should_reset := NEW.visibility IS DISTINCT FROM OLD.visibility
            OR NEW.title IS DISTINCT FROM OLD.title
            OR NEW.description IS DISTINCT FROM OLD.description
            OR NEW.public_summary IS DISTINCT FROM OLD.public_summary
            OR NEW.location_text IS DISTINCT FROM OLD.location_text
            OR NEW.public_location_text IS DISTINCT FROM OLD.public_location_text;
    END IF;

    IF next_visibility = 'private' THEN
        NEW.public_discovery_enabled := false;
        NEW.moderation_status := 'not_required';
        NEW.moderation_risk_level := NULL;
        NEW.moderation_action := NULL;
        NEW.moderation_confidence := NULL;
        NEW.moderation_reasons := ARRAY[]::TEXT[];
        NEW.moderation_input_hash := NULL;
        NEW.moderated_at := NULL;
        RETURN NEW;
    END IF;

    IF NEW.moderation_override IS NOT NULL THEN
        CASE NEW.moderation_override
            WHEN 'force_visible', 'mark_safe' THEN
                NEW.public_discovery_enabled := true;
                NEW.moderation_status := 'approved';
                NEW.moderation_action := 'allow';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'force_limited' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'limited';
                NEW.moderation_action := 'limit_visibility';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'hide' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'review';
                NEW.moderation_action := 'require_review';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
            WHEN 'mark_spam' THEN
                NEW.public_discovery_enabled := false;
                NEW.moderation_status := 'blocked';
                NEW.moderation_risk_level := 'high';
                NEW.moderation_action := 'block';
                NEW.moderated_at := COALESCE(NEW.moderated_at, now());
        END CASE;
        RETURN NEW;
    END IF;

    IF should_reset THEN
        NEW.public_discovery_enabled := false;
        NEW.moderation_status := 'pending';
        NEW.moderation_risk_level := NULL;
        NEW.moderation_action := NULL;
        NEW.moderation_confidence := NULL;
        NEW.moderation_reasons := ARRAY[]::TEXT[];
        NEW.moderation_input_hash := NULL;
        NEW.moderated_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_interests_touch_updated_at
    BEFORE UPDATE ON public.event_interests
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER events_apply_moderation_defaults
    BEFORE INSERT OR UPDATE ON public.events
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_event_moderation_defaults();

CREATE OR REPLACE FUNCTION public.toggle_event_interest(
    p_event_id UUID,
    p_guest_name TEXT,
    p_guest_email TEXT,
    p_visibility_mode TEXT DEFAULT 'named',
    p_user_id UUID DEFAULT NULL,
    p_attendee_profile_id UUID DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_name TEXT;
    v_email TEXT;
    v_existing_id UUID;
    v_existing_visibility_mode TEXT;
    v_active_rsvp_id UUID;
    v_interest_id UUID;
BEGIN
    v_name := trim(coalesce(p_guest_name, ''));
    v_email := lower(trim(coalesce(p_guest_email, '')));

    IF p_event_id IS NULL OR v_name = '' OR v_email = '' THEN
        RETURN json_build_object('error', 'Missing interest details');
    END IF;

    IF p_visibility_mode NOT IN ('count_only', 'named') THEN
        RETURN json_build_object('error', 'Invalid visibility mode');
    END IF;

    SELECT ea.id
    INTO v_active_rsvp_id
    FROM public.event_attendees ea
    WHERE ea.event_id = p_event_id
      AND ea.status <> 'cancelled'
      AND coalesce(ea.added_by_type, 'self') <> 'proxy'
      AND (
        lower(ea.guest_email) = v_email
        OR (p_attendee_profile_id IS NOT NULL AND ea.attendee_profile_id = p_attendee_profile_id)
        OR (p_user_id IS NOT NULL AND ea.user_id = p_user_id)
      )
    LIMIT 1;

    IF v_active_rsvp_id IS NOT NULL THEN
        RETURN json_build_object('error', 'You are already in this activity');
    END IF;

    SELECT ei.id, ei.visibility_mode
    INTO v_existing_id, v_existing_visibility_mode
    FROM public.event_interests ei
    WHERE ei.event_id = p_event_id
      AND (
        (p_user_id IS NOT NULL AND ei.user_id = p_user_id)
        OR (p_attendee_profile_id IS NOT NULL AND ei.attendee_profile_id = p_attendee_profile_id)
        OR lower(ei.guest_email) = v_email
      )
    ORDER BY ei.created_at DESC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        IF v_existing_visibility_mode = p_visibility_mode THEN
            DELETE FROM public.event_interests
            WHERE id = v_existing_id;
            RETURN json_build_object('success', true, 'removed', true);
        END IF;

        UPDATE public.event_interests
        SET
            guest_name = v_name,
            guest_email = v_email,
            user_id = p_user_id,
            attendee_profile_id = p_attendee_profile_id,
            visibility_mode = p_visibility_mode,
            updated_at = now()
        WHERE id = v_existing_id;

        RETURN json_build_object('success', true, 'removed', false);
    END IF;

    INSERT INTO public.event_interests (
        event_id,
        user_id,
        attendee_profile_id,
        guest_name,
        guest_email,
        visibility_mode
    )
    VALUES (
        p_event_id,
        p_user_id,
        p_attendee_profile_id,
        v_name,
        v_email,
        p_visibility_mode
    )
    RETURNING id INTO v_interest_id;

    RETURN json_build_object('success', true, 'removed', false, 'interest_id', v_interest_id);
EXCEPTION
    WHEN unique_violation THEN
        RETURN json_build_object('error', 'Interest already exists for this activity');
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.toggle_event_interest(UUID, TEXT, TEXT, TEXT, UUID, UUID) TO anon, authenticated;

CREATE TRIGGER on_attendee_cancelled
    AFTER UPDATE ON public.event_attendees
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_attendee_cancellation();

-- Function to handle waitlist promotion when someone is deleted
CREATE OR REPLACE FUNCTION public.handle_attendee_deletion()
RETURNS TRIGGER AS $$
DECLARE
    next_waitlist_id UUID;
    event_capacity INTEGER;
    current_confirmed_count INTEGER;
BEGIN
    IF OLD.status = 'confirmed' THEN
        -- Get event capacity
        SELECT capacity INTO event_capacity FROM public.events WHERE id = OLD.event_id;
        
        -- Count current confirmed
        SELECT count(*) INTO current_confirmed_count FROM public.event_attendees 
        WHERE event_id = OLD.event_id AND status = 'confirmed';

        -- If we have space, promote the first person from waitlist
        IF current_confirmed_count < event_capacity THEN
            SELECT attendee_id INTO next_waitlist_id 
            FROM public.event_waitlist_positions 
            WHERE event_id = OLD.event_id 
            ORDER BY position ASC 
            LIMIT 1;

            IF next_waitlist_id IS NOT NULL THEN
                -- Promote attendee
                UPDATE public.event_attendees 
                SET status = 'confirmed', promoted_at = now() 
                WHERE id = next_waitlist_id;

                -- Remove from waitlist positions
                DELETE FROM public.event_waitlist_positions WHERE attendee_id = next_waitlist_id;

                -- Reorder remaining waitlist positions
                UPDATE public.event_waitlist_positions
                SET position = position - 1
                WHERE event_id = OLD.event_id;
            END IF;
        END IF;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_attendee_deleted
    AFTER DELETE ON public.event_attendees
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_attendee_deletion();

-- Function to handle RSVP logic (Atomic)
CREATE OR REPLACE FUNCTION public.rsvp_to_event(
    p_event_id UUID,
    p_user_id UUID,
    p_guest_name TEXT,
    p_guest_email TEXT
) RETURNS JSON AS $$
DECLARE
    v_capacity INTEGER;
    v_confirmed_count INTEGER;
    v_waitlist_enabled BOOLEAN;
    v_status TEXT;
    v_attendee_id UUID;
    v_waitlist_pos INTEGER;
    v_existing_id UUID;
    v_existing_status TEXT;
BEGIN
    -- Check event exists and get capacity
    SELECT capacity, allow_waitlist INTO v_capacity, v_waitlist_enabled 
    FROM public.events WHERE id = p_event_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Event not found');
    END IF;

    -- Check for existing RSVP
    SELECT id, status INTO v_existing_id, v_existing_status
    FROM public.event_attendees
    WHERE event_id = p_event_id AND guest_email = p_guest_email;

    IF v_existing_id IS NOT NULL AND v_existing_status != 'cancelled' THEN
        RETURN json_build_object('error', 'You have already RSVPed to this event');
    END IF;

    -- Count current confirmed
    SELECT count(*) INTO v_confirmed_count 
    FROM public.event_attendees 
    WHERE event_id = p_event_id AND status = 'confirmed';

    -- Determine status
    IF v_confirmed_count < v_capacity THEN
        v_status := 'confirmed';
    ELSIF v_waitlist_enabled THEN
        v_status := 'waitlist';
    ELSE
        RETURN json_build_object('error', 'Event is full and waitlist is disabled');
    END IF;

    -- If existing cancelled RSVP, update it, otherwise insert
    IF v_existing_id IS NOT NULL THEN
        UPDATE public.event_attendees
        SET status = v_status, guest_name = p_guest_name, user_id = p_user_id, joined_at = now(), cancelled_at = null
        WHERE id = v_existing_id
        RETURNING id INTO v_attendee_id;
    ELSE
        INSERT INTO public.event_attendees (event_id, user_id, guest_name, guest_email, status)
        VALUES (p_event_id, p_user_id, p_guest_name, p_guest_email, v_status)
        RETURNING id INTO v_attendee_id;
    END IF;

    -- If waitlist, add to positions
    IF v_status = 'waitlist' THEN
        SELECT COALESCE(max(position), 0) + 1 INTO v_waitlist_pos 
        FROM public.event_waitlist_positions WHERE event_id = p_event_id;
        
        INSERT INTO public.event_waitlist_positions (event_id, attendee_id, position)
        VALUES (p_event_id, v_attendee_id, v_waitlist_pos);
    END IF;

    RETURN json_build_object('success', true, 'status', v_status, 'attendee_id', v_attendee_id);
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

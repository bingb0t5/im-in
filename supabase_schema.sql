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

-- 2. RLS Policies

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_waitlist_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_access_requests ENABLE ROW LEVEL SECURITY;

-- Events: Anyone can read, only host can create/update
CREATE POLICY "Public events are viewable by everyone" ON public.events
    FOR SELECT USING (true);

CREATE POLICY "Hosts can create events" ON public.events
    FOR INSERT WITH CHECK (auth.uid() = host_user_id);

CREATE POLICY "Hosts can update their own events" ON public.events
    FOR UPDATE USING (auth.uid() = host_user_id);

-- Attendees: Anyone can read (for attendee preview), anyone can insert (RSVP), only host or owner can update
CREATE POLICY "Attendees are viewable by everyone" ON public.event_attendees
    FOR SELECT USING (true);

CREATE POLICY "Anyone can RSVP" ON public.event_attendees
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Hosts or owners can update attendee status" ON public.event_attendees
    FOR UPDATE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        ) OR auth.uid() = user_id
    );

CREATE POLICY "Hosts can delete their own events" ON public.events
    FOR DELETE USING (auth.uid() = host_user_id);

CREATE POLICY "Hosts can delete attendees" ON public.event_attendees
    FOR DELETE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
        )
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
    );

CREATE POLICY "Hosts can update event access requests" ON public.event_access_requests
    FOR UPDATE USING (
        auth.uid() IN (
            SELECT host_user_id FROM public.events WHERE id = event_id
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

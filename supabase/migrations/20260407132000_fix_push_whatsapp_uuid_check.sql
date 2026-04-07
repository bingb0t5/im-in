CREATE OR REPLACE FUNCTION public.assert_user_has_whatsapp_link(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_has_link BOOLEAN := false;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.attendee_profiles ap
        WHERE ap.user_id = p_user_id
          AND ap.lalo_user_id IS NOT NULL
    ) INTO v_has_link;

    IF NOT v_has_link THEN
        RAISE EXCEPTION 'Push notifications require a linked WhatsApp account.';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

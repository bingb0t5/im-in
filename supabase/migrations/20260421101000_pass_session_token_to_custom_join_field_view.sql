DROP FUNCTION IF EXISTS public.get_event_custom_join_field_config_for_view(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_event_custom_join_field_config_for_view(
  p_slug TEXT,
  p_access_code TEXT DEFAULT NULL,
  p_session_token TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_config JSONB;
BEGIN
  SELECT e.custom_join_field_config
  INTO v_config
  FROM public.get_event_for_view(p_slug, p_access_code, p_session_token) ev
  JOIN public.events e ON e.id = ev.id
  WHERE ev.can_view_full_details = true
  LIMIT 1;

  RETURN v_config;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_event_custom_join_field_config_for_view(TEXT, TEXT, TEXT) TO anon, authenticated;

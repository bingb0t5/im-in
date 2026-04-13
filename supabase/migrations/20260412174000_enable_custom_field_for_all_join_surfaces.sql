-- Ensure custom join field is available on all join/add-to-list surfaces.
-- 1) Allow hosts to create/update/delete custom answer rows directly from host UI.
-- 2) Expose custom join field config through a safe view RPC for signed-out viewers.

ALTER TABLE public.event_signup_field_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts can insert custom signup answers" ON public.event_signup_field_answers;
CREATE POLICY "Hosts can insert custom signup answers"
  ON public.event_signup_field_answers
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_event_host(event_id, auth.uid())
  );

DROP POLICY IF EXISTS "Hosts can update custom signup answers" ON public.event_signup_field_answers;
CREATE POLICY "Hosts can update custom signup answers"
  ON public.event_signup_field_answers
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND public.is_event_host(event_id, auth.uid())
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_event_host(event_id, auth.uid())
  );

DROP POLICY IF EXISTS "Hosts can delete custom signup answers" ON public.event_signup_field_answers;
CREATE POLICY "Hosts can delete custom signup answers"
  ON public.event_signup_field_answers
  FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND public.is_event_host(event_id, auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_signup_field_answers TO authenticated;

CREATE OR REPLACE FUNCTION public.get_event_custom_join_field_config_for_view(
  p_slug TEXT,
  p_access_code TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_config JSONB;
BEGIN
  SELECT e.custom_join_field_config
  INTO v_config
  FROM public.get_event_for_view(p_slug, p_access_code) ev
  JOIN public.events e ON e.id = ev.id
  WHERE ev.can_view_full_details = true
  LIMIT 1;

  RETURN v_config;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_event_custom_join_field_config_for_view(TEXT, TEXT) TO anon, authenticated;

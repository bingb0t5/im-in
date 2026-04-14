CREATE INDEX IF NOT EXISTS attendee_profiles_whatsapp_normalized_idx
  ON public.attendee_profiles ((nullif(regexp_replace(coalesce(whatsapp_number, ''), '\D', '', 'g'), '')));

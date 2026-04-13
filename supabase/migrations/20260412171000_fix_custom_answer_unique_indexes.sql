-- Fix ON CONFLICT targets for custom signup answers.
-- The initial migration created partial unique indexes, which Postgres cannot
-- infer for ON CONFLICT(column) without a matching predicate clause.
-- Replace with plain unique indexes (NULLs remain effectively ignored).

DROP INDEX IF EXISTS public.event_signup_field_answers_attendee_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS event_signup_field_answers_attendee_uidx
  ON public.event_signup_field_answers (event_attendee_id);

DROP INDEX IF EXISTS public.event_signup_field_answers_join_request_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS event_signup_field_answers_join_request_uidx
  ON public.event_signup_field_answers (event_join_request_id);

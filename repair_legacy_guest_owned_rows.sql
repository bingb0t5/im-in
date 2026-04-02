-- One-off repair for legacy rows that were saved against a browser-local guest
-- attendee profile instead of the signed-in user's real attendee profile.
--
-- How to use:
-- 1) Set `target_email` to the signed-in account email that should own the rows.
-- 2) Set `source_profile_ids` to the guest-only attendee_profile ids you want to merge.
--    Example ids from your CSV are values like:
--      c2a02f60-b054-4eac-8301-57619fd3518c
--      ed455afb-b957-4984-834a-412cc7fda9cf
--      f062ed69-ccba-40df-b7d8-fccc32d49c7b
--      1688c228-9c2f-44c8-a431-1830dd32fa40
--      6dc6b3d8-1e1b-4292-8379-b1c2e70da0b3
-- 3) Run the preview query first and verify the target/source rows are correct.
-- 4) Uncomment the transaction block at the bottom and run it.

WITH params AS (
    SELECT
        lower('replace-with-your-account-email@example.com')::text AS target_email,
        ARRAY[
            '00000000-0000-0000-0000-000000000000'::uuid
            -- Add more source profile ids here, comma-separated.
        ]::uuid[] AS source_profile_ids
),
target_profile AS (
    SELECT ap.*
    FROM public.attendee_profiles ap
    CROSS JOIN params p
    WHERE lower(coalesce(ap.email, '')) = p.target_email
    ORDER BY
        CASE WHEN ap.user_id IS NOT NULL THEN 0 ELSE 1 END,
        ap.updated_at DESC NULLS LAST,
        ap.created_at DESC NULLS LAST
    LIMIT 1
),
source_profiles AS (
    SELECT ap.*
    FROM public.attendee_profiles ap
    CROSS JOIN params p
    WHERE ap.id = ANY(p.source_profile_ids)
)
SELECT
    'target_profile' AS row_type,
    tp.id,
    tp.user_id,
    tp.email,
    tp.first_name,
    tp.last_name,
    tp.created_at,
    tp.updated_at
FROM target_profile tp

UNION ALL

SELECT
    'source_profile' AS row_type,
    sp.id,
    sp.user_id,
    sp.email,
    sp.first_name,
    sp.last_name,
    sp.created_at,
    sp.updated_at
FROM source_profiles sp
ORDER BY row_type, updated_at DESC NULLS LAST;

-- Preview impacted rows before changing anything.
WITH params AS (
    SELECT ARRAY[
        '00000000-0000-0000-0000-000000000000'::uuid
        -- Add the same source profile ids here.
    ]::uuid[] AS source_profile_ids
)
SELECT
    'event_attendees.attendee_profile_id' AS relation,
    count(*)::bigint AS row_count
FROM public.event_attendees ea
CROSS JOIN params p
WHERE ea.attendee_profile_id = ANY(p.source_profile_ids)

UNION ALL

SELECT
    'event_attendees.added_by_attendee_profile_id' AS relation,
    count(*)::bigint AS row_count
FROM public.event_attendees ea
CROSS JOIN params p
WHERE ea.added_by_attendee_profile_id = ANY(p.source_profile_ids)

UNION ALL

SELECT
    'event_interests.attendee_profile_id' AS relation,
    count(*)::bigint AS row_count
FROM public.event_interests ei
CROSS JOIN params p
WHERE ei.attendee_profile_id = ANY(p.source_profile_ids)

UNION ALL

SELECT
    'event_join_requests.attendee_profile_id' AS relation,
    count(*)::bigint AS row_count
FROM public.event_join_requests jr
CROSS JOIN params p
WHERE jr.attendee_profile_id = ANY(p.source_profile_ids)

UNION ALL

SELECT
    'attendee_sessions.attendee_profile_id' AS relation,
    count(*)::bigint AS row_count
FROM public.attendee_sessions s
CROSS JOIN params p
WHERE s.attendee_profile_id = ANY(p.source_profile_ids);

-- Uncomment everything below only after the previews look correct.
--
-- BEGIN;
--
-- WITH params AS (
--     SELECT
--         lower('replace-with-your-account-email@example.com')::text AS target_email,
--         ARRAY[
--             '00000000-0000-0000-0000-000000000000'::uuid
--             -- Add the source profile ids here.
--         ]::uuid[] AS source_profile_ids
-- ),
-- target_profile AS (
--     SELECT ap.*
--     FROM public.attendee_profiles ap
--     CROSS JOIN params p
--     WHERE lower(coalesce(ap.email, '')) = p.target_email
--     ORDER BY
--         CASE WHEN ap.user_id IS NOT NULL THEN 0 ELSE 1 END,
--         ap.updated_at DESC NULLS LAST,
--         ap.created_at DESC NULLS LAST
--     LIMIT 1
-- ),
-- source_profiles AS (
--     SELECT ap.*
--     FROM public.attendee_profiles ap
--     CROSS JOIN params p
--     WHERE ap.id = ANY(p.source_profile_ids)
-- ),
-- delete_duplicate_interests AS (
--     DELETE FROM public.event_interests src
--     USING target_profile tp, params p
--     WHERE src.attendee_profile_id = ANY(p.source_profile_ids)
--       AND EXISTS (
--           SELECT 1
--           FROM public.event_interests tgt
--           WHERE tgt.attendee_profile_id = tp.id
--             AND tgt.event_id = src.event_id
--       )
-- ),
-- delete_duplicate_join_requests AS (
--     DELETE FROM public.event_join_requests src
--     USING target_profile tp, params p
--     WHERE src.attendee_profile_id = ANY(p.source_profile_ids)
--       AND src.status = 'pending'
--       AND EXISTS (
--           SELECT 1
--           FROM public.event_join_requests tgt
--           WHERE tgt.attendee_profile_id = tp.id
--             AND tgt.event_id = src.event_id
--             AND tgt.status = 'pending'
--       )
-- ),
-- move_attendee_rows AS (
--     UPDATE public.event_attendees ea
--     SET
--         attendee_profile_id = tp.id,
--         user_id = COALESCE(ea.user_id, tp.user_id)
--     FROM target_profile tp, params p
--     WHERE ea.attendee_profile_id = ANY(p.source_profile_ids)
-- ),
-- move_added_by_rows AS (
--     UPDATE public.event_attendees ea
--     SET added_by_attendee_profile_id = tp.id
--     FROM target_profile tp, params p
--     WHERE ea.added_by_attendee_profile_id = ANY(p.source_profile_ids)
-- ),
-- move_interest_rows AS (
--     UPDATE public.event_interests ei
--     SET
--         attendee_profile_id = tp.id,
--         user_id = COALESCE(ei.user_id, tp.user_id)
--     FROM target_profile tp, params p
--     WHERE ei.attendee_profile_id = ANY(p.source_profile_ids)
-- ),
-- move_join_request_rows AS (
--     UPDATE public.event_join_requests jr
--     SET
--         attendee_profile_id = tp.id,
--         user_id = COALESCE(jr.user_id, tp.user_id)
--     FROM target_profile tp, params p
--     WHERE jr.attendee_profile_id = ANY(p.source_profile_ids)
-- ),
-- move_session_rows AS (
--     UPDATE public.attendee_sessions s
--     SET attendee_profile_id = tp.id
--     FROM target_profile tp, params p
--     WHERE s.attendee_profile_id = ANY(p.source_profile_ids)
-- ),
-- update_target_profile AS (
--     UPDATE public.attendee_profiles ap
--     SET
--         user_id = COALESCE(ap.user_id, tp.user_id),
--         updated_at = now()
--     FROM target_profile tp
--     WHERE ap.id = tp.id
--     RETURNING ap.id
-- )
-- DELETE FROM public.attendee_profiles ap
-- USING params p, target_profile tp
-- WHERE ap.id = ANY(p.source_profile_ids)
--   AND ap.id <> tp.id;
--
-- COMMIT;

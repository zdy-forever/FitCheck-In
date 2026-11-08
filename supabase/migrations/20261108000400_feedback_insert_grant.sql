-- PostgREST sends every payload column in the INSERT, and Postgres checks column
-- privileges before BEFORE-triggers run. Allow trainer_id in the insert column list;
-- validate_feedback() unconditionally overwrites it from the referenced session, so a
-- client cannot attribute feedback to another trainer.
grant insert (trainer_id) on public.post_session_feedback to authenticated;

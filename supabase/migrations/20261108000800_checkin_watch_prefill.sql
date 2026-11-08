-- Check-in answers that were pre-filled from Apple Watch data (and left unchanged by the client).
--
-- Why it is stored:
--  * The coach must be able to tell a self-reported answer from one derived from the watch.
--  * Readiness already uses HRV / resting HR / sleep directly; adding a check-in answer that was
--    itself derived from those signals would count them twice. The snapshot job skips the
--    check-in adjustment for any field listed here.
alter table public.pre_session_checkins
  add column watch_prefilled text[] not null default '{}'
  constraint checkins_watch_prefilled_fields check (watch_prefilled <@ array['sleep_quality', 'energy_level']::text[]);

comment on column public.pre_session_checkins.watch_prefilled is
  'Answers pre-filled from Apple Watch data and not edited by the client (subset of sleep_quality, energy_level).';

grant insert (watch_prefilled) on public.pre_session_checkins to authenticated;
grant update (watch_prefilled) on public.pre_session_checkins to authenticated;

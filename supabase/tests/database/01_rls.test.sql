-- pgTAP Row Level Security tests. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(86);

-- ─────────────────────────── fixtures (as superuser) ─────────────────
-- Users are created through auth.users so the real handle_new_user trigger runs.
insert into auth.users (id, email, raw_user_meta_data, aud, role, instance_id)
values
  ('00000000-0000-0000-0000-0000000000a1', 'trainer.a@test.local', '{"role":"trainer","display_name":"Trainer A","time_zone":"Australia/Sydney"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000b1', 'trainer.b@test.local', '{"role":"trainer","display_name":"Trainer B"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000c1', 'client.c@test.local', '{"role":"client","display_name":"Client C","locale":"zh-CN"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-0000000000d1', 'client.d@test.local', '{"role":"client","display_name":"Client D"}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'trainer', 'sign-up trigger creates trainer profile');
select is((select locale from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'zh-CN', 'locale taken from metadata');
select is((select time_zone from public.profiles where id = '00000000-0000-0000-0000-0000000000d1'), 'UTC', 'time zone defaults to UTC');

select throws_ok(
  $$insert into auth.users (id, email, raw_user_meta_data, aud, role, instance_id)
    values ('00000000-0000-0000-0000-0000000000e1', 'norole@test.local', '{}', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000')$$,
  '22023', 'role_required', 'sign-up without a role is rejected');

-- Impersonation helpers.
create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- ───────────────────────────── anonymous ─────────────────────────────
select pg_temp.as_anon();
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.health_samples', '42501', null, 'anon cannot read health samples');
select throws_ok($$select public.accept_invitation('ABCDEFGH')$$, '42501', null, 'anon cannot accept invitations');
select throws_ok($$select * from public.trainer_client_overview()$$, '42501', null, 'anon cannot call trainer overview');
select throws_ok($$select public.delete_my_health_data()$$, '42501', null, 'anon cannot call delete_my_health_data');

-- ───────────────────────────── profiles ──────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.profiles), 1, 'trainer sees only own profile before linking');
select throws_ok($$update public.profiles set role = 'client' where id = auth.uid()$$, '42501', null, 'role column is not updatable');
select throws_ok($$update public.profiles set is_demo = true where id = auth.uid()$$, '42501', null, 'is_demo is not updatable');
select lives_ok($$update public.profiles set display_name = 'Coach A' where id = auth.uid()$$, 'display name is updatable');
select throws_ok($$update public.profiles set time_zone = 'Mars/Olympus' where id = auth.uid()$$, '22023', 'invalid_time_zone', 'time zone validated');
update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.as_admin();
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'Client C', 'cannot update another profile');

-- ───────────────────────────── invitations ───────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$insert into public.trainer_invitations (trainer_id) values (auth.uid())$$, '42501', null, 'clients cannot create invitations');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into public.trainer_invitations (trainer_id, note) values (auth.uid(), 'welcome')$$, 'trainer creates invitation');
select throws_ok($$insert into public.trainer_invitations (trainer_id) values ('00000000-0000-0000-0000-0000000000b1')$$, '42501', null, 'cannot create invitation for another trainer');
select throws_ok($$insert into public.trainer_invitations (trainer_id, code) values (auth.uid(), 'AAAAAAAA')$$, '42501', null, 'invitation code is server-generated');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.trainer_invitations), 0, 'trainer B cannot see trainer A invitations');
insert into public.trainer_invitations (trainer_id, invitee_email) values (auth.uid(), 'someone.else@test.local');

select pg_temp.as_admin();
create temp table codes as
  select (select code from public.trainer_invitations where trainer_id = '00000000-0000-0000-0000-0000000000a1') as a_code,
         (select code from public.trainer_invitations where trainer_id = '00000000-0000-0000-0000-0000000000b1') as b_code;
grant select on codes to authenticated;
select matches((select a_code from codes), '^[A-HJ-NP-Z2-9]{8}$', 'invitation code format');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.accept_invitation((select a_code from codes))$$, '42501', 'only_clients_can_accept', 'trainer cannot accept invitations');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select trainer_name from public.get_invitation_preview(lower((select a_code from codes)))), 'Coach A', 'invitation preview (case-insensitive)');
select throws_ok($$select public.accept_invitation('ZZZZZZZZ')$$, 'P0002', 'invitation_not_found', 'unknown code rejected');
select throws_ok($$select public.accept_invitation((select b_code from codes))$$, '42501', 'invitation_email_mismatch', 'email-bound invitation enforces invitee');
select isnt(public.accept_invitation((select a_code from codes), array['hrv', 'sleep', 'scores']::public.health_category[]), null, 'client C accepts trainer A with hrv+sleep+scores');
select throws_ok($$select public.accept_invitation((select a_code from codes))$$, '22023', 'invitation_not_pending', 'invitation is single-use');

select pg_temp.as_admin();
-- Client C is also linked to trainer B (multiple trainers), sharing nothing.
insert into public.trainer_invitations (trainer_id, code) values ('00000000-0000-0000-0000-0000000000b1', 'BBBBCCCC');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select isnt(public.accept_invitation('BBBBCCCC'), null, 'client C also accepts trainer B (no health sharing)');
select is((select count(*)::int from public.trainer_client_relationships), 2, 'client sees both relationships');
select is((select count(*)::int from public.health_sharing_permissions where granted), 3, 'exactly three categories granted');

-- Client D links to trainer A.
select pg_temp.as_admin();
insert into public.trainer_invitations (trainer_id, code) values ('00000000-0000-0000-0000-0000000000a1', 'DDDDEEEE');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$select public.accept_invitation('DDDDEEEE')$$, 'client D accepts trainer A');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.profiles), 3, 'trainer A sees own + two client profiles');
select throws_ok($$insert into public.trainer_client_relationships (trainer_id, client_id) values (auth.uid(), '00000000-0000-0000-0000-0000000000b1')$$, '42501', null, 'relationships cannot be inserted directly');
select is((select count(*)::int from public.trainer_client_overview()), 2, 'trainer overview lists two clients');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.profiles), 2, 'client D sees self + trainer A only');

-- ───────────────────────────── sessions ──────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$insert into public.training_sessions (id, trainer_id, client_id, scheduled_at, title)
  values ('10000000-0000-0000-0000-000000000001', auth.uid(), '00000000-0000-0000-0000-0000000000c1', now() + interval '1 day', 'Lower body')$$,
  'trainer schedules a session with own client');
select throws_ok($$insert into public.training_sessions (trainer_id, client_id, scheduled_at)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000b1', now())$$, '42501', 'no_active_relationship', 'cannot schedule with a non-client');
select lives_ok($$insert into public.session_exercises (session_id, name, sets, reps, weight_kg) values ('10000000-0000-0000-0000-000000000001', 'Back squat', 5, 5, 100)$$, 'trainer adds exercise');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.training_sessions), 0, 'trainer B cannot see trainer A sessions');
select is((select count(*)::int from public.session_exercises), 0, 'trainer B cannot see trainer A exercises');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select count(*)::int from public.session_exercises), 1, 'client sees exercises of own session');
select throws_ok($$insert into public.training_sessions (trainer_id, client_id, scheduled_at) values ('00000000-0000-0000-0000-0000000000a1', auth.uid(), now())$$, '42501', null, 'clients cannot create sessions');

-- ───────────────────────────── check-ins ─────────────────────────────
select lives_ok($$insert into public.pre_session_checkins (id, client_id, trainer_id, session_id, sleep_quality, energy_level, muscle_soreness, pain_level, mental_state, training_goal)
  values ('20000000-0000-0000-0000-000000000001', auth.uid(), '00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 4, 3, 2, 0, 4, 'Squat technique')$$,
  'client submits a check-in to trainer A');
select throws_ok($$insert into public.pre_session_checkins (client_id, trainer_id, sleep_quality, energy_level, muscle_soreness, pain_level, mental_state, training_goal)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000a1', 6, 3, 2, 0, 4, 'x')$$, '23514', null, 'sleep quality out of range rejected');
select throws_ok($$insert into public.pre_session_checkins (client_id, trainer_id, sleep_quality, energy_level, muscle_soreness, pain_level, mental_state, training_goal)
  values (auth.uid(), '00000000-0000-0000-0000-0000000000a1', 3, 3, 2, 0, 4, '   ')$$, '23514', null, 'blank training goal rejected');
select throws_ok($$insert into public.pre_session_checkins (client_id, trainer_id, sleep_quality, energy_level, muscle_soreness, pain_level, mental_state, training_goal)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 3, 3, 2, 0, 4, 'spoof')$$, '42501', null, 'cannot submit a check-in as someone else');
select throws_ok($$update public.pre_session_checkins set reviewed_at = now()$$, '42501', null, 'client cannot mark own check-in reviewed');
select lives_ok($$update public.pre_session_checkins set watch_prefilled = '{sleep_quality,energy_level}'$$, 'client can mark answers as pre-filled from the watch');
select throws_ok($$update public.pre_session_checkins set watch_prefilled = '{pain_level}'$$, '23514', null, 'only sleep quality / energy can be marked watch-derived');
update public.pre_session_checkins set watch_prefilled = '{}';

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.pre_session_checkins), 0, 'trainer B cannot see check-in addressed to trainer A');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.pre_session_checkins), 1, 'trainer A sees the check-in');
select isnt(public.mark_checkin_reviewed('20000000-0000-0000-0000-000000000001'), null, 'trainer A marks it reviewed');
update public.pre_session_checkins set training_goal = 'edited by trainer';
select is((select training_goal from public.pre_session_checkins), 'Squat technique', 'trainer cannot edit client answers (RLS filters the update)');

-- ─────────────────────────── feedback & notes ────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$insert into public.post_session_feedback (session_id, client_id, session_rpe, enjoyment, pain_level)
  values ('10000000-0000-0000-0000-000000000001', auth.uid(), 7, 4, 1)$$, 'client leaves post-session feedback');
select is((select trainer_id from public.post_session_feedback), '00000000-0000-0000-0000-0000000000a1'::uuid, 'feedback trainer derived from session');
delete from public.post_session_feedback;
insert into public.post_session_feedback (session_id, client_id, trainer_id, session_rpe, enjoyment, pain_level)
  values ('10000000-0000-0000-0000-000000000001', auth.uid(), '00000000-0000-0000-0000-0000000000b1', 7, 4, 1);
select is((select trainer_id from public.post_session_feedback), '00000000-0000-0000-0000-0000000000a1'::uuid, 'spoofed feedback trainer_id is overwritten from the session');
select throws_ok($$update public.post_session_feedback set trainer_id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'feedback trainer_id is not updatable');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.trainer_notes (trainer_id, client_id, session_id, body, visibility) values
  (auth.uid(), '00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'Private: watch left knee', 'private'),
  (auth.uid(), '00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000001', 'Great depth today', 'shared');
select is((select count(*)::int from public.trainer_notes), 2, 'trainer sees both notes');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((select body from public.trainer_notes), 'Great depth today', 'client sees only shared note');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.trainer_notes), 0, 'trainer B sees no notes of trainer A');
select throws_ok($$insert into public.trainer_notes (trainer_id, client_id, body) values (auth.uid(), '00000000-0000-0000-0000-0000000000d1', 'x')$$, '42501', 'no_active_relationship', 'cannot write notes about a non-client');

-- ───────────────────────────── health data ───────────────────────────
select pg_temp.as_admin();
insert into public.health_samples (user_id, sample_id, metric_type, value, unit, start_at, measured_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'hk-1', 'hrv_sdnn', 48.2, 'ms', now() - interval '6 hours', now() - interval '6 hours'),
  ('00000000-0000-0000-0000-0000000000c1', 'hk-2', 'resting_heart_rate', 56, 'bpm', now() - interval '5 hours', now() - interval '5 hours'),
  ('00000000-0000-0000-0000-0000000000c1', 'hk-3', 'sleep_analysis', 6.9, 'h', now() - interval '14 hours', now() - interval '7 hours');
select throws_ok($$insert into public.health_samples (user_id, sample_id, metric_type, value, unit, start_at, measured_at)
  values ('00000000-0000-0000-0000-0000000000c1', 'hk-1', 'hrv_sdnn', 50, 'ms', now(), now())$$, '23505', null, 'duplicate HealthKit sample rejected by unique key');
select throws_ok($$insert into public.health_samples (user_id, sample_id, metric_type, value, unit, start_at, measured_at)
  values ('00000000-0000-0000-0000-0000000000c1', 'hk-9', 'hrv_sdnn', 50, 's', now(), now())$$, '23514', null, 'wrong unit rejected');
select throws_ok($$insert into public.health_samples (user_id, sample_id, metric_type, value, unit, start_at, measured_at, origin)
  values ('00000000-0000-0000-0000-0000000000c1', 'demo-1', 'hrv_sdnn', 50, 'ms', now(), now(), 'demo')$$, '22023', 'origin_mismatch', 'demo data cannot be attached to a real user');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$insert into public.health_samples (user_id, sample_id, metric_type, value, unit, start_at, measured_at)
  values (auth.uid(), 'x', 'hrv_sdnn', 1, 'ms', now(), now())$$, '42501', null, 'clients cannot write samples directly (Edge Function only)');

select pg_temp.as_admin();
insert into public.health_snapshots (user_id, snapshot_date, time_zone, algorithm_version, completeness, assessment) values
  ('00000000-0000-0000-0000-0000000000c1', current_date, 'UTC', 'test', 1,
   '{"scores":{"readiness":{"value":70},"sleep":{"value":80},"hrvVsBaseline":{"value":60},"restingHeartRateVsBaseline":{"value":55}},"latest":{"hrv":{"value":48},"restingHeartRate":{"value":56}},"signals":[1],"fitness":{"vitals":{"x":1},"cardio":{"x":1}},"rawSummary":{"sleepHours":7,"baselines":{"hrv":50,"sleepHours":7}}}');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.health_samples), 2, 'trainer A sees only granted categories (hrv + sleep, not RHR)');
select is((select count(*)::int from public.health_snapshots), 0, 'trainers cannot read snapshot rows directly');
select is((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' #> '{scores,readiness,value}')::int, 70, 'granted scores are returned');
select is((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' #> '{latest,hrv,value}')::int, 48, 'granted HRV is returned');
select ok((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' #> '{latest,restingHeartRate}') is null, 'ungranted resting HR is stripped');
select ok((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' #> '{fitness,vitals}') is null, 'ungranted vitals are stripped');
select ok((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' -> 'signals') is null, 'raw signals are never sent to trainers');
select is((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' #> '{scores,sleep,value}')::int, 80, 'sleep score returned when sleep is granted');
select ok((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' #> '{scores,restingHeartRateVsBaseline}') is null, 'resting-HR sub-score stripped when resting HR is not granted');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select ok(public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') is null, 'trainer without grants gets no snapshot');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.health_samples), 0, 'trainer B (no grants) sees no health samples');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.health_samples), 0, 'another client sees no health samples');

-- Client revokes HRV for trainer A.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
update public.health_sharing_permissions set granted = false where trainer_id = '00000000-0000-0000-0000-0000000000a1' and category = 'hrv';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.health_samples), 1, 'after revoking HRV, trainer A sees only sleep');
select ok((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' #> '{scores,hrvVsBaseline}') is null, 'HRV sub-score stripped after revoking HRV');
select is((public.client_health_snapshot('00000000-0000-0000-0000-0000000000c1') -> 'assessment' #> '{scores,readiness,value}')::int, 70, 'readiness still returned (scores granted)');
update public.health_sharing_permissions set granted = true;
select is((select count(*)::int from public.health_sharing_permissions where granted), 2, 'trainer cannot grant themselves access (RLS filters the update)');

-- End the relationship → everything disappears for the trainer.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok($$select public.end_relationship((select id from public.trainer_client_relationships where trainer_id = '00000000-0000-0000-0000-0000000000a1'))$$, 'client ends relationship with trainer A');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.health_samples), 0, 'ended relationship: no health data');
select is((select count(*)::int from public.pre_session_checkins), 0, 'ended relationship: no check-ins');
select is((select count(*)::int from public.trainer_client_overview() where client_id = '00000000-0000-0000-0000-0000000000c1'), 0, 'ended relationship: not in overview');

-- Client deletes all health data.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is((public.delete_my_health_data() ->> 'samples')::int, 3, 'client deletes all stored health samples');

select * from finish();
rollback;

-- FitCheck-In core schema
-- Every table is protected by Row Level Security. Writes that need cross-row
-- validation go through SECURITY DEFINER functions with explicit checks.

-- ─────────────────────────────── enums ───────────────────────────────
create type public.user_role as enum ('trainer', 'client');
create type public.relationship_status as enum ('active', 'ended');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
create type public.session_status as enum ('planned', 'completed', 'cancelled');
create type public.note_visibility as enum ('private', 'shared');
create type public.health_category as enum (
  'scores', 'hrv', 'resting_heart_rate', 'heart_rate', 'sleep', 'activity', 'workouts', 'vo2_max'
);
create type public.data_origin as enum ('healthkit', 'demo');

-- ───────────────────────────── utilities ─────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Metric catalogue. Mirrors supabase/functions/_shared/metrics/health-schema.ts
-- (a pgTAP test asserts both stay in sync).
create or replace function public.health_metric_category(p_metric text)
returns public.health_category
language sql
immutable
set search_path = ''
as $$
  select case p_metric
    when 'hrv_sdnn' then 'hrv'::public.health_category
    when 'resting_heart_rate' then 'resting_heart_rate'::public.health_category
    when 'heart_rate' then 'heart_rate'::public.health_category
    when 'sleep_analysis' then 'sleep'::public.health_category
    when 'step_count' then 'activity'::public.health_category
    when 'active_energy' then 'activity'::public.health_category
    when 'basal_energy' then 'activity'::public.health_category
    when 'exercise_time' then 'activity'::public.health_category
    when 'workout' then 'workouts'::public.health_category
    when 'vo2_max' then 'vo2_max'::public.health_category
  end
$$;

create or replace function public.health_metric_unit(p_metric text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_metric
    when 'hrv_sdnn' then 'ms'
    when 'resting_heart_rate' then 'bpm'
    when 'heart_rate' then 'bpm'
    when 'sleep_analysis' then 'h'
    when 'step_count' then 'count'
    when 'active_energy' then 'kcal'
    when 'basal_energy' then 'kcal'
    when 'exercise_time' then 'min'
    when 'workout' then 'min'
    when 'vo2_max' then 'mL/kg/min'
  end
$$;

-- ───────────────────────────── profiles ──────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  locale text not null default 'en' check (locale in ('en', 'zh-CN')),
  time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  bio text check (char_length(bio) <= 500),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.role is 'Set once at sign-up from auth metadata; not updatable by users.';
comment on column public.profiles.is_demo is 'Demo-mode account. Only the service role can set this. Demo and real accounts can never be linked.';

create or replace function public.validate_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception 'invalid_time_zone' using errcode = '22023';
  end if;
  new.display_name := btrim(new.display_name);
  return new;
end;
$$;

create trigger profiles_validate before insert or update on public.profiles
  for each row execute function public.validate_profile();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Creates the profile row when an auth user is created.
-- Role must be supplied in user metadata (`role`: trainer | client).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role text := v_meta ->> 'role';
  v_name text := nullif(btrim(coalesce(v_meta ->> 'display_name', '')), '');
  v_locale text := v_meta ->> 'locale';
  v_tz text := v_meta ->> 'time_zone';
begin
  if v_role is null or v_role not in ('trainer', 'client') then
    raise exception 'role_required' using errcode = '22023';
  end if;
  if v_locale is null or v_locale not in ('en', 'zh-CN') then
    v_locale := 'en';
  end if;
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'UTC';
  end if;

  insert into public.profiles (id, role, display_name, locale, time_zone)
  values (
    new.id,
    v_role::public.user_role,
    left(coalesce(v_name, split_part(coalesce(new.email, 'user'), '@', 1)), 80),
    v_locale,
    v_tz
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────── role helpers ────────────────────────────
create or replace function public.my_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ───────────────────────────── invitations ───────────────────────────
-- Unambiguous alphabet (no 0/O/1/I).
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  result text := '';
  i int;
begin
  for i in 0..7 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end;
$$;

create table public.trainer_invitations (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  code text not null unique default public.generate_invite_code()
    check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  invitee_email text check (invitee_email is null or invitee_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  note text check (char_length(note) <= 280),
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index trainer_invitations_trainer_idx on public.trainer_invitations (trainer_id, created_at desc);

-- ──────────────────────── trainer ↔ client links ─────────────────────
create table public.trainer_client_relationships (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  status public.relationship_status not null default 'active',
  invitation_id uuid references public.trainer_invitations (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trainer_id, client_id),
  check (trainer_id <> client_id),
  check ((status = 'ended') = (ended_at is not null))
);
create index tcr_client_idx on public.trainer_client_relationships (client_id, status);
create index tcr_trainer_idx on public.trainer_client_relationships (trainer_id, status);
create trigger tcr_updated_at before update on public.trainer_client_relationships
  for each row execute function public.set_updated_at();

create or replace function public.validate_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.profiles;
  c public.profiles;
begin
  select * into t from public.profiles where id = new.trainer_id;
  select * into c from public.profiles where id = new.client_id;
  if t.role is distinct from 'trainer' or c.role is distinct from 'client' then
    raise exception 'role_mismatch' using errcode = '22023';
  end if;
  if t.is_demo <> c.is_demo then
    raise exception 'demo_mismatch' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger tcr_validate before insert or update of trainer_id, client_id on public.trainer_client_relationships
  for each row execute function public.validate_relationship();

create or replace function public.is_active_trainer_of(p_client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trainer_client_relationships r
    where r.trainer_id = auth.uid() and r.client_id = p_client and r.status = 'active'
  )
$$;

create or replace function public.shares_relationship_with(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trainer_client_relationships r
    where (r.trainer_id = auth.uid() and r.client_id = p_other)
       or (r.client_id = auth.uid() and r.trainer_id = p_other)
  )
$$;

-- ───────────────────────── health sharing grants ─────────────────────
create table public.health_sharing_permissions (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.trainer_client_relationships (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  category public.health_category not null,
  granted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (relationship_id, category)
);
create index hsp_lookup_idx on public.health_sharing_permissions (trainer_id, client_id, category) where granted;
create trigger hsp_updated_at before update on public.health_sharing_permissions
  for each row execute function public.set_updated_at();

create or replace function public.can_view_health(p_client uuid, p_category public.health_category)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.trainer_client_relationships r
    join public.health_sharing_permissions p on p.relationship_id = r.id
    where r.trainer_id = auth.uid()
      and r.client_id = p_client
      and r.status = 'active'
      and p.category = p_category
      and p.granted
  )
$$;

-- ─────────────────────────── training sessions ───────────────────────
create table public.training_sessions (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  scheduled_at timestamptz not null,
  duration_minutes smallint check (duration_minutes between 5 and 600),
  status public.session_status not null default 'planned',
  session_type text not null default 'strength' check (
    session_type in ('strength', 'hypertrophy', 'conditioning', 'mobility', 'endurance', 'technique', 'recovery', 'other')
  ),
  title text check (char_length(title) <= 120),
  location text check (char_length(location) <= 120),
  planned_intensity smallint check (planned_intensity between 1 and 10),
  actual_intensity smallint check (actual_intensity between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_sessions_trainer_idx on public.training_sessions (trainer_id, scheduled_at desc);
create index training_sessions_client_idx on public.training_sessions (client_id, scheduled_at desc);
create trigger training_sessions_updated_at before update on public.training_sessions
  for each row execute function public.set_updated_at();

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions (id) on delete cascade,
  position smallint not null default 0 check (position between 0 and 200),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  sets smallint check (sets between 0 and 100),
  reps smallint check (reps between 0 and 1000),
  weight_kg numeric(6, 2) check (weight_kg between 0 and 1000),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index session_exercises_session_idx on public.session_exercises (session_id, position);

-- ─────────────────────────── pre-session check-ins ───────────────────
create table public.pre_session_checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.training_sessions (id) on delete set null,
  sleep_quality smallint not null check (sleep_quality between 1 and 5),
  energy_level smallint not null check (energy_level between 1 and 5),
  muscle_soreness smallint not null check (muscle_soreness between 0 and 10),
  pain_level smallint not null check (pain_level between 0 and 10),
  pain_areas text[] not null default '{}' check (cardinality(pain_areas) <= 12),
  mental_state smallint not null check (mental_state between 1 and 5),
  training_goal text not null check (char_length(btrim(training_goal)) between 1 and 300),
  notes text check (char_length(notes) <= 1000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index checkins_client_idx on public.pre_session_checkins (client_id, created_at desc);
create index checkins_trainer_idx on public.pre_session_checkins (trainer_id, created_at desc);
create trigger checkins_updated_at before update on public.pre_session_checkins
  for each row execute function public.set_updated_at();

-- ─────────────────────────── post-session feedback ───────────────────
create table public.post_session_feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.training_sessions (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  session_rpe smallint not null check (session_rpe between 1 and 10),
  enjoyment smallint not null check (enjoyment between 1 and 5),
  pain_level smallint not null check (pain_level between 0 and 10),
  pain_areas text[] not null default '{}' check (cardinality(pain_areas) <= 12),
  comments text check (char_length(comments) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_client_idx on public.post_session_feedback (client_id, created_at desc);
create index feedback_trainer_idx on public.post_session_feedback (trainer_id, created_at desc);
create trigger feedback_updated_at before update on public.post_session_feedback
  for each row execute function public.set_updated_at();

-- ───────────────────────────── trainer notes ─────────────────────────
create table public.trainer_notes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.training_sessions (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  performance_rating smallint check (performance_rating between 1 and 5),
  recommendations text check (char_length(recommendations) <= 2000),
  visibility public.note_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trainer_notes_trainer_idx on public.trainer_notes (trainer_id, client_id, created_at desc);
create index trainer_notes_client_idx on public.trainer_notes (client_id, created_at desc) where visibility = 'shared';
create index trainer_notes_session_idx on public.trainer_notes (session_id);
create trigger trainer_notes_updated_at before update on public.trainer_notes
  for each row execute function public.set_updated_at();

-- ─────────────────────────── Apple Health sync ───────────────────────
create table public.health_sync_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  installation_id uuid not null,
  device_name text not null default 'iPhone' check (char_length(device_name) between 1 and 80),
  platform text not null default 'ios' check (platform in ('ios')),
  os_version text check (char_length(os_version) <= 40),
  app_version text check (char_length(app_version) <= 40),
  enabled_categories public.health_category[] not null default '{}',
  last_sync_at timestamptz,
  last_sync_status text check (last_sync_status in ('success', 'partial', 'error')),
  last_sync_error text check (char_length(last_sync_error) <= 300),
  last_sample_count integer check (last_sample_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, installation_id)
);
create trigger health_sync_devices_updated_at before update on public.health_sync_devices
  for each row execute function public.set_updated_at();

create table public.health_samples (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id uuid references public.health_sync_devices (id) on delete set null,
  sample_id text not null check (char_length(sample_id) between 1 and 128),
  metric_type text not null check (public.health_metric_category(metric_type) is not null),
  value double precision not null check (value = value and value not in ('Infinity', '-Infinity')),
  unit text not null,
  start_at timestamptz not null,
  measured_at timestamptz not null,
  received_at timestamptz not null default now(),
  category text check (char_length(category) <= 40),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  source_name text check (char_length(source_name) <= 120),
  source_bundle text check (char_length(source_bundle) <= 200),
  origin public.data_origin not null default 'healthkit',
  unique (user_id, metric_type, sample_id),
  check (measured_at >= start_at),
  check (unit = public.health_metric_unit(metric_type))
);
comment on column public.health_samples.measured_at is 'Sample end time from HealthKit (when the measurement applies).';
comment on column public.health_samples.received_at is 'Server time the sample was last uploaded (sync time).';
comment on column public.health_samples.sample_id is 'HealthKit UUID, or a deterministic id for aggregated buckets (e.g. steps:2026-11-08). Unique per user+metric → idempotent re-uploads.';
create index health_samples_user_metric_time_idx on public.health_samples (user_id, metric_type, measured_at desc);

create table public.health_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  snapshot_date date not null,
  time_zone text not null,
  computed_at timestamptz not null default now(),
  algorithm_version text not null,
  completeness numeric(3, 2) not null check (completeness between 0 and 1),
  assessment jsonb not null,
  origin public.data_origin not null default 'healthkit',
  unique (user_id, snapshot_date)
);
comment on table public.health_snapshots is 'Algorithmic estimates (not medical assessments). Written only by the health-ingest Edge Function.';
create index health_snapshots_user_date_idx on public.health_snapshots (user_id, snapshot_date desc);

-- Demo data can only ever belong to demo profiles, and vice versa.
create or replace function public.enforce_data_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_demo boolean;
begin
  select is_demo into v_demo from public.profiles where id = new.user_id;
  if v_demo is null then
    raise exception 'profile_not_found' using errcode = '23503';
  end if;
  if (new.origin = 'demo') <> v_demo then
    raise exception 'origin_mismatch' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger health_samples_origin before insert or update on public.health_samples
  for each row execute function public.enforce_data_origin();
create trigger health_snapshots_origin before insert or update on public.health_snapshots
  for each row execute function public.enforce_data_origin();

-- ─────────────────────── cross-row integrity triggers ────────────────
create or replace function public.validate_session_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.client_id <> old.client_id or new.trainer_id <> old.trainer_id then
    if not exists (
      select 1 from public.trainer_client_relationships r
      where r.trainer_id = new.trainer_id and r.client_id = new.client_id and r.status = 'active'
    ) then
      raise exception 'no_active_relationship' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger training_sessions_pair before insert or update on public.training_sessions
  for each row execute function public.validate_session_pair();

create or replace function public.validate_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.trainer_client_relationships r
    where r.trainer_id = new.trainer_id and r.client_id = new.client_id and r.status = 'active'
  ) then
    raise exception 'no_active_relationship' using errcode = '42501';
  end if;
  if new.session_id is not null and not exists (
    select 1 from public.training_sessions s
    where s.id = new.session_id and s.trainer_id = new.trainer_id and s.client_id = new.client_id
  ) then
    raise exception 'session_mismatch' using errcode = '22023';
  end if;
  new.training_goal := btrim(new.training_goal);
  return new;
end;
$$;
create trigger checkins_validate before insert or update on public.pre_session_checkins
  for each row execute function public.validate_checkin();

create or replace function public.validate_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.training_sessions;
begin
  select * into s from public.training_sessions where id = new.session_id;
  if s.id is null or s.client_id <> new.client_id then
    raise exception 'session_mismatch' using errcode = '22023';
  end if;
  new.trainer_id := s.trainer_id;
  return new;
end;
$$;
create trigger feedback_validate before insert or update on public.post_session_feedback
  for each row execute function public.validate_feedback();

create or replace function public.validate_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not exists (
    select 1 from public.trainer_client_relationships r
    where r.trainer_id = new.trainer_id and r.client_id = new.client_id and r.status = 'active'
  ) then
    raise exception 'no_active_relationship' using errcode = '42501';
  end if;
  if new.session_id is not null and not exists (
    select 1 from public.training_sessions s
    where s.id = new.session_id and s.trainer_id = new.trainer_id and s.client_id = new.client_id
  ) then
    raise exception 'session_mismatch' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger trainer_notes_validate before insert or update on public.trainer_notes
  for each row execute function public.validate_note();

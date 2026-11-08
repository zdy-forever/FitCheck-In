-- Row Level Security, column-level privileges and RPC endpoints.
--
-- Principles
--  * Deny by default: revoke everything from anon/authenticated, then grant the
--    exact columns each operation needs. Immutable columns (role, owner ids,
--    is_demo, origin …) are simply not grantable.
--  * Health data is never written by end users through PostgREST. Only the
--    `health-ingest` Edge Function (service role, after JWT verification) writes
--    health_samples / health_snapshots / health_sync_devices.
--  * Trainers see client data only while the relationship is active, and health
--    data only per category the client explicitly granted to that trainer.

-- ─────────────────────────── baseline privileges ─────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- Helper functions used inside policies must be executable by authenticated.
grant execute on function public.my_role() to authenticated;
grant execute on function public.is_active_trainer_of(uuid) to authenticated;
grant execute on function public.shares_relationship_with(uuid) to authenticated;
grant execute on function public.can_view_health(uuid, public.health_category) to authenticated;
grant execute on function public.health_metric_category(text) to authenticated;
grant execute on function public.health_metric_unit(text) to authenticated;
-- Column defaults / triggers evaluated as the calling role.
grant execute on function public.generate_invite_code() to authenticated;
grant execute on function public.set_updated_at() to authenticated;

-- Enable RLS everywhere.
alter table public.profiles enable row level security;
alter table public.trainer_invitations enable row level security;
alter table public.trainer_client_relationships enable row level security;
alter table public.health_sharing_permissions enable row level security;
alter table public.training_sessions enable row level security;
alter table public.session_exercises enable row level security;
alter table public.pre_session_checkins enable row level security;
alter table public.post_session_feedback enable row level security;
alter table public.trainer_notes enable row level security;
alter table public.health_sync_devices enable row level security;
alter table public.health_samples enable row level security;
alter table public.health_snapshots enable row level security;

-- ─────────────────────────────── profiles ────────────────────────────
grant select on public.profiles to authenticated;
grant update (display_name, locale, time_zone, bio) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_relationship_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ───────────────────────────── invitations ───────────────────────────
grant select on public.trainer_invitations to authenticated;
grant insert (trainer_id, invitee_email, note) on public.trainer_invitations to authenticated;
grant update (status) on public.trainer_invitations to authenticated;

create policy invitations_select on public.trainer_invitations for select to authenticated
  using (trainer_id = (select auth.uid()));
create policy invitations_insert on public.trainer_invitations for insert to authenticated
  with check (trainer_id = (select auth.uid()) and public.my_role() = 'trainer');
-- Trainers can only move their own pending invitations to "revoked".
create policy invitations_revoke on public.trainer_invitations for update to authenticated
  using (trainer_id = (select auth.uid()) and status = 'pending')
  with check (trainer_id = (select auth.uid()) and status = 'revoked');

-- ──────────────────────────── relationships ──────────────────────────
grant select on public.trainer_client_relationships to authenticated;
create policy relationships_select on public.trainer_client_relationships for select to authenticated
  using (trainer_id = (select auth.uid()) or client_id = (select auth.uid()));
-- Created / ended only through accept_invitation() and end_relationship().

-- ──────────────────────────── sharing grants ─────────────────────────
grant select on public.health_sharing_permissions to authenticated;
grant update (granted) on public.health_sharing_permissions to authenticated;

create policy sharing_select on public.health_sharing_permissions for select to authenticated
  using (client_id = (select auth.uid()) or trainer_id = (select auth.uid()));
-- Only the client changes a grant; granting requires the relationship to be active.
create policy sharing_update on public.health_sharing_permissions for update to authenticated
  using (client_id = (select auth.uid()))
  with check (
    client_id = (select auth.uid())
    and (
      not granted
      or exists (
        select 1 from public.trainer_client_relationships r
        where r.id = relationship_id and r.status = 'active'
      )
    )
  );

-- ─────────────────────────── training sessions ───────────────────────
-- `id` is insertable so clients can generate UUIDs for idempotent retries.
grant select, delete on public.training_sessions to authenticated;
grant insert (id, trainer_id, client_id, scheduled_at, duration_minutes, status, session_type, title, location, planned_intensity, actual_intensity)
  on public.training_sessions to authenticated;
grant update (scheduled_at, duration_minutes, status, session_type, title, location, planned_intensity, actual_intensity)
  on public.training_sessions to authenticated;

-- Trainers keep access to sessions they authored (their professional log);
-- clients see their own sessions.
create policy sessions_select on public.training_sessions for select to authenticated
  using (trainer_id = (select auth.uid()) or client_id = (select auth.uid()));
create policy sessions_insert on public.training_sessions for insert to authenticated
  with check (trainer_id = (select auth.uid()) and public.my_role() = 'trainer');
create policy sessions_update on public.training_sessions for update to authenticated
  using (trainer_id = (select auth.uid())) with check (trainer_id = (select auth.uid()));
create policy sessions_delete on public.training_sessions for delete to authenticated
  using (trainer_id = (select auth.uid()));

grant select, delete on public.session_exercises to authenticated;
grant insert (id, session_id, position, name, sets, reps, weight_kg, notes) on public.session_exercises to authenticated;
grant update (position, name, sets, reps, weight_kg, notes) on public.session_exercises to authenticated;

create policy exercises_select on public.session_exercises for select to authenticated
  using (exists (
    select 1 from public.training_sessions s
    where s.id = session_id and (s.trainer_id = (select auth.uid()) or s.client_id = (select auth.uid()))
  ));
create policy exercises_write on public.session_exercises for all to authenticated
  using (exists (select 1 from public.training_sessions s where s.id = session_id and s.trainer_id = (select auth.uid())))
  with check (exists (select 1 from public.training_sessions s where s.id = session_id and s.trainer_id = (select auth.uid())));

-- ─────────────────────────── pre-session check-ins ───────────────────
grant select, delete on public.pre_session_checkins to authenticated;
grant insert (id, client_id, trainer_id, session_id, sleep_quality, energy_level, muscle_soreness, pain_level, pain_areas, mental_state, training_goal, notes)
  on public.pre_session_checkins to authenticated;
grant update (session_id, sleep_quality, energy_level, muscle_soreness, pain_level, pain_areas, mental_state, training_goal, notes)
  on public.pre_session_checkins to authenticated;

-- A check-in is addressed to ONE trainer; other trainers of the same client never see it.
create policy checkins_select on public.pre_session_checkins for select to authenticated
  using (
    client_id = (select auth.uid())
    or (trainer_id = (select auth.uid()) and public.is_active_trainer_of(client_id))
  );
create policy checkins_insert on public.pre_session_checkins for insert to authenticated
  with check (client_id = (select auth.uid()) and public.my_role() = 'client');
create policy checkins_update on public.pre_session_checkins for update to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));
create policy checkins_delete on public.pre_session_checkins for delete to authenticated
  using (client_id = (select auth.uid()));

-- ─────────────────────────── post-session feedback ───────────────────
grant select, delete on public.post_session_feedback to authenticated;
grant insert (id, session_id, client_id, session_rpe, enjoyment, pain_level, pain_areas, comments)
  on public.post_session_feedback to authenticated;
grant update (session_rpe, enjoyment, pain_level, pain_areas, comments) on public.post_session_feedback to authenticated;

create policy feedback_select on public.post_session_feedback for select to authenticated
  using (
    client_id = (select auth.uid())
    or (trainer_id = (select auth.uid()) and public.is_active_trainer_of(client_id))
  );
create policy feedback_insert on public.post_session_feedback for insert to authenticated
  with check (client_id = (select auth.uid()) and public.my_role() = 'client');
create policy feedback_update on public.post_session_feedback for update to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));
create policy feedback_delete on public.post_session_feedback for delete to authenticated
  using (client_id = (select auth.uid()));

-- ───────────────────────────── trainer notes ─────────────────────────
grant select, delete on public.trainer_notes to authenticated;
grant insert (id, trainer_id, client_id, session_id, body, performance_rating, recommendations, visibility)
  on public.trainer_notes to authenticated;
grant update (session_id, body, performance_rating, recommendations, visibility) on public.trainer_notes to authenticated;

create policy notes_select on public.trainer_notes for select to authenticated
  using (trainer_id = (select auth.uid()) or (client_id = (select auth.uid()) and visibility = 'shared'));
create policy notes_insert on public.trainer_notes for insert to authenticated
  with check (trainer_id = (select auth.uid()) and public.my_role() = 'trainer');
create policy notes_update on public.trainer_notes for update to authenticated
  using (trainer_id = (select auth.uid())) with check (trainer_id = (select auth.uid()));
create policy notes_delete on public.trainer_notes for delete to authenticated
  using (trainer_id = (select auth.uid()));

-- ─────────────────────────── Apple Health data ───────────────────────
grant select, delete on public.health_sync_devices to authenticated;
grant update (revoked_at) on public.health_sync_devices to authenticated;
create policy devices_select on public.health_sync_devices for select to authenticated
  using (user_id = (select auth.uid()));
create policy devices_update on public.health_sync_devices for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_delete on public.health_sync_devices for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.health_samples to authenticated;
create policy samples_select on public.health_samples for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_view_health(user_id, public.health_metric_category(metric_type))
  );
create policy samples_delete on public.health_samples for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.health_snapshots to authenticated;
create policy snapshots_select on public.health_snapshots for select to authenticated
  using (user_id = (select auth.uid()) or public.can_view_health(user_id, 'scores'));
create policy snapshots_delete on public.health_snapshots for delete to authenticated
  using (user_id = (select auth.uid()));

-- ────────────────────────────── RPC endpoints ────────────────────────

-- Preview an invitation before accepting (shows the trainer's name only).
create or replace function public.get_invitation_preview(p_code text)
returns table (trainer_name text, status public.invitation_status, expires_at timestamptz, is_expired boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.display_name, i.status, i.expires_at, i.expires_at < now()
  from public.trainer_invitations i
  join public.profiles p on p.id = i.trainer_id
  where i.code = upper(btrim(p_code))
$$;

create or replace function public.accept_invitation(
  p_code text,
  p_share public.health_category[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.trainer_invitations;
  v_me public.profiles;
  v_trainer public.profiles;
  v_email text;
  v_rel_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.role is distinct from 'client' then
    raise exception 'only_clients_can_accept' using errcode = '42501';
  end if;

  select * into v_inv from public.trainer_invitations where code = upper(btrim(p_code)) for update;
  if v_inv.id is null then
    raise exception 'invitation_not_found' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invitation_not_pending' using errcode = '22023';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'invitation_expired' using errcode = '22023';
  end if;
  if v_inv.invitee_email is not null then
    select email into v_email from auth.users where id = v_uid;
    if lower(v_email) is distinct from lower(v_inv.invitee_email) then
      raise exception 'invitation_email_mismatch' using errcode = '42501';
    end if;
  end if;
  select * into v_trainer from public.profiles where id = v_inv.trainer_id;
  if v_trainer.is_demo <> v_me.is_demo then
    raise exception 'demo_mismatch' using errcode = '22023';
  end if;

  insert into public.trainer_client_relationships (trainer_id, client_id, status, invitation_id)
  values (v_inv.trainer_id, v_uid, 'active', v_inv.id)
  on conflict (trainer_id, client_id) do update
    set status = 'active', ended_at = null, ended_by = null, invitation_id = excluded.invitation_id, started_at = now()
  returning id into v_rel_id;

  -- One row per category; only the categories the client ticked are granted.
  insert into public.health_sharing_permissions (relationship_id, client_id, trainer_id, category, granted)
  select v_rel_id, v_uid, v_inv.trainer_id, c, c = any (coalesce(p_share, '{}'))
  from unnest(enum_range(null::public.health_category)) as c
  on conflict (relationship_id, category) do update set granted = excluded.granted;

  update public.trainer_invitations
    set status = 'accepted', accepted_by = v_uid, accepted_at = now()
    where id = v_inv.id;

  return v_rel_id;
end;
$$;

-- Either party can end a relationship. All health sharing is revoked immediately.
create or replace function public.end_relationship(p_relationship_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rel public.trainer_client_relationships;
begin
  select * into v_rel from public.trainer_client_relationships where id = p_relationship_id for update;
  if v_rel.id is null or (v_rel.trainer_id <> v_uid and v_rel.client_id <> v_uid) then
    raise exception 'relationship_not_found' using errcode = 'P0002';
  end if;
  if v_rel.status = 'ended' then
    return;
  end if;
  update public.trainer_client_relationships
    set status = 'ended', ended_at = now(), ended_by = v_uid
    where id = p_relationship_id;
  update public.health_sharing_permissions set granted = false where relationship_id = p_relationship_id;
end;
$$;

create or replace function public.mark_checkin_reviewed(p_checkin_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ts timestamptz;
begin
  update public.pre_session_checkins c
    set reviewed_at = coalesce(c.reviewed_at, now())
    where c.id = p_checkin_id
      and c.trainer_id = auth.uid()
      and public.is_active_trainer_of(c.client_id)
    returning reviewed_at into v_ts;
  if v_ts is null then
    raise exception 'checkin_not_found' using errcode = 'P0002';
  end if;
  return v_ts;
end;
$$;

-- One-call overview for the trainer dashboard. Health status is only revealed
-- for clients who granted at least one health category to this trainer.
create or replace function public.trainer_client_overview()
returns table (
  relationship_id uuid,
  client_id uuid,
  display_name text,
  time_zone text,
  started_at timestamptz,
  last_session_at timestamptz,
  next_session_at timestamptz,
  latest_checkin_id uuid,
  latest_checkin_at timestamptz,
  latest_checkin_energy smallint,
  latest_checkin_sleep smallint,
  latest_checkin_soreness smallint,
  latest_checkin_pain smallint,
  latest_checkin_mental smallint,
  latest_checkin_reviewed_at timestamptz,
  unreviewed_checkins bigint,
  health_shared boolean,
  health_last_sync_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id,
    p.id,
    p.display_name,
    p.time_zone,
    r.started_at,
    (select max(s.scheduled_at) from public.training_sessions s
       where s.trainer_id = r.trainer_id and s.client_id = r.client_id and s.scheduled_at <= now() and s.status <> 'cancelled'),
    (select min(s.scheduled_at) from public.training_sessions s
       where s.trainer_id = r.trainer_id and s.client_id = r.client_id and s.scheduled_at > now() and s.status = 'planned'),
    c.id, c.created_at, c.energy_level, c.sleep_quality, c.muscle_soreness, c.pain_level, c.mental_state, c.reviewed_at,
    (select count(*) from public.pre_session_checkins u
       where u.trainer_id = r.trainer_id and u.client_id = r.client_id and u.reviewed_at is null),
    hs.shared,
    case when hs.shared then (
      select max(d.last_sync_at) from public.health_sync_devices d where d.user_id = r.client_id and d.revoked_at is null
    ) end
  from public.trainer_client_relationships r
  join public.profiles p on p.id = r.client_id
  left join lateral (
    select * from public.pre_session_checkins x
    where x.trainer_id = r.trainer_id and x.client_id = r.client_id
    order by x.created_at desc limit 1
  ) c on true
  cross join lateral (
    select exists (
      select 1 from public.health_sharing_permissions hp where hp.relationship_id = r.id and hp.granted
    ) as shared
  ) hs
  where r.trainer_id = auth.uid() and r.status = 'active'
  order by p.display_name
$$;

-- Deletes all Apple Health data the platform stores for the caller.
create or replace function public.delete_my_health_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_samples bigint;
  v_snapshots bigint;
  v_devices bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  delete from public.health_samples where user_id = v_uid;
  get diagnostics v_samples = row_count;
  delete from public.health_snapshots where user_id = v_uid;
  get diagnostics v_snapshots = row_count;
  delete from public.health_sync_devices where user_id = v_uid;
  get diagnostics v_devices = row_count;
  return jsonb_build_object('samples', v_samples, 'snapshots', v_snapshots, 'devices', v_devices);
end;
$$;

-- Permanently deletes the caller's account and, via ON DELETE CASCADE, all their data.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and is_demo) then
    raise exception 'demo_account_protected' using errcode = '42501';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

grant execute on function public.get_invitation_preview(text) to authenticated;
grant execute on function public.accept_invitation(text, public.health_category[]) to authenticated;
grant execute on function public.end_relationship(uuid) to authenticated;
grant execute on function public.mark_checkin_reviewed(uuid) to authenticated;
grant execute on function public.trainer_client_overview() to authenticated;
grant execute on function public.delete_my_health_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ─────────────────────────────── realtime ────────────────────────────
-- postgres_changes events are filtered through the RLS policies above.
alter publication supabase_realtime add table
  public.pre_session_checkins,
  public.post_session_feedback,
  public.trainer_notes,
  public.training_sessions,
  public.trainer_client_relationships,
  public.health_sharing_permissions,
  public.health_snapshots,
  public.health_sync_devices;

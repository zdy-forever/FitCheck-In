-- 1) Metric catalogue for the additional Apple Health data.
--    Keep in sync with supabase/functions/_shared/metrics/health-schema.ts
--    (integration test "metric catalogue matches the database" checks every metric).
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
    when 'walking_heart_rate' then 'heart_rate'::public.health_category
    when 'heart_rate_recovery' then 'heart_rate'::public.health_category
    when 'sleep_analysis' then 'sleep'::public.health_category
    when 'step_count' then 'activity'::public.health_category
    when 'active_energy' then 'activity'::public.health_category
    when 'basal_energy' then 'activity'::public.health_category
    when 'exercise_time' then 'activity'::public.health_category
    when 'distance_walking_running' then 'activity'::public.health_category
    when 'distance_cycling' then 'activity'::public.health_category
    when 'distance_swimming' then 'activity'::public.health_category
    when 'flights_climbed' then 'activity'::public.health_category
    when 'workout' then 'workouts'::public.health_category
    when 'vo2_max' then 'vo2_max'::public.health_category
    when 'oxygen_saturation' then 'vitals'::public.health_category
    when 'respiratory_rate' then 'vitals'::public.health_category
    when 'wrist_temperature' then 'vitals'::public.health_category
    when 'walking_speed' then 'mobility'::public.health_category
    when 'walking_steadiness' then 'mobility'::public.health_category
    when 'walking_asymmetry' then 'mobility'::public.health_category
    when 'walking_double_support' then 'mobility'::public.health_category
    when 'walking_step_length' then 'mobility'::public.health_category
    when 'six_minute_walk' then 'mobility'::public.health_category
    when 'body_mass' then 'body'::public.health_category
    when 'body_fat' then 'body'::public.health_category
    when 'lean_body_mass' then 'body'::public.health_category
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
    when 'walking_heart_rate' then 'bpm'
    when 'heart_rate_recovery' then 'bpm'
    when 'sleep_analysis' then 'h'
    when 'step_count' then 'count'
    when 'active_energy' then 'kcal'
    when 'basal_energy' then 'kcal'
    when 'exercise_time' then 'min'
    when 'distance_walking_running' then 'km'
    when 'distance_cycling' then 'km'
    when 'distance_swimming' then 'm'
    when 'flights_climbed' then 'count'
    when 'workout' then 'min'
    when 'vo2_max' then 'mL/kg/min'
    when 'oxygen_saturation' then '%'
    when 'respiratory_rate' then 'breaths/min'
    when 'wrist_temperature' then 'degC'
    when 'walking_speed' then 'm/s'
    when 'walking_steadiness' then '%'
    when 'walking_asymmetry' then '%'
    when 'walking_double_support' then '%'
    when 'walking_step_length' then 'm'
    when 'six_minute_walk' then 'm'
    when 'body_mass' then 'kg'
    when 'body_fat' then '%'
    when 'lean_body_mass' then 'kg'
  end
$$;

-- Existing relationships get rows for the new categories, NOT granted (explicit consent).
insert into public.health_sharing_permissions (relationship_id, client_id, trainer_id, category, granted)
select r.id, r.client_id, r.trainer_id, c, false
from public.trainer_client_relationships r
cross join unnest(array['vitals', 'mobility', 'body']::public.health_category[]) as c
on conflict (relationship_id, category) do nothing;

-- 2) Optional profile fields used for population norms (VO2max level) and HRmax.
alter table public.profiles
  add column birth_year smallint check (birth_year between 1900 and 2100),
  add column sex text check (sex in ('female', 'male'));
comment on column public.profiles.birth_year is 'Optional. Used for VO2max norms and age-predicted HRmax.';
comment on column public.profiles.sex is 'Optional. Used only to pick the VO2max norm table.';
grant update (birth_year, sex) on public.profiles to authenticated;

-- 3) Privacy fix: a trainer must only receive the snapshot sections for categories the
--    client granted. Previously RLS allowed reading the whole snapshot row with only the
--    "scores" grant, which exposed raw HRV/sleep/etc. values in the JSON.
drop policy if exists snapshots_select on public.health_snapshots;
create policy snapshots_select on public.health_snapshots for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.client_health_snapshot(p_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.health_snapshots;
  v_a jsonb;
  g public.health_category[];
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select * into v_row from public.health_snapshots
    where user_id = p_client order by snapshot_date desc limit 1;
  if v_row.id is null then
    return null;
  end if;
  if p_client = v_uid then
    return to_jsonb(v_row);
  end if;

  select coalesce(array_agg(p.category), '{}') into g
  from public.trainer_client_relationships r
  join public.health_sharing_permissions p on p.relationship_id = r.id
  where r.trainer_id = v_uid and r.client_id = p_client and r.status = 'active' and p.granted;
  if cardinality(g) = 0 then
    return null;
  end if;

  -- Raw per-signal values are never sent to trainers.
  v_a := v_row.assessment - 'signals';
  if not ('scores' = any (g)) then v_a := v_a - 'scores' - 'drivers' - 'legacy' - 'calibration'; end if;
  if not ('hrv' = any (g)) then
    v_a := v_a #- '{latest,hrv}' #- '{baselineComparison,hrvDeltaPercent}' #- '{rawSummary,baselines,hrv}';
  end if;
  if not ('resting_heart_rate' = any (g)) then
    v_a := v_a #- '{latest,restingHeartRate}' #- '{baselineComparison,restingHeartRateDeltaBpm}' #- '{rawSummary,baselines,restingHeartRate}';
  end if;
  if not ('sleep' = any (g)) then
    v_a := v_a #- '{rawSummary,sleepHours}' #- '{rawSummary,sleepStages}' #- '{rawSummary,sleepEndAt}'
               #- '{rawSummary,baselines,sleepHours}' #- '{baselineComparison,sleepDeltaHours}';
  end if;
  if not ('activity' = any (g)) then
    v_a := v_a #- '{rawSummary,stepsToday}' #- '{rawSummary,activeEnergyToday}' #- '{rawSummary,exerciseMinutesToday}' #- '{fitness,activity}';
  end if;
  if not ('workouts' = any (g)) then
    v_a := v_a - 'training' #- '{rawSummary,workouts28Day}' #- '{fitness,monotony}' #- '{fitness,running}';
  end if;
  if not ('vo2_max' = any (g)) then v_a := v_a #- '{latest,vo2Max}' #- '{fitness,cardio}'; end if;
  if not ('heart_rate' = any (g)) then v_a := v_a #- '{fitness,hrr}'; end if;
  if not ('vitals' = any (g)) then v_a := v_a #- '{fitness,vitals}'; end if;
  if not ('mobility' = any (g)) then v_a := v_a #- '{fitness,mobility}'; end if;
  if not ('body' = any (g)) then v_a := v_a #- '{fitness,body}'; end if;

  return to_jsonb(v_row) || jsonb_build_object('assessment', v_a);
end;
$$;
revoke execute on function public.client_health_snapshot(uuid) from public, anon;
grant execute on function public.client_health_snapshot(uuid) to authenticated;

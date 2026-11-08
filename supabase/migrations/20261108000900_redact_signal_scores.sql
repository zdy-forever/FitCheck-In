-- Per-signal scores follow their signal's sharing category, not just "scores".
--
-- The dashboard now shows the sleep score next to readiness / recovery / stress. The sleep score
-- (and the HRV / resting-HR sub-scores) are each derived from one signal, so a trainer who was
-- granted "scores" but not "sleep" must not be able to infer the client's sleep from them.
-- Same function as 20261108000700, with three extra paths stripped.

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
    v_a := v_a #- '{latest,hrv}' #- '{scores,hrvVsBaseline}' #- '{baselineComparison,hrvDeltaPercent}' #- '{rawSummary,baselines,hrv}';
  end if;
  if not ('resting_heart_rate' = any (g)) then
    v_a := v_a #- '{latest,restingHeartRate}' #- '{scores,restingHeartRateVsBaseline}' #- '{baselineComparison,restingHeartRateDeltaBpm}' #- '{rawSummary,baselines,restingHeartRate}';
  end if;
  if not ('sleep' = any (g)) then
    v_a := v_a #- '{scores,sleep}' #- '{rawSummary,sleepHours}' #- '{rawSummary,sleepStages}' #- '{rawSummary,sleepEndAt}'
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


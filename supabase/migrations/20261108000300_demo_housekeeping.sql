-- Demo-mode housekeeping. Demo workspaces are disposable; purge them after 24h.
-- Schedule on the hosted project with pg_cron (see README):
--   select cron.schedule('purge-demo', '17 * * * *', $$select public.purge_expired_demo_accounts()$$);
create or replace function public.purge_expired_demo_accounts(p_older_than interval default interval '24 hours')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with doomed as (
    select p.id from public.profiles p
    where p.is_demo and p.created_at < now() - p_older_than
  )
  delete from auth.users u using doomed d where u.id = d.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.purge_expired_demo_accounts(interval) from public, anon, authenticated;

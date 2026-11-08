-- Defence in depth: Supabase's default privileges grant EXECUTE to anon on new
-- functions. Every RPC below already requires auth.uid(), but anonymous callers
-- should not reach them at all.
revoke execute on function public.accept_invitation(text, public.health_category[]) from anon, public;
revoke execute on function public.delete_my_account() from anon, public;
revoke execute on function public.delete_my_health_data() from anon, public;
revoke execute on function public.end_relationship(uuid) from anon, public;
revoke execute on function public.get_invitation_preview(text) from anon, public;
revoke execute on function public.mark_checkin_reviewed(uuid) from anon, public;
revoke execute on function public.trainer_client_overview() from anon, public;
revoke execute on function public.purge_expired_demo_accounts(interval) from authenticated;

-- Traditional Chinese (zh-TW) as a third UI language.
alter table public.profiles drop constraint profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check check (locale in ('en', 'zh-CN', 'zh-TW'));

-- Signup trigger: accept the new locale from user metadata (unchanged otherwise).
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
  if v_locale is null or v_locale not in ('en', 'zh-CN', 'zh-TW') then
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

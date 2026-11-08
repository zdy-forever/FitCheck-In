-- Apple Health import from the iPhone browser (no native app).
--
-- Flow
--  1. On the computer, the signed-in client calls create_health_import_pairing() and shows the
--     returned one-time code as a QR code (expires after 10 minutes, usable once).
--  2. The phone opens /import/<code>. The health-import Edge Function exchanges the code for a
--     long-lived *upload-only* import token tied to a health_sync_devices row
--     (platform 'web_import'). The phone keeps that token; it never gets a login session.
--  3. Uploads authenticate with the import token. Revoking the device (existing "Unlink device"
--     button) or deleting health data / the account invalidates it.
--
-- Only SHA-256 hashes of the code and the token are stored. The Edge Function (service role)
-- is the only reader of these columns; clients cannot select them.

alter table public.health_sync_devices drop constraint health_sync_devices_platform_check;
alter table public.health_sync_devices add constraint health_sync_devices_platform_check check (platform in ('ios', 'web_import'));
alter table public.health_sync_devices add column import_token_hash text unique;

create table public.health_import_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid references public.health_sync_devices (id) on delete set null,
  created_at timestamptz not null default now()
);
create index health_import_pairings_user on public.health_import_pairings (user_id, created_at desc);

-- No client access at all: created through the RPC below, consumed by the Edge Function.
alter table public.health_import_pairings enable row level security;
revoke all on public.health_import_pairings from anon, authenticated;

-- The token hash must never be readable by clients (column grants on the devices table).
revoke select on public.health_sync_devices from authenticated;
grant select (
  id, user_id, installation_id, device_name, platform, os_version, app_version, enabled_categories,
  last_sync_at, last_sync_status, last_sync_error, last_sample_count, revoked_at, created_at, updated_at
) on public.health_sync_devices to authenticated;

/**
 * Creates a one-time pairing code for the calling client. Returns the plain code once;
 * only its hash is stored. Rate-limited to 10 codes per hour per user.
 */
create or replace function public.create_health_import_pairing()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_expires timestamptz := now() + interval '10 minutes';
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  i int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if (select role from public.profiles where id = v_uid) is distinct from 'client' then
    raise exception 'only_clients_can_import' using errcode = '42501';
  end if;
  if (select is_demo from public.profiles where id = v_uid) then
    raise exception 'demo_accounts_cannot_upload' using errcode = '42501';
  end if;
  if (select count(*) from public.health_import_pairings where user_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = '42501';
  end if;

  -- 16 chars from a 32-symbol alphabet = 80 bits of randomness.
  v_bytes := extensions.gen_random_bytes(16);
  v_code := '';
  for i in 0..15 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;

  -- Invalidate earlier unused codes so only the latest QR works.
  update public.health_import_pairings set expires_at = least(expires_at, now())
    where user_id = v_uid and used_at is null;

  insert into public.health_import_pairings (user_id, code_hash, expires_at)
  values (v_uid, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_expires);

  return jsonb_build_object('code', v_code, 'expiresAt', v_expires);
end;
$$;

revoke execute on function public.create_health_import_pairing() from public, anon;
grant execute on function public.create_health_import_pairing() to authenticated;

-- Pairing state for the computer screen ("waiting for phone…" → "phone connected").
create or replace function public.health_import_pairing_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pending', exists (select 1 from public.health_import_pairings p where p.user_id = auth.uid() and p.used_at is null and p.expires_at > now()),
    'lastPairedAt', (select max(p.used_at) from public.health_import_pairings p where p.user_id = auth.uid())
  );
$$;
revoke execute on function public.health_import_pairing_status() from public, anon;
grant execute on function public.health_import_pairing_status() to authenticated;

-- D-TIS / GitHub Pages setup. Run the whole file in Supabase SQL Editor.
-- Re-running this script preserves devices and their operation history.
-- Auth: create an email/password operator in Authentication > Users first.
-- Signage and Controller sign in as that same operator; no anonymous access.
begin;

create table if not exists public.dtis_devices (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  display_enabled boolean not null default true,
  revision integer not null default 0 check (revision >= 0),
  refresh_version integer not null default 0 check (refresh_version >= 0),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists dtis_devices_owner_idx on public.dtis_devices(owner_id);

create table if not exists public.dtis_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.dtis_devices(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  command_id uuid not null,
  action text not null check (action in ('settings', 'display', 'refresh')),
  revision integer not null check (revision > 0),
  settings jsonb not null,
  display_enabled boolean not null,
  refresh_version integer not null check (refresh_version >= 0),
  applied_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (device_id, command_id),
  unique (device_id, revision)
);

create index if not exists dtis_events_owner_idx on public.dtis_events(owner_id);
alter table public.dtis_devices enable row level security;
alter table public.dtis_events enable row level security;

revoke all on public.dtis_devices, public.dtis_events from anon, authenticated;
grant select, insert on public.dtis_devices to authenticated;
grant update (settings, display_enabled, revision, refresh_version, last_seen_at, updated_at)
  on public.dtis_devices to authenticated;
-- Event rows are append-only for application users: no UPDATE or DELETE grant.
grant select, insert on public.dtis_events to authenticated;

drop policy if exists dtis_devices_read on public.dtis_devices;
create policy dtis_devices_read on public.dtis_devices for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists dtis_devices_create on public.dtis_devices;
create policy dtis_devices_create on public.dtis_devices for insert to authenticated
  with check ((select auth.uid()) = owner_id and revision = 0 and refresh_version = 0);
drop policy if exists dtis_devices_update on public.dtis_devices;
create policy dtis_devices_update on public.dtis_devices for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists dtis_events_read on public.dtis_events;
create policy dtis_events_read on public.dtis_events for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists dtis_events_append on public.dtis_events;
create policy dtis_events_append on public.dtis_events for insert to authenticated
  with check ((select auth.uid()) = owner_id and exists (
    select 1 from public.dtis_devices d where d.id = device_id and d.owner_id = (select auth.uid())
  ));

-- A single transaction checks the expected revision, records the displayed
-- snapshot, and advances the canonical device state. It never escalates roles.
create or replace function public.dtis_commit_applied(
  p_device_id uuid,
  p_command_id uuid,
  p_action text,
  p_expected_revision integer,
  p_issued_at timestamptz,
  p_settings jsonb,
  p_display_enabled boolean,
  p_refresh_version integer,
  p_applied_at timestamptz
) returns public.dtis_devices
language plpgsql security invoker set search_path = ''
as $$
declare
  current_device public.dtis_devices;
  existing_event public.dtis_events;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into current_device from public.dtis_devices
    where id = p_device_id and owner_id = auth.uid() for update;
  if not found then raise exception 'device_not_found' using errcode = '42501'; end if;

  -- Lost receipts can be re-queried without applying an operation twice.
  select * into existing_event from public.dtis_events
    where device_id = p_device_id and command_id = p_command_id;
  if found then return current_device; end if;

  if p_expected_revision is null or current_device.revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;
  if p_issued_at is null or p_issued_at < clock_timestamp() - interval '30 seconds'
    or p_issued_at > clock_timestamp() + interval '5 seconds' then
    raise exception 'command_expired' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('settings', 'display', 'refresh')
    or p_command_id is null or p_display_enabled is null or p_refresh_version is null
    or p_applied_at is null or p_applied_at < p_issued_at - interval '5 seconds'
    or p_applied_at > clock_timestamp() + interval '5 seconds'
    or p_settings is null or jsonb_typeof(p_settings) <> 'object'
    or octet_length(p_settings::text) > 250000
    or not (p_settings ?& array['facilityName', 'directionDisplayMode', 'selectedRoutes', 'tickerText', 'devices'])
    or jsonb_typeof(p_settings->'selectedRoutes') <> 'array'
    or jsonb_typeof(p_settings->'devices') <> 'array' then
    raise exception 'invalid_applied_state' using errcode = '22023';
  end if;
  -- A command changes only the field it represents.
  if (p_action <> 'settings' and p_settings <> current_device.settings)
    or (p_action <> 'display' and p_display_enabled <> current_device.display_enabled)
    or (p_action <> 'refresh' and p_refresh_version <> current_device.refresh_version)
    or (p_action = 'refresh' and p_refresh_version <> current_device.refresh_version + 1) then
    raise exception 'invalid_command_transition' using errcode = '22023';
  end if;

  update public.dtis_devices set
    settings = p_settings,
    display_enabled = p_display_enabled,
    refresh_version = p_refresh_version,
    revision = revision + 1,
    last_seen_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_device_id returning * into current_device;

  insert into public.dtis_events (device_id, owner_id, command_id, action, revision,
    settings, display_enabled, refresh_version, applied_at)
  values (p_device_id, current_device.owner_id, p_command_id, p_action, current_device.revision,
    p_settings, p_display_enabled, p_refresh_version, p_applied_at);
  return current_device;
end;
$$;

create or replace function public.dtis_heartbeat(p_device_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  update public.dtis_devices set last_seen_at = clock_timestamp()
    where id = p_device_id and owner_id = auth.uid();
  if not found then raise exception 'device_not_found' using errcode = '42501'; end if;
end;
$$;

-- A disconnected HTTP client cannot tell whether COMMIT already succeeded.
-- Wait behind the same device lock, check the exact event, and only declare an
-- absent command rejected after its acceptance window has closed. Late HTTP
-- requests then fail the expiry check in dtis_commit_applied.
create or replace function public.dtis_reconcile_applied(
  p_device_id uuid, p_command_id uuid, p_expected_revision integer, p_issued_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  current_device public.dtis_devices;
  outcome text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into current_device from public.dtis_devices
    where id = p_device_id and owner_id = auth.uid() for update;
  if not found then raise exception 'device_not_found' using errcode = '42501'; end if;
  if exists (select 1 from public.dtis_events where device_id = p_device_id and command_id = p_command_id) then
    outcome := 'committed';
  elsif current_device.revision <> p_expected_revision or p_issued_at is null
    or clock_timestamp() > p_issued_at + interval '35 seconds' then
    outcome := 'rejected';
  else outcome := 'pending'; end if;
  return jsonb_build_object('status', outcome, 'device', to_jsonb(current_device));
end;
$$;

revoke all on function public.dtis_commit_applied(uuid, uuid, text, integer, timestamptz, jsonb, boolean, integer, timestamptz) from public, anon;
grant execute on function public.dtis_commit_applied(uuid, uuid, text, integer, timestamptz, jsonb, boolean, integer, timestamptz) to authenticated;
revoke all on function public.dtis_heartbeat(uuid) from public, anon;
grant execute on function public.dtis_heartbeat(uuid) to authenticated;
revoke all on function public.dtis_reconcile_applied(uuid, uuid, integer, timestamptz) from public, anon;
grant execute on function public.dtis_reconcile_applied(uuid, uuid, integer, timestamptz) to authenticated;

-- realtime.messages already has RLS. Do not ALTER it: hosted Realtime owns it.
-- Policies allow only broadcasts on a device belonging to the signed-in owner.
drop policy if exists dtis_broadcast_receive on realtime.messages;
create policy dtis_broadcast_receive on realtime.messages for select to authenticated
using (extension = 'broadcast' and exists (
  select 1 from public.dtis_devices d
  where 'device:' || d.id::text = (select realtime.topic()) and d.owner_id = (select auth.uid())
));
drop policy if exists dtis_broadcast_send on realtime.messages;
create policy dtis_broadcast_send on realtime.messages for insert to authenticated
with check (extension = 'broadcast' and exists (
  select 1 from public.dtis_devices d
  where 'device:' || d.id::text = (select realtime.topic()) and d.owner_id = (select auth.uid())
));

commit;

-- Dashboard: Realtime Settings > disable "Allow public access".
-- No table publication, Storage bucket, Edge Function, or service_role key needed.

-- Additive upgrade: distinguishes Signage logins from periodic heartbeats.
-- Run once in the D-TIS project's SQL Editor. Existing settings are preserved.
begin;

alter table public.dtis_devices add column if not exists last_connected_at timestamptz;
alter table public.dtis_devices add column if not exists last_connection_kind text
  check (last_connection_kind is null or last_connection_kind in ('new', 'existing'));
grant update (last_connected_at, last_connection_kind) on public.dtis_devices to authenticated;

create or replace function public.dtis_connect(p_device_id uuid)
returns public.dtis_devices
language plpgsql security invoker set search_path = ''
as $$
declare
  current_device public.dtis_devices;
  connection_kind text;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into current_device from public.dtis_devices
    where id = p_device_id and owner_id = auth.uid() for update;
  if not found then raise exception 'device_not_found' using errcode = '42501'; end if;
  -- A Controller can pre-register a screen before its first Signage login.
  -- An installation upgraded after prior use is correctly classified existing.
  connection_kind := case when current_device.last_connected_at is null
    and current_device.last_seen_at is null then 'new' else 'existing' end;
  update public.dtis_devices set last_connected_at = clock_timestamp(),
    last_connection_kind = connection_kind, last_seen_at = clock_timestamp()
    where id = p_device_id returning * into current_device;
  return current_device;
end;
$$;

revoke all on function public.dtis_connect(uuid) from public, anon;
grant execute on function public.dtis_connect(uuid) to authenticated;

commit;

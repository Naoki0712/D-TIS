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

-- Run once in the D-TIS Supabase SQL Editor. Safe to rerun; retains all files.
-- Storage manages its own schema/RLS. Only add this app's private bucket/policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dtis-media', 'dtis-media', false, 52428800,
  array['image/png','image/jpeg','image/webp','image/gif','image/avif',
        'video/mp4','video/webm','video/quicktime','font/woff2','font/woff','font/ttf','font/otf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dtis_media_read on storage.objects;
create policy dtis_media_read on storage.objects for select to authenticated
using (bucket_id = 'dtis-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists dtis_media_create on storage.objects;
create policy dtis_media_create on storage.objects for insert to authenticated
with check (bucket_id = 'dtis-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists dtis_media_delete on storage.objects;
create policy dtis_media_delete on storage.objects for delete to authenticated
using (bucket_id = 'dtis-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

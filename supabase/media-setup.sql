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

-- Additive upgrade: allow operators to remove only their own Signages.
-- Run in the D-TIS project's SQL Editor after setup.sql. Safe to rerun.
-- Applying this file does not delete any devices. A confirmed Controller action
-- deletes the selected device and its events via the existing ON DELETE CASCADE.
begin;

grant delete on public.dtis_devices to authenticated;
drop policy if exists dtis_devices_delete on public.dtis_devices;
create policy dtis_devices_delete on public.dtis_devices for delete to authenticated
  using ((select auth.uid()) = owner_id);

commit;

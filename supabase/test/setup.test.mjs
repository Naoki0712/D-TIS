import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// A real embedded PostgreSQL engine validates SQL and RLS without cloud secrets.
// Only Supabase's auth.uid(), users table, and Realtime-owned table are stubbed.
const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const settings = { facilityName: "D-TIS", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "", updatedAt: "",
  devices: [{ id: "primary", code: "LCD-01", name: "メイン画面", type: "lcd", enabled: true }] };

async function asUser(id = owner, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec(`set role ${role}`);
}
async function state() {
  const { rows } = await db.query("select * from public.dtis_devices where id = $1", [deviceId]);
  return rows[0];
}
async function apply({ id = crypto.randomUUID(), revision, action = "display", enabled = false, nextSettings = settings, refresh = 0, issued = new Date() } = {}) {
  const { rows } = await db.query(`select * from public.dtis_commit_applied(
    $1::uuid, $2::uuid, $3::text, $4::integer, $5::timestamptz,
    $6::jsonb, $7::boolean, $8::integer, $9::timestamptz
  )`, [deviceId, id, action, revision, issued.toISOString(), JSON.stringify(nextSettings), enabled, refresh, new Date().toISOString()]);
  return rows[0];
}

before(async () => {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema realtime;
    create table realtime.messages (id bigint generated always as identity primary key, extension text, payload jsonb);
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to authenticated;
    grant select, insert on realtime.messages to authenticated;
    grant usage on sequence realtime.messages_id_seq to authenticated;
    create function realtime.topic() returns text language sql stable as
      $$ select current_setting('realtime.topic', true) $$;
    grant execute on function realtime.topic() to authenticated;
  `);
  const setup = await readFile(new URL("../setup.sql", import.meta.url), "utf8");
  await db.exec(setup);
  await db.exec(setup); // The user can safely rerun setup.
  await db.query("insert into auth.users(id) values ($1), ($2)", [owner, other]);
  await asUser();
  await db.query("insert into public.dtis_devices(id,owner_id,name,settings) values ($1,$2,'テスト端末',$3)", [deviceId, owner, JSON.stringify(settings)]);
});

after(async () => { await db.close(); });

test("authenticated owner can register and read a device; another owner cannot read, modify, or claim it", async () => {
  await asUser();
  assert.equal((await state()).revision, 0);
  await asUser(other);
  assert.equal(await state(), undefined);
  assert.equal((await db.query("update public.dtis_devices set display_enabled = false where id = $1 returning id", [deviceId])).rows.length, 0);
  await assert.rejects(db.query("insert into public.dtis_devices(id,owner_id,name,settings) values ($1,$2,'偽装',$3)",
    [crypto.randomUUID(), owner, JSON.stringify(settings)]), /row-level security/);
  await assert.rejects(apply({ revision: 0 }), /device_not_found/);
  await asUser();
  assert.equal((await state()).display_enabled, true);
});

test("a rendered operation atomically advances the canonical state and writes one immutable event", async () => {
  await asUser();
  const commandId = crypto.randomUUID();
  const next = await apply({ id: commandId, revision: 0 });
  assert.equal(next.revision, 1);
  assert.equal(next.display_enabled, false);
  const events = await db.query("select * from public.dtis_events where device_id = $1", [deviceId]);
  assert.equal(events.rows.length, 1);
  assert.equal(events.rows[0].command_id, commandId);
  assert.equal(events.rows[0].revision, next.revision);
  assert.deepEqual(events.rows[0].settings, next.settings);
  // Retransmitting a lost receipt never applies the operation twice.
  const duplicate = await apply({ id: commandId, revision: 0 });
  assert.equal(duplicate.revision, 1);
  assert.equal((await db.query("select count(*)::int as count from public.dtis_events")).rows[0].count, 1);
  await assert.rejects(db.exec("update public.dtis_events set action = 'refresh'"), /permission denied/);
  await assert.rejects(db.exec("delete from public.dtis_events"), /permission denied/);
});

test("stale revisions and expired or mismatched commands never change the current state", async () => {
  await asUser();
  const previous = await state();
  await assert.rejects(apply({ revision: 0, enabled: true }), /revision_conflict/);
  await assert.rejects(apply({ revision: 1, enabled: true, issued: new Date(Date.now() - 60_000) }), /command_expired/);
  await assert.rejects(apply({ revision: 1, nextSettings: { ...settings, facilityName: "不正な変更" } }), /invalid_command_transition/);
  await assert.rejects(apply({ revision: 1, action: "refresh", refresh: 9 }), /invalid_command_transition/);
  assert.deepEqual(await state(), previous);
  assert.equal((await db.query("select count(*)::int as count from public.dtis_events")).rows[0].count, 1);
});

test("an event insertion failure rolls back the preceding device update", async () => {
  await db.exec("reset role");
  await db.exec(`create function public.fail_event_test() returns trigger language plpgsql as
    $$ begin raise exception 'simulated_write_failure'; end; $$;
    create trigger fail_event_test before insert on public.dtis_events for each row execute function public.fail_event_test();`);
  await asUser();
  const previous = await state();
  await assert.rejects(apply({ revision: 1, enabled: true }), /simulated_write_failure/);
  assert.deepEqual(await state(), previous);
  await db.exec("reset role");
  await db.exec("drop trigger fail_event_test on public.dtis_events; drop function public.fail_event_test()");
});

test("refresh increments once, heartbeat uses server time, and history remains owner-scoped", async () => {
  await asUser();
  const refreshed = await apply({ revision: 1, action: "refresh", refresh: 1 });
  assert.equal(refreshed.revision, 2);
  assert.equal(refreshed.refresh_version, 1);
  await db.query("select public.dtis_heartbeat($1)", [deviceId]);
  assert.ok((await state()).last_seen_at);
  await asUser(other);
  assert.equal((await db.query("select * from public.dtis_events")).rows.length, 0);
  await assert.rejects(db.query("select public.dtis_heartbeat($1)", [deviceId]), /device_not_found/);
});

test("private broadcast policies isolate device topics and deny unauthenticated database access", async () => {
  await asUser();
  await db.query("select set_config('realtime.topic', $1, false)", [`device:${deviceId}`]);
  await db.exec("insert into realtime.messages(extension,payload) values ('broadcast','{}')");
  assert.equal((await db.query("select * from realtime.messages")).rows.length, 1);
  await db.query("select set_config('realtime.topic', $1, false)", [`device:${crypto.randomUUID()}`]);
  assert.equal((await db.query("select * from realtime.messages")).rows.length, 0);
  await assert.rejects(db.exec("insert into realtime.messages(extension,payload) values ('broadcast','{}')"), /row-level security/);
  await asUser(other);
  await db.query("select set_config('realtime.topic', $1, false)", [`device:${deviceId}`]);
  assert.equal((await db.query("select * from realtime.messages")).rows.length, 0);
  await assert.rejects(db.exec("insert into realtime.messages(extension,payload) values ('broadcast','{}')"), /row-level security/);
  await asUser("", "anon");
  await assert.rejects(db.exec("select * from public.dtis_devices"), /permission denied/);
  await assert.rejects(db.query("select public.dtis_heartbeat($1)", [deviceId]), /permission denied/);
});

test("lost commit responses reconcile by exact event; absence stays pending until expiry or a newer revision", async () => {
  await asUser();
  const current = await state();
  const { rows: events } = await db.query("select command_id from public.dtis_events order by revision limit 1");
  async function resolve(id, revision, issued = new Date()) {
    const { rows } = await db.query("select public.dtis_reconcile_applied($1,$2,$3,$4) as result",
      [deviceId, id, revision, issued.toISOString()]);
    return rows[0].result;
  }
  const committed = await resolve(events[0].command_id, 0, new Date(0));
  assert.equal(committed.status, "committed");
  assert.equal(committed.device.revision, current.revision);
  assert.equal((await resolve(crypto.randomUUID(), current.revision)).status, "pending");
  assert.equal((await resolve(crypto.randomUUID(), current.revision - 1)).status, "rejected");
  assert.equal((await resolve(crypto.randomUUID(), current.revision, new Date(Date.now() - 36_000))).status, "rejected");
  assert.deepEqual(await state(), current);
  await asUser(other);
  await assert.rejects(resolve(events[0].command_id, 0), /device_not_found/);
});

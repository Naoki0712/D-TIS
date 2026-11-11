import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("media bucket is private and isolates uploads, reads, and deletion by owner", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated nologin; create role anon nologin; create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id bigint generated always as identity,name text,bucket_id text);
      create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
      alter table storage.objects enable row level security;
      grant usage on schema auth,storage to authenticated,anon;
      grant select,insert,delete on storage.objects to authenticated;
      grant usage on sequence storage.objects_id_seq to authenticated;`);
    const sql = await readFile(new URL("../media-setup.sql", import.meta.url), "utf8");
    await db.exec(sql); await db.exec(sql);
    assert.equal((await db.query("select public from storage.buckets where id='dtis-media'")).rows[0].public, false);
    const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
    const act = async id => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec("set role authenticated"); };
    await act(owner); await db.query("insert into storage.objects(name,bucket_id) values($1,'dtis-media')", [`${owner}/image/photo.png`]);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 1);
    await act(other); assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
    assert.equal((await db.query("delete from storage.objects returning id")).rows.length, 0);
    await assert.rejects(db.query("insert into storage.objects(name,bucket_id) values($1,'dtis-media')", [`${owner}/font/private.woff2`]), /row-level security/);
    await act(owner); assert.equal((await db.query("delete from storage.objects returning id")).rows.length, 1);
  } finally { await db.close(); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicEnvironment } from "../check-public-env.mjs";

const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;

test("frontend build accepts empty, publishable, and legacy anon Supabase keys", () => {
  for (const value of ["", "sb_publishable_example", jwt("anon")]) {
    assert.doesNotThrow(() => assertPublicEnvironment({ VITE_SUPABASE_PUBLISHABLE_KEY: value }));
  }
});

test("frontend build rejects secret and service_role keys before values enter a bundle", () => {
  for (const value of ["sb_secret_example", jwt("service_role")]) {
    for (const name of ["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY", "VITE_ACCIDENTAL_KEY"]) {
      assert.throws(() => assertPublicEnvironment({ [name]: value }), error =>
        error.message.includes(name) && !error.message.includes(value));
    }
  }
  assert.throws(() => assertPublicEnvironment({ VITE_SUPABASE_PUBLISHABLE_KEY: jwt("authenticated") }), /publishable/);
});

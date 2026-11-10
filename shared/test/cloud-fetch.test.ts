import test from "node:test";
import assert from "node:assert/strict";
import { boundedCloudFetch } from "../cloud-fetch";

test("a hanging cloud HTTP request is aborted and cannot hold the operation lock indefinitely", async t => {
  let aborted = false;
  t.mock.method(globalThis, "fetch", (_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  }));
  await assert.rejects(boundedCloudFetch("https://project.supabase.co", undefined, 5), /タイムアウト/);
  assert.equal(aborted, true);
});

test("caller cancellation and request options survive the bounded fetch wrapper", async t => {
  const caller = new AbortController();
  let received: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
    received = init;
    return new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(init.signal.reason);
      else init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  const request = boundedCloudFetch("https://project.supabase.co", {
    method: "POST", body: "{}", headers: { apikey: "test-publishable" }, signal: caller.signal,
  });
  const reason = new Error("caller_cancelled");
  caller.abort(reason);
  await assert.rejects(request, /caller_cancelled/);
  assert.equal(received?.method, "POST");
  assert.equal(received?.body, "{}");
  assert.deepEqual(received?.headers, { apikey: "test-publishable" });
  assert.equal(received?.signal?.aborted, true);
});

test("a successful request preserves its response and an already-aborted caller stays aborted", async t => {
  const response = new Response("ok", { status: 200 });
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal?.aborted) throw init.signal.reason;
    return response;
  });
  assert.equal(await boundedCloudFetch("https://project.supabase.co"), response);
  const caller = new AbortController();
  caller.abort(new Error("already_cancelled"));
  await assert.rejects(boundedCloudFetch(new Request("https://project.supabase.co", { signal: caller.signal })), /already_cancelled/);
});

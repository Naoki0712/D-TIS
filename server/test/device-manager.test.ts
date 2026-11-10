import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import express, { type Request } from "express";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createDeviceManager, isLocalSignageRequest } from "../src/device-manager.js";
import { createPowerController, type PowerAction } from "../src/power.js";
import { createServer as createViteServer } from "vite";
import { isLocalSignageProxyRequest, localSignageProxyGuard } from "../../shared/local-signage-proxy.js";

async function fixture(t: TestContext, powerEnabled = false, failPower = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "dtis-test-"));
  let time = Date.now();
  const executed: PowerAction[] = [];
  const options = {
    dataDirectory: directory, port: 3000, getSettingsVersion: async () => "settings-1",
    now: () => time, powerDelayMs: 100,
    power: { supported: powerEnabled, reason: powerEnabled ? null : "unsupported",
      async execute(action: PowerAction) { executed.push(action); if (failPower) throw new Error("sudo denied"); } },
  };
  const manager = await createDeviceManager(options);
  const app = express();
  const requests: { host?: string; address?: string; origin?: string; site?: string; marker?: string }[] = [];
  app.use((q, _s, next) => { requests.push({ host: q.get("host"), address: q.socket.remoteAddress, origin: q.get("origin"), site: q.get("sec-fetch-site"), marker: q.get("x-dtis-remote-client") }); next(); });
  app.use(express.json());
  manager.mount(app);
  app.put("/api/settings", manager.requireController, (_q, s) => { s.json({ saved: true }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    manager.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (route: string, method = "GET", body?: unknown, token?: string, headers?: Record<string, string>) =>
    fetch(origin + route, { method, headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
    }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function pair() {
    const state = await (await request("/api/signage/state")).json();
    const response = await request("/api/pairing/claim", "POST", { pin: state.pairing.pin, name: "test" });
    assert.equal(response.status, 201);
    return await response.json();
  }
  return { origin, request, pair, directory, options, executed, requests, advance: (ms: number) => { time += ms; } };
}

test("LAN clients cannot impersonate the local kiosk using a loopback Host header", () => {
  for (const address of ["192.168.1.12", "::ffff:192.168.1.12", "2001:db8::1"]) {
    const request = { socket: { remoteAddress: address }, get: () => "127.0.0.1:3000" } as unknown as Request;
    assert.equal(isLocalSignageRequest(request), false);
  }
});

test("same-machine IP and hostname access can display PIN while foreign clients stay denied", () => {
  const interfaces = Object.values(networkInterfaces()).flatMap(items => items ?? []);
  const addresses = ["127.0.0.1", "::1", ...interfaces.map(item => item.address)];
  const machine = hostname().toLowerCase();
  const hosts = ["localhost", machine, `${machine.split(".")[0]}.local`, ...addresses.map(address => address.includes(":") ? `[${address}]` : address)];
  const request = (address: string, host: string, extra: Record<string, string> = {}) => {
    const headers = { host: `${host}:5173`, origin: `http://${host}:5173`, "sec-fetch-site": "same-origin", ...extra };
    return { socket: { remoteAddress: address }, headers, get: (name: string) => headers[name.toLowerCase() as keyof typeof headers] };
  };
  for (const address of addresses) for (const host of hosts) {
    if (address.includes("%") || host.includes("%")) continue;
    const req = request(address, host);
    assert.equal(isLocalSignageRequest(req as unknown as Request), true, `${address} -> ${host}`);
    assert.equal(isLocalSignageProxyRequest(req as any), true, `${address} -> ${host} through Vite`);
  }
  const ownIPv4 = interfaces.find(item => item.family === "IPv4" && !item.internal)?.address ?? "127.0.0.1";
  assert.equal(isLocalSignageRequest(request(`::ffff:${ownIPv4}`, ownIPv4) as unknown as Request), true);
  assert.equal(isLocalSignageProxyRequest(request(`::ffff:${ownIPv4}`, ownIPv4) as any), true);
  for (const req of [
    request("203.0.113.42", ownIPv4), request("203.0.113.42", machine),
    request(ownIPv4, "attacker.example"), request(ownIPv4, ownIPv4, { origin: "http://attacker.example" }),
    request(ownIPv4, ownIPv4, { "sec-fetch-site": "cross-site" }),
    request(ownIPv4, ownIPv4, { "x-dtis-remote-client": "1" }),
  ]) {
    assert.equal(isLocalSignageRequest(req as unknown as Request), false);
    assert.equal(isLocalSignageProxyRequest(req as any), false);
  }
});

test("Vite forwards same-machine IP PIN requests and preserves blocked proxy-client status", async (t) => {
  const f = await fixture(t);
  const proxiedRequests: { host?: string; address?: string; origin?: string; site?: string; marker?: string }[] = [];
  const vite = await createViteServer({
    configFile: false, appType: "custom", logLevel: "silent", plugins: [{ name: "request-observer", configureServer(server) { server.middlewares.use((q, _s, next) => { proxiedRequests.push({ host: q.headers.host, address: q.socket.remoteAddress, origin: q.headers.origin, site: q.headers["sec-fetch-site"] as string, marker: q.headers["x-dtis-remote-client"] as string }); next(); }); } }, localSignageProxyGuard()],
    server: { middlewareMode: true, hmr: false, proxy: { "/api": f.origin } },
  });
  const proxy = createHttpServer(vite.middlewares);
  t.after(async () => {
    proxy.closeAllConnections();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
    await vite.close();
  });
  proxy.listen(0, "0.0.0.0");
  await new Promise<void>(resolve => proxy.once("listening", resolve));
  const port = (proxy.address() as AddressInfo).port;
  const address = Object.values(networkInterfaces()).flatMap(items => items ?? []).find(item => item.family === "IPv4" && !item.internal)?.address ?? "127.0.0.1";
  const origin = `http://${address}:${port}`;
  const allowed = await fetch(`${origin}/api/signage/state`, { headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" }, signal: AbortSignal.timeout(5000) });
  assert.equal(allowed.status, 200, JSON.stringify({ backend: f.requests, vite: proxiedRequests }));
  assert.match((await allowed.json()).pairing.pin, /^\d{6}$/);
  const controllerOrigin = `http://${address}:${port + 1}`;
  const preflight = await fetch(`${origin}/api/pairing/claim`, { method: "OPTIONS", headers: {
    Origin: controllerOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type",
  }, signal: AbortSignal.timeout(5000) });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-headers")!, /Authorization/);
  const settingsPreflight = await fetch(`${origin}/api/settings`, { method: "OPTIONS", headers: {
    Origin: controllerOrigin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "authorization,content-type",
  }, signal: AbortSignal.timeout(5000) });
  assert.equal(settingsPreflight.status, 204);
  assert.equal(settingsPreflight.headers.get("access-control-allow-origin"), "*");
  const pinPreflight = await fetch(`${origin}/api/signage/state`, { method: "OPTIONS", headers: {
    Origin: controllerOrigin, "Access-Control-Request-Method": "GET",
  }, signal: AbortSignal.timeout(5000) });
  assert.equal(pinPreflight.status, 403);
  assert.equal(pinPreflight.headers.get("access-control-allow-origin"), null);
  const assetPreflight = await fetch(`${origin}/src/main.tsx`, { method: "OPTIONS", headers: {
    Origin: controllerOrigin, "Access-Control-Request-Method": "GET",
  }, signal: AbortSignal.timeout(5000) });
  assert.equal(assetPreflight.headers.get("access-control-allow-origin"), null, "Vite asset CORS remains limited to its original allowed origins");
  for (const headers of [{ Origin: "http://attacker.example" }, { "X-DTIS-Remote-Client": "1" }, { "Sec-Fetch-Site": "cross-site" }]) {
    const denied = await fetch(`${origin}/api/signage/state`, { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).pairing, undefined);
  }
  const remoteMarker = await fetch(`${origin}/api/pairing/claim`, { method: "POST", headers: { "Content-Type": "application/json", "X-DTIS-Remote-Client": "1" }, body: JSON.stringify({ pin: "bad" }), signal: AbortSignal.timeout(5000) });
  assert.equal(remoteMarker.status, 400, "remote Controller pairing remains available without access to PIN state");
});

test("PIN is local-only and excludes hostile origins, Host values and proxy clients", async (t) => {
  const f = await fixture(t);
  const local = await f.request("/api/signage/state");
  assert.equal(local.status, 200);
  assert.equal(local.headers.get("cache-control"), "no-store");
  assert.equal(local.headers.get("access-control-allow-origin"), null);
  assert.match((await local.json()).pairing.pin, /^\d{6}$/);
  for (const headers of [
    { Origin: "https://attacker.example" }, { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" },
    { "X-DTIS-Remote-Client": "1" },
  ]) {
    const response = await f.request("/api/signage/state", "GET", undefined, undefined, headers);
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal((await response.json()).pairing, undefined);
  }
  const spoofed = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(f.origin + "/api/signage/state", { headers: { Host: "attacker.example" } }, (res) => {
      res.resume(); resolve(res.statusCode);
    });
    req.on("error", reject); req.end();
  });
  assert.equal(spoofed, 403);
  for (const route of ["/api/SIGNAGE/state", "/API/Signage/STATE"]) {
    assert.equal((await f.request(route, "GET", undefined, undefined, { Origin: "https://attacker.example" })).status, 403);
  }
  assert.equal((await f.request("/api/signage/heartbeat", "POST")).status, 415);
});

test("pairing grants scoped token, consumes PIN and never exposes token or PIN in remote status", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/device")).status, 401);
  assert.equal((await f.request("/api/settings", "PUT", {})).status, 401);
  assert.equal((await f.request("/api/pairing/claim", "POST", { pin: "invalid" })).status, 400);
  const state = await (await f.request("/api/signage/state")).json();
  const paired = await f.pair();
  assert.match(paired.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await f.request("/api/pairing/claim", "POST", { pin: state.pairing.pin })).status, 400);
  assert.equal((await f.request("/api/settings", "PUT", {}, paired.token)).status, 200);
  const device = await (await f.request("/api/device", "GET", undefined, paired.token)).json();
  assert.equal(device.deviceId, paired.device.deviceId);
  assert.equal(device.pairing, undefined);
  assert.equal(device.controllers, undefined);
  assert.equal(device.token, undefined);
  const local = await (await f.request("/api/signage/state")).json();
  assert.equal(local.paired, true);
  assert.equal(local.pairing, null);
  const disk = await readFile(path.join(f.directory, "pairing.json"), "utf8");
  assert.equal(disk.includes(paired.token), false);
  assert.equal(disk.includes(state.pairing.pin), false);
});

test("PIN expires and failed claims are rate limited", async (t) => {
  const f = await fixture(t);
  const previous = await (await f.request("/api/signage/state")).json();
  f.advance(300_001);
  const current = await (await f.request("/api/signage/state")).json();
  assert.notEqual(current.pairing.expiresAt, previous.pairing.expiresAt);
  // Use malformed codes to avoid the 1-in-a-million possibility of matching a newly generated PIN.
  for (let i = 0; i < 10; i++) assert.equal((await f.request("/api/pairing/claim", "POST", { pin: "wrong" })).status, 400);
  const blocked = await f.request("/api/pairing/claim", "POST", { pin: current.pairing.pin });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "300");
  f.advance(300_001);
  await f.pair();
  const additional = await (await f.request("/api/signage/pairing", "POST", {})).json();
  f.advance(300_001);
  assert.equal((await f.request("/api/pairing/claim", "POST", { pin: additional.pairing.pin })).status, 400);
  assert.equal((await (await f.request("/api/signage/state")).json()).pairing, null);
});

test("controller revocation is isolated and last revocation reopens local PIN", async (t) => {
  const f = await fixture(t);
  const first = await f.pair();
  await f.request("/api/signage/pairing", "POST", {});
  const second = await f.pair();
  assert.equal((await f.request("/api/pairing/controller", "DELETE", undefined, first.token)).status, 200);
  assert.equal((await f.request("/api/device", "GET", undefined, first.token)).status, 401);
  assert.equal((await f.request("/api/device", "GET", undefined, second.token)).status, 200);
  await f.request("/api/pairing/controller", "DELETE", undefined, second.token);
  const local = await (await f.request("/api/signage/state")).json();
  assert.equal(local.paired, false);
  assert.match(local.pairing.pin, /^\d{6}$/);
});

test("concurrent claims accept one controller per PIN", async (t) => {
  const f = await fixture(t);
  const { pairing } = await (await f.request("/api/signage/state")).json();
  const responses = await Promise.all([1, 2].map(() => f.request("/api/pairing/claim", "POST", { pin: pairing.pin })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 400]);
});

test("heartbeat measures kiosk presence; display and refresh reach local runtime and survive restart", async (t) => {
  const f = await fixture(t);
  const { token } = await f.pair();
  assert.equal((await (await f.request("/api/device", "GET", undefined, token)).json()).signageOnline, false);
  const heartbeat = await (await f.request("/api/signage/heartbeat", "POST", {})).json();
  assert.equal(heartbeat.signageOnline, true);
  assert.equal(heartbeat.settingsVersion, "settings-1");
  assert.equal((await f.request("/api/device/display", "POST", { enabled: "false" }, token)).status, 400);
  await f.request("/api/device/display", "POST", { enabled: false }, token);
  await f.request("/api/device/refresh", "POST", {}, token);
  const state = await (await f.request("/api/signage/state")).json();
  assert.equal(state.displayEnabled, false);
  assert.equal(state.refreshVersion, 1);
  f.advance(15_001);
  assert.equal((await (await f.request("/api/device", "GET", undefined, token)).json()).signageOnline, false);
  const restarted = await createDeviceManager(f.options);
  t.after(() => restarted.close());
  const app = express();
  restarted.mount(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/device`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const after = await response.json();
  assert.equal(after.deviceId, state.deviceId);
  assert.equal(after.displayEnabled, false);
});

test("CORS permits token-authenticated controllers from a different origin", async (t) => {
  const f = await fixture(t);
  const preflight = await f.request("/api/device/power", "OPTIONS", undefined, undefined, {
    Origin: "http://192.168.1.10:3000", "Access-Control-Request-Headers": "authorization,content-type",
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-headers")!, /Authorization/);
});

test("power rejects unauthenticated, unsupported and arbitrary commands without execution", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/device/power", "POST", { action: "reboot" })).status, 401);
  const { token } = await f.pair();
  assert.equal((await f.request("/api/device/power", "POST", { action: "reboot" }, token)).status, 403);
  assert.equal((await f.request("/api/device/power", "POST", { action: "reboot;whoami" }, token)).status, 400);
  assert.deepEqual(f.executed, []);
});

test("power acceptance queues only one allowlisted command and surfaces execution failure", async (t) => {
  const f = await fixture(t, true, true);
  const { token } = await f.pair();
  const first = await f.request("/api/device/power", "POST", { action: "shutdown" }, token);
  assert.equal(first.status, 202);
  assert.equal((await first.json()).accepted, true);
  assert.equal((await f.request("/api/device/power", "POST", { action: "reboot" }, token)).status, 409);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(f.executed, ["shutdown"]);
  const state = await (await f.request("/api/device", "GET", undefined, token)).json();
  assert.equal(state.pendingPower, null);
  assert.match(state.powerError, /失敗/);
});

test("corrupt pairing storage fails closed instead of silently clearing authorization", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "pairing.json"), "{bad");
  await assert.rejects(createDeviceManager(f.options), /起動を中止/);
});

test("actual host cannot issue power commands unless Raspberry Pi setup passes", async () => {
  const power = await createPowerController();
  // Never invoke the real executor. This assertion specifically covers the development Windows host.
  if (process.platform !== "linux") assert.equal(power.supported, false);
});

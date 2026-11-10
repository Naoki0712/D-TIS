import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const routeA = { railway: "odpt.Railway:Test.A", station: "odpt.Station:Test.A.One", direction: "odpt.RailDirection:Test.Outbound" };
const routeB = { railway: "odpt.Railway:Test.B", station: "odpt.Station:Test.B.Two", direction: "odpt.RailDirection:Test.Inbound" };
const initialFacility = {
  facilityName: "Before pairing",
  selectedRoutes: [],
  devices: [],
  // A future timestamp ensures writes really advance the persisted version,
  // even when the host clock has moved backwards since the previous write.
  updatedAt: "2099-01-01T00:00:00.000Z",
};
const cachedTimetable = (route: typeof routeA, id: string) => ({
  ...route, id, calendar: "Weekday", railwayName: id, railwayEnglish: id,
  stationName: "テスト駅", stationEnglish: "Test Station", stationCode: "T01",
  directionName: "テスト方面", directionEnglish: "Test Direction",
  generatedAt: null, validUntil: null,
  departures: [{
    time: "12:00", type: "各駅停車", typeEnglish: "Local", destination: "終点",
    destinationEnglish: "Terminus", destinationCodes: ["T02"], trainNumber: null, note: null,
  }],
});
const cache = {
  // Always stale: API requests must exercise the offline fallback, not just a
  // still-fresh in-memory cache hit.
  fetchedAt: "2000-01-01T00:00:00.000Z", source: "live", frequencySeconds: 60,
  timetables: [cachedTimetable(routeA, "table-a"), cachedTimetable(routeB, "table-b")],
  lines: [routeA, routeB].map((route, index) => ({
    id: route.railway, name: `テスト${index + 1}線`,
    stations: [{ id: route.station, name: "テスト駅", directions: [route.direction] }],
  })),
  trainInformation: [routeA, routeB].map((route) => ({
    railway: route.railway, railwayName: route.railway, text: "平常運転",
    generatedAt: null, validUntil: null,
  })),
};

async function unusedPort() {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), "d-tis-server-integration-"));
  let child: ChildProcess | undefined;
  let childClosed: Promise<void> | undefined;
  let output = "";
  t.after(async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill();
        const forceKill = setTimeout(() => child?.kill("SIGKILL"), 3000);
        forceKill.unref();
        try { await childClosed; } finally { clearTimeout(forceKill); }
      }
    } finally {
      // Only remove the unique directory created by this fixture.
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    }
  });
  await Promise.all([
    writeFile(path.join(directory, "facility.json"), JSON.stringify(initialFacility)),
    writeFile(path.join(directory, "odpt-cache.json"), JSON.stringify(cache)),
  ]);
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      DTIS_DATA_DIR: directory,
      PORT: String(port),
      ODPT_API_TOKEN: "",
      // Even a regression that tries fetching without a token cannot contact
      // the real ODPT service or use a developer's configured credentials.
      ODPT_API_BASE_URL: "http://127.0.0.1:1/no-external-network",
      ODPT_CACHE_MAX_AGE_MS: "0",
      DOTENV_CONFIG_PATH: path.join(directory, "nonexistent.env"),
      DTIS_POWER_CONTROL: "0",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => { output = (output + chunk.toString()).slice(-8000); });
  child.stderr?.on("data", (chunk) => { output = (output + chunk.toString()).slice(-8000); });
  let spawnError: Error | undefined;
  child.on("error", (error) => { spawnError = error; });
  childClosed = new Promise<void>((resolve) => child!.once("close", () => resolve()));

  async function request(endpoint: string, method = "GET", body?: unknown, token?: string) {
    return fetch(`${base}${endpoint}`, {
      method, signal: AbortSignal.timeout(3000),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const deadline = Date.now() + 10_000;
  while (true) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Integration server did not start: ${spawnError?.message ?? "exited"}\n${output}`);
    }
    try {
      const response = await request("/api/health");
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.configured, false);
        break;
      }
    } catch { /* The listener may not be ready yet. */ }
    if (Date.now() >= deadline) throw new Error(`Integration server readiness timeout:\n${output}`);
    await delay(50);
  }
  return { request, directory };
}

test("real server pairs Controller, persists settings, and serves selected offline cache to Signage", { timeout: 20_000 }, async (t) => {
  const { request, directory } = await fixture(t);
  const original = await (await request("/api/settings")).json();
  assert.deepEqual(original, { ...initialFacility, directionDisplayMode: "separate", tickerText: "" });

  const local = await (await request("/api/signage/state")).json();
  assert.match(local.pairing.pin, /^\d{6}$/);
  assert.equal(local.settingsVersion, original.updatedAt);
  assert.equal(local.power.supported, false);
  const claim = await request("/api/pairing/claim", "POST", { pin: local.pairing.pin, name: "Integration Controller" });
  assert.equal(claim.status, 201);
  const { token, device } = await claim.json();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(device.settingsVersion, original.updatedAt);

  const settings = {
    facilityName: "連携テスト施設", directionDisplayMode: "combined", selectedRoutes: [routeA], tickerText: "",
    devices: [{ id: "lcd-1", code: "LCD", name: "案内画面", type: "lcd", enabled: true }],
  };
  const update = await request("/api/settings", "PUT", settings, token);
  assert.equal(update.status, 200);
  const saved = await update.json();
  assert.equal(Date.parse(saved.updatedAt), Date.parse(original.updatedAt) + 1);
  assert.deepEqual(saved, { ...settings, updatedAt: saved.updatedAt });
  assert.deepEqual(await (await request("/api/settings")).json(), saved);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "facility.json"), "utf8")), saved);

  const invalidMode = await request("/api/settings", "PUT", { ...settings, directionDisplayMode: "invalid" }, token);
  assert.equal(invalidMode.status, 400);
  assert.deepEqual(await (await request("/api/settings")).json(), saved);

  const heartbeat = await request("/api/signage/heartbeat", "POST", {});
  assert.equal(heartbeat.status, 200);
  const runtime = await heartbeat.json();
  assert.equal(runtime.settingsVersion, saved.updatedAt);
  assert.equal(runtime.signageOnline, true);
  assert.equal(runtime.paired, true);
  assert.equal(runtime.pairing, null);
  const controllerState = await (await request("/api/device", "GET", undefined, token)).json();
  assert.equal(controllerState.settingsVersion, saved.updatedAt);
  assert.equal(controllerState.signageOnline, true);

  const unauthorized = await request("/api/settings", "PUT", { ...settings, facilityName: "Unauthorized overwrite" });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await (await request("/api/settings")).json(), saved);

  // Concurrent catalog/data reads share the real ODPT route code, with an old
  // cache and missing token forcing both routes through their fallback paths.
  const [catalogResponse, dataResponse] = await Promise.all([
    request("/api/odpt/catalog"), request("/api/odpt/data"),
  ]);
  assert.equal(catalogResponse.status, 200);
  assert.equal(dataResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.deepEqual(catalog, { source: "cache", fetchedAt: cache.fetchedAt, lines: cache.lines });
  const data = await dataResponse.json();
  assert.equal(data.source, "cache");
  assert.equal(data.stale, true);
  assert.match(data.error, /ODPT_API_TOKEN/);
  assert.equal(data.fetchedAt, cache.fetchedAt);
  assert.equal(data.selectionCount, 1);
  assert.deepEqual(data.timetables, [cache.timetables[0]]);
  assert.deepEqual(data.trainInformation, [cache.trainInformation[0]]);

  // A second configuration reaches both the heartbeat and cache selection;
  // this catches routes that keep using startup settings or stale versions.
  const second = await request("/api/settings", "PUT", { ...settings, selectedRoutes: [routeB] }, token);
  assert.equal(second.status, 200);
  const savedSecond = await second.json();
  assert.equal(savedSecond.directionDisplayMode, "combined");
  assert.equal(Date.parse(savedSecond.updatedAt), Date.parse(saved.updatedAt) + 1);
  assert.equal((await (await request("/api/signage/heartbeat", "POST", {})).json()).settingsVersion, savedSecond.updatedAt);
  const changedData = await (await request("/api/odpt/data")).json();
  assert.deepEqual(changedData.timetables, [cache.timetables[1]]);
  assert.deepEqual(changedData.trainInformation, [cache.trainInformation[1]]);
  const odptStatus = await (await request("/api/odpt/status")).json();
  assert.equal(odptStatus.configured, false);
  assert.equal(odptStatus.cacheAvailable, true);
  assert.match(odptStatus.lastError, /ODPT_API_TOKEN/);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "odpt-cache.json"), "utf8")), cache);
});

test("equipment settings, route visibility and ticker persist independently and select the right output", { timeout: 20_000 }, async t => {
  const { request } = await fixture(t);
  const { pairing } = await (await request("/api/signage/state")).json();
  const { token } = await (await request("/api/pairing/claim", "POST", { pin: pairing.pin })).json();
  const lcd = { facilityName: "LCD施設", directionDisplayMode: "combined", tickerText: "足元にご注意ください。", selectedRoutes: [{ ...routeA, display: { showLineName: false, showDirection: true, showTrainType: false, showCarCount: true, directionDisplayMode: "combined" } }] };
  const led = { facilityName: "LED施設", directionDisplayMode: "separate", tickerText: "LED専用のお知らせ", selectedRoutes: [routeB] };
  const payload = { facilityName: "共通施設", directionDisplayMode: "separate", tickerText: "", selectedRoutes: [], devices: [
    { id: "lcd", code: "LCD", name: "改札LCD", type: "lcd", enabled: true, settings: lcd },
    { id: "led", code: "LED", name: "ホームLED", type: "led", enabled: true, settings: led },
  ] };
  const put = await request("/api/settings", "PUT", payload, token);
  assert.equal(put.status, 200);
  const saved = await put.json();
  assert.deepEqual(saved.devices[0].settings, lcd);
  assert.deepEqual(saved.devices[1].settings, led);
  assert.deepEqual((await (await request("/api/odpt/data")).json()).timetables, [cache.timetables[0]]);
  assert.deepEqual((await (await request("/api/odpt/data?output=led")).json()).timetables, [cache.timetables[1]]);
  assert.equal((await request("/api/odpt/data?output=missing")).status, 404);
  const invalid = structuredClone(payload);
  (invalid.devices[0].settings.selectedRoutes[0] as any).display.showLineName = "false";
  assert.equal((await request("/api/settings", "PUT", invalid, token)).status, 400);
  invalid.devices[0].settings = { ...lcd, tickerText: "a".repeat(2001) };
  assert.equal((await request("/api/settings", "PUT", invalid, token)).status, 400);
  assert.deepEqual(await (await request("/api/settings")).json(), saved);
  const stopped = { ...saved, devices: saved.devices.map((device: any) => device.id === "lcd" ? { ...device, enabled: false } : device) };
  assert.equal((await request("/api/settings", "PUT", stopped, token)).status, 200);
  const oldClient = await request("/api/settings", "PUT", { facilityName: "旧クライアント", selectedRoutes: [] }, token);
  assert.equal(oldClient.status, 200);
  const preserved = await oldClient.json();
  assert.deepEqual(preserved.devices[1].settings, led);
  assert.equal(preserved.devices[0].enabled, false);
  assert.equal(preserved.devices[0].settings.tickerText, lcd.tickerText);
});

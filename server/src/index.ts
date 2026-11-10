import { config as loadEnvironment } from "dotenv";
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDeviceManager } from "./device-manager.js";
import { createPowerController } from "./power.js";
import { normalizeFacility, effectiveSettings, allSelectedRoutes, SettingsError, type Facility, type Device, type DisplaySettings } from "./configuration.js";
import { refreshOdpt, fetchSelectedBuses, missingBusSelections, requiredOperators, enrichCachedTimetables, type Cache, type Raw } from "./odpt.js";
const defaultDevices: Device[] = [
  {
    id: "research-lcd",
    code: "LCD",
    name: "研究用LCD",
    type: "lcd",
    enabled: true,
  },
  {
    id: "home-led",
    code: "DB",
    name: "自宅用LED",
    type: "led",
    enabled: true,
  },
  {
    id: "departure-switch",
    code: "DS",
    name: "発車ベルスイッチ",
    type: "bell-switch",
    enabled: true,
  },
];
const app = express(),
  sr = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  root = path.resolve(sr, "..");
// npm workspaces run this process inside server/. Resolve the repository .env
// independently of cwd; explicit environment and test overrides retain priority.
loadEnvironment({ path: process.env.DOTENV_CONFIG_PATH ?? path.join(root, ".env") });
const port = Number(process.env.PORT ?? 3000),
  dataDirectory = process.env.DTIS_DATA_DIR ?? path.join(sr, "data"),
  facilityFile = path.join(dataDirectory, "facility.json"),
  cacheFile = path.join(dataDirectory, "odpt-cache.json"),
  base = process.env.ODPT_API_BASE_URL ?? "https://api.odpt.org/api/v4",
  maxAge = Number(process.env.ODPT_CACHE_MAX_AGE_MS ?? 900000);
let memory: Cache | null = null,
  lastError: string | null = null;
app.use(express.json({ limit: "256kb" }));
const deviceManager = await createDeviceManager({
  dataDirectory,
  port,
  power: await createPowerController(),
  getSettingsVersion: async () => (await readFacility()).updatedAt,
});
deviceManager.mount(app);

async function readFacility(): Promise<Facility> {
  const raw = JSON.parse(await fs.readFile(facilityFile, "utf8"));
  return normalizeFacility(raw, defaultDevices);
}
async function readCache() {
  if (memory) return memory;
  try {
    memory = enrichCachedTimetables(JSON.parse(await fs.readFile(cacheFile, "utf8")));
    return memory;
  } catch {
    return null;
  }
}
function url(type: string, filters: Record<string, string> = {}) {
  const u = new URL(`${base}/${type}`), token = process.env.ODPT_API_TOKEN;
  if (!token) throw new Error("ODPT_API_TOKENが設定されていません。");
  u.searchParams.set("acl:consumerKey", token);
  for (const [key, value] of Object.entries(filters)) u.searchParams.set(key, value);
  return u;
}
async function fetchJson(type: string, filters: Record<string, string> = {}) {
  const r = await fetch(url(type, filters), {
    headers: { Accept: "application/ld+json" }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${type}: HTTP ${r.status}`);
  const rows: unknown = await r.json();
  if (!Array.isArray(rows)) throw new Error(`${type}: データの形式が不正です。`);
  return rows as Raw[];
}
let odptRequest: Promise<Cache> | null = null;
function fetchOdpt(force = false): Promise<Cache> {
  if (!odptRequest) {
    odptRequest = fetchOdptOnce(force).finally(() => { odptRequest = null; });
  }
  return odptRequest;
}
async function fetchOdptOnce(force = false) {
  const c = await readCache();
  const facility = await readFacility();
  if (!process.env.ODPT_API_TOKEN) throw new Error("ODPT_API_TOKENが設定されていません。");
  const freshCache = !force && c && Date.now() - Date.parse(c.fetchedAt) < Math.min(maxAge, c.frequencySeconds * 1000);
  if (freshCache && !missingBusSelections(c, allSelectedRoutes(facility)).length) return { ...c, source: "cache" as const };
  // Keep required operators even when an older .env still specifies TokyoMetro.
  const configured = (process.env.ODPT_OPERATORS ?? process.env.ODPT_OPERATOR ?? "").split(",").map((value) => value.trim().replace(/^odpt\.Operator:/, "")).filter(Boolean);
  const operators = [...new Set([...requiredOperators, ...configured])];
  const fresh = freshCache
    ? await fetchSelectedBuses({ ...c, source: "live" }, missingBusSelections(c, allSelectedRoutes(facility)), fetchJson)
    : await refreshOdpt(c, allSelectedRoutes(facility), fetchJson, operators);
  const cacheTmp = cacheFile + ".tmp";
  await fs.writeFile(cacheTmp, JSON.stringify(fresh, null, 2) + "\n");
  await fs.rename(cacheTmp, cacheFile);
  memory = fresh;
  lastError = fresh.warnings?.join(" ") || null;
  return fresh;
}
function selectForFacility(d: Cache, f: DisplaySettings, source: "live" | "cache", extra: Record<string, unknown> = {}) {
  const chosen = f.selectedRoutes;
  const timetables = chosen.length
    ? d.timetables.filter((t) =>
        chosen.some(
          (x) =>
            x.railway === t.railway &&
            x.station === t.station &&
            (!x.direction || x.direction === t.direction),
        ),
      )
    : [];
  return {
    source,
    fetchedAt: d.fetchedAt,
    frequencySeconds: d.frequencySeconds,
    timetables,
    trainInformation: d.trainInformation.filter((i) =>
      chosen.some((x) => x.railway === i.railway),
    ),
    selectionCount: chosen.length,
    ...(d.warnings?.length ? { stale: true, error: d.warnings.join(" ") } : {}),
    ...extra,
  };
}
function catalogLines(cache: Cache) {
  return cache.lines.map(line => cache.timetables.some(table => table.railway === line.id && table.departures.some(departure => departure.carCount))
    ? { ...line, supportsCarCount: true } : line);
}

app.get("/api/health", (_q, s) =>
  s.json({
    ok: true,
    source: "odpt",
    configured: !!process.env.ODPT_API_TOKEN,
  }),
);
app.get("/api/settings", async (_q, s, n) => {
  try {
    s.json(await readFacility());
  } catch (e) {
    n(e);
  }
});
let settingsWrite: Promise<unknown> = Promise.resolve();
app.put("/api/settings", deviceManager.requireController, async (q, s, n) => {
  try {
    let saved: Facility | undefined;
    const write = settingsWrite.then(async () => {
      const previous = await readFacility();
      saved = normalizeFacility(q.body, defaultDevices, previous);
      saved.updatedAt = new Date(Math.max(Date.now(), (Date.parse(previous.updatedAt) || 0) + 1)).toISOString();
      const tmp = facilityFile + ".tmp";
      await fs.writeFile(tmp, JSON.stringify(saved, null, 2) + "\n");
      await fs.rename(tmp, facilityFile);
    });
    settingsWrite = write.catch(() => {});
    await write;
    s.json(saved);
  } catch (error) {
    if (error instanceof SettingsError) s.status(400).json({ message: error.message });
    else n(error);
  }
});
app.get("/api/odpt/status", async (_q, s) => {
  const c = await readCache();
  s.json({
    configured: !!process.env.ODPT_API_TOKEN,
    operator: process.env.ODPT_OPERATOR ?? null,
    operators: requiredOperators,
    lastFetchAt: c?.fetchedAt ?? null,
    cacheAvailable: !!c,
    lastError,
  });
});
app.get("/api/odpt/catalog", async (_q, s) => {
  try {
    const d = await fetchOdpt();
    s.json({ source: d.source, fetchedAt: d.fetchedAt, lines: catalogLines(d) });
  } catch (e) {
    const cached = await readCache();
    if (cached) {
      s.json({ source: "cache", fetchedAt: cached.fetchedAt, lines: catalogLines(cached) });
      return;
    }
    s.status(503).json({
      lines: [],
      error: e instanceof Error ? e.message : "取得失敗",
    });
  }
});
app.get("/api/odpt/data", async (q, s) => {
  const output = typeof q.query.output === "string" ? q.query.output : undefined;
  if (output && !(await readFacility()).devices.some(device => device.id === output)) { s.status(404).json({ error: "Unknown output" }); return; }
  try {
    const d = await fetchOdpt();
    const f = await readFacility();
    s.json(selectForFacility(d, effectiveSettings(f, output), d.source));
  } catch (e) {
    lastError = e instanceof Error ? e.message : "取得失敗";
    const c = await readCache();
    if (c) {
      const f = await readFacility();
      s.json(
        selectForFacility(c, effectiveSettings(f, output), "cache", {
          stale: true,
          error: lastError,
        }),
      );
      return;
    }
    s.status(503).json({
      source: "unavailable",
      fetchedAt: null,
      frequencySeconds: 60,
      timetables: [],
      trainInformation: [],
      selectionCount: 0,
      error: lastError,
    });
  }
});

const sg = path.join(root, "signage", "dist");
const controller = path.join(root, "controller", "dist");

app.use("/assets", express.static(path.join(root, "assets")));
app.use("/signage", express.static(sg));
app.get("/signage/*splat", (_q, s) => s.sendFile(path.join(sg, "index.html")));
app.use("/controller", express.static(controller));
app.get("/controller/*splat", (_q, s) =>
  s.sendFile(path.join(controller, "index.html")),
);
app.get("/", (_q, s) => s.redirect("/signage/"));
app.use(
  (
    _e: unknown,
    _q: express.Request,
    s: express.Response,
    _n: express.NextFunction,
  ) => s.status(500).json({ message: "サーバーエラー" }),
);
app.listen(port, "0.0.0.0", () => {
  console.log(`D-TIS Signage/API: http://localhost:${port}/signage/`);
  fetchOdpt(true)
    .then((c) =>
      console.log(
        `ODPT: ${c.lines.length} lines / ${c.timetables.length} timetables`,
      ),
    )
    .catch(async (e) => {
      lastError = e instanceof Error ? e.message : "取得失敗";
      const cached = await readCache();
      if (cached) {
        console.warn(`ODPT offline: ローカルキャッシュを使用します (${cached.fetchedAt})`);
      } else {
        console.error(e);
      }
    });
});

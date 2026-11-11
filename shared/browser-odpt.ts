import {
  enrichCachedTimetables, fetchSelectedBuses, missingBusSelections, refreshOdpt, requiredOperators,
  type Cache, type CatalogLine, type FetchResource,
} from "./browser-odpt-normalization";
import { normalizeGtfs, unzipGtfs } from "./browser-gtfs";
import type { SelectedRoute } from "./display-settings";
import { DEFAULT_ODPT_TOKEN, DEFAULT_ODPT_BASE_URL } from "./odpt-defaults";

export type { CatalogLine } from "./browser-odpt-normalization";
export interface BrowserOdptConfig {
  token: string;
  baseUrl?: string;
  operators?: string[];
  /** GTFS Schedule ZIP URLs must permit browser CORS, or be hosted with Pages. */
  gtfsUrls?: string[];
}
export interface BrowserOdptData {
  source: "live" | "cache" | "unavailable";
  fetchedAt: string | null;
  frequencySeconds: number;
  timetables: Cache["timetables"];
  trainInformation: Cache["trainInformation"];
  selectionCount: number;
  stale?: boolean;
  error?: string;
}
type GtfsSnapshot = { lines: Cache["lines"]; timetables: Cache["timetables"]; warnings?: string[] };
type BrowserCache = Cache & { gtfsFeeds?: Record<string, GtfsSnapshot> };
export const ODPT_CONFIG_KEY = "d-tis.odpt.config.v1";
const defaultBase = DEFAULT_ODPT_BASE_URL;
const memory = new Map<string, BrowserCache>();
const requests = new Map<string, Promise<BrowserCache>>();
const freshnessMs = 15 * 60 * 1000;

export function readOdptConfig(): BrowserOdptConfig {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  // One deployment has one data source. Ignore obsolete per-browser settings so
  // Controller and Signage cannot silently use different tokens or feeds.
  return normalizeOdptConfig({ token: env?.VITE_ODPT_API_TOKEN?.trim() || DEFAULT_ODPT_TOKEN,
    baseUrl: env?.VITE_ODPT_API_BASE_URL || defaultBase,
    gtfsUrls: String(env?.VITE_GTFS_URLS || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean) });
}

export function normalizeOdptConfig(config: BrowserOdptConfig): BrowserOdptConfig {
  const baseUrl = checkedUrl(config.baseUrl || defaultBase).href.replace(/\/$/, "");
  return {
    token: typeof config.token === "string" ? config.token.trim() : "", baseUrl,
    operators: [...new Set((Array.isArray(config.operators) ? config.operators : []).filter(value => typeof value === "string").map(value => value.trim().replace(/^odpt\.Operator:/, "")).filter(Boolean))],
    gtfsUrls: [...new Set((Array.isArray(config.gtfsUrls) ? config.gtfsUrls : []).filter(value => typeof value === "string" && value.trim()).map(value => checkedUrl(value.trim()).href))],
  };
}

export function saveOdptConfig(config: BrowserOdptConfig): void {
  globalThis.localStorage.setItem(ODPT_CONFIG_KEY, JSON.stringify(normalizeOdptConfig(config)));
  globalThis.dispatchEvent(new Event("d-tis:odpt-config"));
}

function checkedUrl(value: string): URL {
  const url = new URL(value, typeof location === "undefined" ? "https://localhost/" : location.href);
  if (!(["https:"].includes(url.protocol) || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) || url.username || url.password || url.hash) {
    throw new Error("ODPT・GTFSのURLにはHTTPSの配信先を指定してください。");
  }
  return url;
}

async function keyFor(config: BrowserOdptConfig): Promise<string> {
  // A fingerprint keeps credentials out of IndexedDB keys; normalized data only
  // is stored in the cache. Browser auth/config remain in their own storage.
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(config)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise(resolve => {
    const request = indexedDB.open("d-tis.odpt.v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("cache");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readCache(key: string): Promise<BrowserCache | null> {
  if (memory.has(key)) return memory.get(key)!;
  const db = await database();
  if (!db) return null;
  return new Promise(resolve => {
    const transaction = db.transaction("cache", "readonly");
    const request = transaction.objectStore("cache").get(key);
    request.onsuccess = () => {
      const value = request.result;
      if (value && Array.isArray(value.timetables) && Array.isArray(value.lines) && Array.isArray(value.trainInformation) && typeof value.fetchedAt === "string") {
        const cache = enrichCachedTimetables(value) as BrowserCache;
        memory.set(key, cache); resolve(cache);
      } else resolve(null);
    };
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => { db.close(); resolve(null); };
  });
}

async function writeCache(key: string, cache: BrowserCache): Promise<void> {
  memory.set(key, cache);
  const db = await database();
  if (!db) return;
  await new Promise<void>(resolve => {
    const transaction = db.transaction("cache", "readwrite");
    transaction.objectStore("cache").put(cache, key);
    transaction.oncomplete = transaction.onerror = transaction.onabort = () => { db.close(); resolve(); };
  });
}

function resourceFetcher(config: BrowserOdptConfig): FetchResource {
  return async (type, filters = {}) => {
    const url = checkedUrl(`${config.baseUrl || defaultBase}/${type}`);
    url.searchParams.set("acl:consumerKey", config.token);
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { Accept: "application/ld+json" }, credentials: "omit", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`ODPT ${type}: HTTP ${response.status}`);
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("ODPTから配列形式のデータを取得できませんでした。");
    return rows;
  };
}

async function refresh(config: BrowserOdptConfig, previous: BrowserCache | null, selections: SelectedRoute[]): Promise<BrowserCache> {
  const empty = (): BrowserCache => ({ fetchedAt: new Date().toISOString(), source: "live", frequencySeconds: 900, lines: [], timetables: [], trainInformation: [], warnings: [] });
  let cache = empty();
  let available = false;
  if (config.token) {
    try {
      const old = previous ? { ...previous, lines: previous.lines.filter(line => !line.id.startsWith("gtfs.")), timetables: previous.timetables.filter(table => !table.railway.startsWith("gtfs.")) } : null;
      cache = await refreshOdpt(old, selections.filter(selection => !selection.railway.startsWith("gtfs.")), resourceFetcher(config), [...new Set([...requiredOperators, ...(config.operators ?? [])])]);
      available = cache.lines.length > 0;
    } catch {
      if (previous) cache = { ...previous, lines: previous.lines.filter(line => !line.id.startsWith("gtfs.")), timetables: previous.timetables.filter(table => !table.railway.startsWith("gtfs.")), source: "cache", warnings: ["ODPTに接続できません。保存済みの情報を表示しています。"] };
      else cache.warnings!.push("交通情報に接続できません。時間をおいて再度お試しください。");
      available = cache.lines.length > 0;
    }
  }
  const feeds: Record<string, GtfsSnapshot> = {};
  for (const source of config.gtfsUrls ?? []) {
    try {
      const url = checkedUrl(source);
      if ((url.hostname === "api.odpt.org" || url.hostname.endsWith(".odpt.org")) && config.token && !url.searchParams.has("acl:consumerKey")) url.searchParams.set("acl:consumerKey", config.token);
      const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`GTFS HTTP ${response.status}`);
      if (Number(response.headers.get("Content-Length")) > 50_000_000) throw new Error("GTFSのZIPが50MBを超えています。");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 50_000_000) throw new Error("GTFSのZIPが50MBを超えています。");
      feeds[source] = normalizeGtfs(unzipGtfs(bytes), source);
      available = true;
    } catch {
      const cached = previous?.gtfsFeeds?.[source];
      if (cached) {
        feeds[source] = cached; available = true;
        cache.source = "cache";
        cache.fetchedAt = previous!.fetchedAt;
      }
      cache.warnings = [...(cache.warnings ?? []), cached ? "GTFSの更新に失敗しました。保存済み時刻表を使用します。" : "GTFSを取得できません。ZIP形式・配信先・ブラウザーのCORS許可を確認してください。"];
    }
  }
  for (const feed of Object.values(feeds)) {
    cache.lines.push(...feed.lines); cache.timetables.push(...feed.timetables);
    cache.warnings = [...(cache.warnings ?? []), ...(feed.warnings ?? [])];
  }
  if (!available) throw new Error(config.token || config.gtfsUrls?.length ? cache.warnings?.join(" ") || "交通情報を取得できませんでした。" : "交通情報の配信が設定されていません。サービス管理者にお知らせください。");
  return { ...cache, gtfsFeeds: feeds };
}

async function getCache(config: BrowserOdptConfig, selections: SelectedRoute[], signal?: AbortSignal, force = false): Promise<BrowserCache> {
  signal?.throwIfAborted();
  config = normalizeOdptConfig(config);
  const key = await keyFor(config);
  const previous = await readCache(key);
  const missing = previous ? missingBusSelections(previous, selections) : [];
  let result: BrowserCache;
  if (!force && previous && Date.now() - Date.parse(previous.fetchedAt) < Math.min(freshnessMs, previous.frequencySeconds * 1000)) {
    if (!missing.length) result = { ...previous, source: "cache" };
    else {
      result = { ...await fetchSelectedBuses(previous, missing, resourceFetcher(config)), gtfsFeeds: previous.gtfsFeeds };
      await writeCache(key, result);
    }
  } else {
    let pending = requests.get(key);
    if (!pending) {
      pending = refresh(config, previous, selections).then(async value => { await writeCache(key, value); return value; }).finally(() => requests.delete(key));
      requests.set(key, pending);
    }
    result = await pending;
    // A concurrent catalog request may not have included this caller's bus stop.
    const unloaded = missingBusSelections(result, selections);
    if (unloaded.length && config.token) {
      result = { ...await fetchSelectedBuses(result, unloaded, resourceFetcher(config)), gtfsFeeds: result.gtfsFeeds };
      await writeCache(key, result);
    }
  }
  signal?.throwIfAborted();
  return result;
}

export async function getOdptCatalog(config = readOdptConfig(), signal?: AbortSignal): Promise<{ source: "live" | "cache"; fetchedAt: string; lines: CatalogLine[]; warnings?: string[] }> {
  const cache = await getCache(config, [], signal);
  return {
    source: cache.source, fetchedAt: cache.fetchedAt, warnings: cache.warnings,
    lines: cache.lines.map(line => cache.timetables.some(table => table.railway === line.id && table.departures.some(departure => departure.carCount)) ? { ...line, supportsCarCount: true } : line),
  };
}

/** Each browser fetches ODPT directly; Supabase stores acknowledged settings. */
export async function loadOdptData(facility: { selectedRoutes: SelectedRoute[] }, config = readOdptConfig(), signal?: AbortSignal, force = false): Promise<BrowserOdptData> {
  const selected = facility.selectedRoutes;
  try {
    if (!selected.length) return { source: "cache", fetchedAt: null, frequencySeconds: 900, timetables: [], trainInformation: [], selectionCount: 0 };
    const cache = await getCache(config, selected, signal, force);
    return {
      source: cache.source, fetchedAt: cache.fetchedAt, frequencySeconds: cache.frequencySeconds,
      timetables: cache.timetables.filter(table => selected.some(route => route.railway === table.railway && route.station === table.station && (!route.direction || route.direction === table.direction))),
      trainInformation: cache.trainInformation.filter(info => selected.some(route => route.railway === info.railway)),
      selectionCount: selected.length,
      ...(cache.warnings?.length ? { stale: true, error: cache.warnings.join(" ") } : {}),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { source: "unavailable", fetchedAt: null, frequencySeconds: 900, timetables: [], trainInformation: [], selectionCount: selected.length, error: error instanceof Error ? error.message : "交通情報を取得できませんでした。" };
  }
}

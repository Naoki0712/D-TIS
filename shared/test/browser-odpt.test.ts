import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeGtfs, parseGtfsCsv, unzipGtfs, type GtfsFiles } from "../browser-gtfs";
import { getOdptCatalog, loadOdptData, normalizeOdptConfig } from "../browser-odpt";
import { strToU8, zipSync } from "fflate";

const gtfs = (): GtfsFiles => ({
  "stops.txt": "stop_id,stop_name,stop_code\na,始発,A1\nb,終点,B2\n",
  "routes.txt": "route_id,route_short_name,route_long_name,route_type\nr,10,テストバス,3\n",
  "trips.txt": "route_id,service_id,trip_id,trip_headsign,direction_id\nr,weekday,t,終点,0\n",
  "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt,24:15:00,24:15:00,a,1\nt,24:35:00,24:35:00,b,2\n",
  "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nweekday,1,1,1,1,1,0,0,20261109,20261115\n",
  "calendar_dates.txt": "service_id,date,exception_type\nweekday,20261110,2\nweekday,20261114,1\n",
});

test("GTFS CSV handles quoted commas, escaped quotes, embedded newlines and BOM", () => {
  const rows = parseGtfsCsv('\uFEFFstop_id,stop_name\r\n1,"A, B"\r\n2,"C ""quoted""\nstop"\r\n');
  assert.deepEqual(rows, [{ stop_id: "1", stop_name: "A, B" }, { stop_id: "2", stop_name: 'C "quoted"\nstop' }]);
  assert.throws(() => parseGtfsCsv('stop_id\n"oops'), /引用符/);
});

test("GTFS calendar exceptions and times after midnight survive normalization", () => {
  const normalized = normalizeGtfs(gtfs(), "https://example.test/feed.zip");
  assert.equal(normalized.lines.length, 1);
  assert.equal(normalized.lines[0].mode, "bus");
  assert.equal(normalized.lines[0].stations.length, 1, "a terminal is not a boarding departure");
  const table = normalized.timetables[0];
  assert.deepEqual(table.calendarDates, ["2026-11-09", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]);
  assert.equal(table.departures[0].time, "24:15");
  assert.equal(table.departures[0].destination, "終点");
  assert.equal(table.stationCode, "A1");
  assert.notEqual(normalizeGtfs(gtfs(), "https://other.test/feed.zip").timetables[0].station, table.station);
});

test("GTFS supports date-only feeds without inventing a recurring calendar", () => {
  const files = gtfs();
  delete files["calendar.txt"];
  const table = normalizeGtfs(files, "https://example.test/feed.zip").timetables[0];
  assert.deepEqual(table.calendarDates, ["2026-11-14"]);
});

test("GTFS exact frequency departures expand while nonfixed service stays visibly unsupported", () => {
  const files = gtfs();
  files["frequencies.txt"] = "trip_id,start_time,end_time,headway_secs,exact_times\nt,08:00:00,09:00:00,1200,1\n";
  assert.deepEqual(normalizeGtfs(files, "https://example.test/feed.zip").timetables[0].departures.map(row => row.time), ["08:00", "08:20", "08:40"]);
  files["frequencies.txt"] = "trip_id,start_time,end_time,headway_secs,exact_times\nt,08:00:00,09:00:00,1200,0\n";
  const nonfixed = normalizeGtfs(files, "https://example.test/feed.zip");
  assert.equal(nonfixed.timetables[0].departures.length, 0);
  assert.match(nonfixed.warnings![0], /確定できない/);
});

test("GTFS ZIP reads feed files in folders and ignores unrelated assets", () => {
  const bytes = zipSync({ "feed/stops.txt": strToU8(gtfs()["stops.txt"]), "huge-unrelated.bin": strToU8("unused") });
  assert.deepEqual(unzipGtfs(bytes), { "stops.txt": gtfs()["stops.txt"] });
});

test("browser ODPT config accepts only HTTPS or loopback HTTP", () => {
  assert.equal(normalizeOdptConfig({ token: " token ", baseUrl: "http://localhost:1234/api/" }).token, "token");
  for (const baseUrl of ["http://example.test/api", "javascript:alert(1)", "https://user:pass@example.test/"]) {
    assert.throws(() => normalizeOdptConfig({ token: "", baseUrl }));
  }
});

test("browser GTFS uses direct fetch and provides cache plus unavailable-state diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const files = gtfs(), zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
  let count = 0;
  globalThis.fetch = async () => { count++; return new Response(new Uint8Array(zipped).buffer); };
  try {
    const config = { token: "", gtfsUrls: ["https://adapter-test.test/gtfs.zip"] };
    const catalog = await getOdptCatalog(config);
    assert.equal(catalog.source, "live");
    const line = catalog.lines[0], station = line.stations[0];
    const selection = { railway: line.id, station: station.id, direction: station.directions[0] };
    const data = await loadOdptData({ selectedRoutes: [selection] }, config);
    assert.equal(data.source, "cache");
    assert.equal(data.timetables[0].departures[0].time, "24:15");
    assert.equal(count, 1, "a fresh shared IndexedDB/memory snapshot avoids duplicate upstream requests");
    globalThis.fetch = async () => { throw new TypeError("CORS blocked"); };
    const retained = await loadOdptData({ selectedRoutes: [selection] }, config, undefined, true);
    assert.equal(retained.source, "cache");
    assert.equal(retained.stale, true);
    assert.equal(retained.timetables[0].departures[0].time, "24:15");
    assert.equal(retained.fetchedAt, catalog.fetchedAt, "failed refresh retains the last successful acquisition time");
    const unavailable = await loadOdptData({ selectedRoutes: [selection] }, { token: "", gtfsUrls: ["https://new-failure-test.test/gtfs.zip"] });
    assert.equal(unavailable.source, "unavailable");
    assert.match(unavailable.error!, /CORS/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(loadOdptData({ selectedRoutes: [selection] }, config, aborted.signal), { name: "AbortError" });
  } finally { globalThis.fetch = originalFetch; }
});

test("browser ODPT JSON fetches per railway and resolves actual destination metadata", async () => {
  const originalFetch = globalThis.fetch;
  const railway = "odpt.Railway:MIR.TsukubaExpress", station = "odpt.Station:MIR.TsukubaExpress.Akihabara", terminal = "odpt.Station:MIR.TsukubaExpress.Tsukuba", direction = "odpt.RailDirection:Outbound";
  const stationRows = [
    { "owl:sameAs": station, "odpt:railway": railway, "odpt:stationTitle": { ja: "秋葉原", en: "Akihabara" }, "odpt:stationCode": "TX01" },
    { "owl:sameAs": terminal, "odpt:railway": railway, "odpt:stationTitle": { ja: "つくば", en: "Tsukuba" }, "odpt:stationCode": "TX20" },
  ];
  const requests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    const type = url.pathname.split("/").at(-1), operator = url.searchParams.get("odpt:operator");
    let rows: unknown[] = [];
    if (type === "odpt:Railway" && operator === "odpt.Operator:MIR") rows = [{ "owl:sameAs": railway, "odpt:ascendingRailDirection": direction, "odpt:stationOrder": [{ "odpt:index": 1, "odpt:station": station }, { "odpt:index": 20, "odpt:station": terminal }] }];
    if (type === "odpt:Station" && (!operator || operator === "odpt.Operator:MIR")) rows = stationRows;
    if (type === "odpt:StationTimetable") {
      assert.equal(url.searchParams.get("odpt:railway"), railway);
      rows = [{ "owl:sameAs": "timetable:test", "odpt:railway": railway, "odpt:station": station, "odpt:railDirection": direction, "odpt:calendar": "odpt.Calendar:Weekday", "odpt:stationTimetableObject": [{ "odpt:departureTime": "14:32", "odpt:trainType": "odpt.TrainType:MIR.Rapid", "odpt:destinationStation": [terminal], "odpt:carComposition": 6 }] }];
    }
    return Response.json(rows);
  };
  try {
    const config = { token: "test-key-with+special&characters", baseUrl: "https://json-adapter-test.test/api/v4" };
    const catalog = await getOdptCatalog(config);
    assert.equal(catalog.lines[0].name, "つくばエクスプレス");
    assert.equal(catalog.lines[0].supportsCarCount, true);
    const data = await loadOdptData({ selectedRoutes: [{ railway, station, direction }] }, config);
    assert.equal(data.timetables.length, 1);
    assert.equal(data.timetables[0].directionName, "つくば");
    assert.equal(data.timetables[0].departures[0].type, "快速");
    assert.equal(data.timetables[0].departures[0].carCount, 6);
    assert.deepEqual(data.timetables[0].departures[0].destinationCodes, ["TX20"]);
    assert.ok(requests.every(url => url.searchParams.get("acl:consumerKey") === config.token));
    assert.ok(requests.every(url => !url.pathname.includes("/api/odpt/")), "Pages calls upstream resources directly");
  } finally { globalThis.fetch = originalFetch; }
});

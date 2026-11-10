import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchSelectedBuses, missingBusSelections, normalizeBusCatalog, normalizeBusTimetables, normalizeRailway,
  refreshOdpt, enrichCachedTimetables, type Cache, type FetchResource, type Raw,
} from "../src/odpt.js";
import { cachedDestinationCode, externalStationCode } from "../src/external-station-codes.js";

const rail = "odpt.Railway:MIR.TsukubaExpress";
const akihabara = "odpt.Station:MIR.TsukubaExpress.Akihabara";
const tsukuba = "odpt.Station:MIR.TsukubaExpress.Tsukuba";
const outbound = "odpt.RailDirection:Outbound";
const stations = [
  { "owl:sameAs": akihabara, "odpt:railway": rail, "odpt:stationCode": "TX01", "odpt:stationTitle": { ja: "秋葉原", en: "Akihabara" } },
  { "owl:sameAs": tsukuba, "odpt:railway": rail, "odpt:stationCode": "TX20", "odpt:stationTitle": { ja: "つくば", en: "Tsukuba" } },
];
const railway = {
  "owl:sameAs": rail, "odpt:lineCode": "TX", "odpt:ascendingRailDirection": outbound,
  "odpt:descendingRailDirection": "odpt.RailDirection:Inbound",
  "odpt:stationOrder": [{ "odpt:index": 1, "odpt:station": akihabara }, { "odpt:index": 20, "odpt:station": tsukuba }],
};
const table = (calendar = "Weekday", time = "12:34") => ({
  "owl:sameAs": `odpt.StationTimetable:MIR.TsukubaExpress.Akihabara.Outbound.${calendar}`,
  "odpt:railway": rail, "odpt:station": akihabara, "odpt:railDirection": outbound,
  "odpt:calendar": `odpt.Calendar:${calendar}`,
  "odpt:stationTimetableObject": [{ "odpt:departureTime": time, "odpt:trainType": "odpt.TrainType:MIR.SemiRapid", "odpt:destinationStation": [tsukuba] }],
});
const emptyCache = (): Cache => ({ fetchedAt: "2000-01-01T00:00:00.000Z", source: "cache", frequencySeconds: 86400, timetables: [], lines: [], trainInformation: [] });

test("car counts are exposed only when the source supplies a positive whole number", () => {
  for (const [value, expected] of [[10, 10], ["8", 8], [0, undefined], [-1, undefined], ["unknown", undefined], [undefined, undefined]] as const) {
    const raw = table();
    const result = normalizeRailway([{ ...raw, "odpt:stationTimetableObject": [{ ...raw["odpt:stationTimetableObject"][0], "odpt:carComposition": value }] }], stations, stations);
    assert.equal(result.timetables[0].departures[0].carCount, expected);
  }
});

test("rail normalization preserves split holiday calendars, resolves all operator metadata and excludes Ginza", () => {
  const result = normalizeRailway([
    table(), table("Saturday", "24:15"), table("Holiday", "05:20"),
    { ...table(), "odpt:railway": "odpt.Railway:TokyoMetro.Ginza" },
  ], [...stations, { "owl:sameAs": "odpt.Station:TokyoMetro.Ginza.Shibuya", "odpt:railway": "odpt.Railway:TokyoMetro.Ginza" }], stations, [railway]);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].name, "つくばエクスプレス");
  assert.equal(result.lines[0].lineCode, "TX");
  assert.equal(result.lines[0].stations[0].code, "TX01");
  assert.deepEqual(result.timetables.map((item) => item.calendar), ["Weekday", "Saturday", "Holiday"]);
  const first = result.timetables[0];
  assert.equal(first.directionName, "つくば");
  assert.equal(first.directionEnglish, "Tsukuba");
  assert.equal(first.departures[0].type, "区間快速");
  assert.deepEqual(first.departures[0].destinationCodes, ["TX20"]);
  assert.equal(result.timetables[1].departures[0].time, "24:15");
});

test("a generic direction resolves independently for different railways", () => {
  const otherRail = "odpt.Railway:Yurikamome.Yurikamome", shimbashi = "odpt.Station:Yurikamome.Yurikamome.Shimbashi", toyosu = "odpt.Station:Yurikamome.Yurikamome.Toyosu";
  const otherStations = [
    { "owl:sameAs": shimbashi, "odpt:railway": otherRail, "odpt:stationTitle": { ja: "新橋", en: "Shimbashi" } },
    { "owl:sameAs": toyosu, "odpt:railway": otherRail, "odpt:stationTitle": { ja: "豊洲", en: "Toyosu" } },
  ];
  const result = normalizeRailway([table(), { ...table(), "odpt:railway": otherRail, "odpt:station": shimbashi }], [...stations, ...otherStations], [], [railway, {
    "owl:sameAs": otherRail, "odpt:ascendingRailDirection": outbound,
    "odpt:stationOrder": [{ "odpt:index": 1, "odpt:station": shimbashi }, { "odpt:index": 16, "odpt:station": toyosu }],
  }], [{ "owl:sameAs": outbound, "odpt:railDirectionTitle": { ja: "下り", en: "Outbound" } }]);
  assert.equal(result.timetables[0].directionName, "つくば");
  assert.equal(result.timetables[1].directionName, "豊洲");
});

const bus = "odpt.Busroute:Toei.Shina98";
const pattern = "odpt.BusroutePattern:Toei.Shina98.4102.1";
const stop = "odpt.BusstopPole:Toei.ShinagawaStationKonanguchi.605.1";
const terminal = "odpt.BusstopPole:Toei.OtaShijo.2200.1";
const patterns: Raw[] = [{
  "owl:sameAs": pattern, "odpt:busroute": bus, "dc:title": "品９８ 大田市場行",
  "odpt:busstopPoleOrder": [
    { "odpt:index": 1, "odpt:busstopPole": stop, "odpt:note": "品川駅港南口" },
    { "odpt:index": 2, "odpt:busstopPole": terminal, "odpt:note": "大田市場" },
  ],
}];
const specificCalendar = "odpt.Calendar:Specific.Toei.01-170";
const calendars: Raw[] = [{ "owl:sameAs": specificCalendar, "odpt:day": ["2026-11-02", "2026-11-04"], "odpt:duration": "2026-10-29/2029-10-28" }];
const busTables: Raw[] = [{
  "owl:sameAs": "odpt.BusstopPoleTimetable:Toei.Shina98.ShinagawaStationKonanguchi.605.1.OtaShijo.01-170",
  "odpt:busroute": bus, "odpt:busstopPole": stop, "odpt:calendar": specificCalendar,
  "odpt:busstopPoleTimetableObject": [
    { "odpt:departureTime": "12:00", "odpt:busroutePattern": pattern, "odpt:destinationSign": "大田市場" },
    { "odpt:departureTime": "12:20", "odpt:busroutePattern": pattern, "odpt:destinationSign": "大田市場" },
    { "odpt:departureTime": "invalid", "odpt:busroutePattern": pattern },
  ],
}];

test("bus catalog and timetables retain real patterns, platform names and exact service dates", () => {
  const lines = normalizeBusCatalog(patterns);
  assert.equal(lines[0].id, bus);
  assert.equal(lines[0].name, "都営バス 品９８");
  assert.equal(lines[0].mode, "bus");
  assert.equal(lines[0].stations.length, 1);
  assert.equal(lines[0].stations[0].name, "品川駅港南口（1番のりば）");
  assert.deepEqual(lines[0].stations[0].directions, [pattern]);
  assert.equal(lines[0].stations[0].directionNames?.[pattern], "大田市場");
  const tables = normalizeBusTimetables(busTables, lines, calendars);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].direction, pattern);
  assert.equal(tables[0].mode, "bus");
  assert.equal(tables[0].calendar, specificCalendar);
  assert.deepEqual(tables[0].calendarDates, ["2026-11-02", "2026-11-04"]);
  assert.equal(tables[0].calendarDuration, "2026-10-29/2029-10-28");
  assert.deepEqual(tables[0].departures.map((item) => item.time), ["12:00", "12:20"]);
  assert.deepEqual(tables[0].departures[0].destinationCodes, []);
});

test("selected bus fetching filters both route and pole, deduplicates directions and records loaded selections", async () => {
  const cache = { ...emptyCache(), lines: normalizeBusCatalog(patterns) };
  const selections = [{ railway: bus, station: stop, direction: pattern }, { railway: bus, station: stop, direction: "other-pattern" }];
  const requests: unknown[] = [];
  const fetchResource: FetchResource = async (type, filters) => {
    requests.push([type, filters]);
    assert.equal(type, "odpt:BusstopPoleTimetable");
    assert.deepEqual(filters, { "odpt:operator": "odpt.Operator:Toei", "odpt:busroute": bus, "odpt:busstopPole": stop });
    return busTables;
  };
  const result = await fetchSelectedBuses(cache, selections, fetchResource, calendars);
  assert.equal(requests.length, 1);
  assert.equal(result.timetables.length, 1);
  assert.deepEqual(missingBusSelections(result, selections), []);
  assert.equal(cache.timetables.length, 0);
});

test("failed operator and railway fetches preserve their cached data while another operator refreshes", async () => {
  const previous = emptyCache();
  const old = normalizeRailway([table()], stations, stations, [railway]);
  previous.lines = old.lines;
  previous.timetables = old.timetables;
  const metro = "odpt.Railway:TokyoMetro.Hanzomon", shibuya = "odpt.Station:TokyoMetro.Hanzomon.Shibuya";
  const queriedRailways: string[] = [];
  const fetchResource: FetchResource = async (type, filters = {}) => {
    if (type === "odpt:Railway") {
      if (filters["odpt:operator"] === "odpt.Operator:MIR") throw new Error("MIR unavailable");
      return [{ "owl:sameAs": metro }];
    }
    if (type === "odpt:Station") return [{ "owl:sameAs": shibuya, "odpt:railway": metro, "odpt:stationTitle": { ja: "渋谷" } }];
    if (type === "odpt:StationTimetable") {
      assert.ok(filters["odpt:railway"], "must fetch timetables per railway to avoid the API's 1,000-row cap");
      queriedRailways.push(filters["odpt:railway"]);
      return [{ ...table(), "odpt:railway": metro, "odpt:station": shibuya }];
    }
    return [];
  };
  const result = await refreshOdpt(previous, [], fetchResource, ["TokyoMetro", "MIR"]);
  assert.deepEqual(queriedRailways, [metro]);
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.timetables.find((item) => item.railway === rail), old.timetables[0]);
  assert.ok(result.timetables.some((item) => item.railway === metro));
  assert.ok(result.warnings?.some((warning) => warning.includes("MIR")));
});

test("through-service destinations outside the first 1,000 stations are requested by exact ID", async () => {
  const terminal = "odpt.Station:Other.Line.Terminus";
  const destinationQueries: string[] = [];
  const fetchResource: FetchResource = async (type, filters = {}) => {
    if (type === "odpt:Railway") return [railway];
    if (type === "odpt:Station" && filters["owl:sameAs"]) {
      destinationQueries.push(filters["owl:sameAs"]);
      return [{ "owl:sameAs": terminal, "odpt:stationTitle": { ja: "直通先", en: "Through Terminus" }, "odpt:stationCode": "OT99" }];
    }
    if (type === "odpt:Station") return stations;
    if (type === "odpt:StationTimetable") return [{ ...table(), "odpt:stationTimetableObject": [{ "odpt:departureTime": "12:00", "odpt:destinationStation": [terminal] }] }];
    return [];
  };
  const result = await refreshOdpt(null, [], fetchResource, ["MIR"]);
  assert.deepEqual(destinationQueries, [terminal]);
  assert.equal(result.timetables[0].departures[0].destination, "直通先");
  assert.equal(result.timetables[0].departures[0].destinationEnglish, "Through Terminus");
  assert.deepEqual(result.timetables[0].departures[0].destinationCodes, ["OT99"]);
});

test("numbering resolves qualified through-service stations across all added asset families", () => {
  const expected: Record<string, string> = {
    "JR-East.JobanLocal.Abiko": "JL30", "JR-East.ChuoSobuLocal.Mitaka": "JB01",
    "ToyoRapid.ToyoRapid.ToyoKatsutadai": "TR09", "SaitamaRailway.SaitamaRailway.UrawaMisono": "SR26",
    "Odakyu.Odawara.MukogaokaYuen": "OH19", "Odakyu.Enoshima.Shonandai": "OE09",
    "Odakyu.Tama.Karakida": "OT07", "OdakyuHakone.HakoneTozan.HakoneYumoto": "OH51",
    "Keio.Sagamihara.Hashimoto": "KO45", "Keisei.Oshiage.Aoto": "KS09",
    "Keikyu.Airport.HanedaAirportTerminal1and2": "KK17", "Hokuso.Hokuso.ImbaNihonIdai": "HS14",
  };
  for (const [station, code] of Object.entries(expected)) assert.equal(externalStationCode(`odpt.Station:${station}`), code, station);
  assert.equal(externalStationCode("odpt.Station:Sotetsu.Main.Ebina"), "");
  assert.equal(externalStationCode("odpt.Station:TokyoMetro.Chiyoda.Abiko"), "");
  assert.equal(cachedDestinationCode("odpt.Railway:TokyoMetro.Namboku", "海老名", "Ebina"), "");
  assert.equal(cachedDestinationCode("odpt.Railway:TokyoMetro.Chiyoda", "海老名", "Ebina"), "OH32");
  assert.equal(cachedDestinationCode("odpt.Railway:TokyoMetro.Tozai", "西船橋", "Nishi-Funabashi"), "", "ambiguous interchanges need their actual ODPT identity");
});

test("official station numbering takes priority and Keikyu limited-express aliases have Japanese labels", () => {
  const terminal = "odpt.Station:Keikyu.Kurihama.Misakiguchi";
  const departures = ["RapidLimitedExpress", "AirportRapidLimitedExpress", "CommuterLimitedExpress"].map((type, index) => ({
    "odpt:departureTime": `12:0${index}`, "odpt:trainType": `odpt.TrainType:Keikyu.${type}`, "odpt:destinationStation": [terminal],
  }));
  const raw = { ...table(), "odpt:stationTimetableObject": departures };
  const result = normalizeRailway([raw], stations, [...stations, { "owl:sameAs": terminal, "odpt:stationTitle": { ja: "三崎口" }, "odpt:stationCode": "OFFICIAL99" }]);
  assert.deepEqual(result.timetables[0].departures.map(item => item.type), ["快特", "エアポート快特", "通勤特急"]);
  assert.deepEqual(result.timetables[0].departures[0].destinationCodes, ["OFFICIAL99"]);
  assert.deepEqual(result.timetables[0].departures[0].destinationStations, [terminal]);
  const fallback = normalizeRailway([raw], stations, stations);
  assert.deepEqual(fallback.timetables[0].departures[0].destinationCodes, ["KK72"]);
});

test("old offline caches gain numbering and Japanese train types without mutating cached data", () => {
  const table = normalizeRailway([{
    "odpt:railway": "odpt.Railway:TokyoMetro.Chiyoda", "odpt:station": "odpt.Station:TokyoMetro.Chiyoda.Akasaka",
    "odpt:stationTimetableObject": [{ "odpt:departureTime": "12:00", "odpt:destinationStation": ["odpt.Station:JR-East.JobanLocal.Abiko"] }],
  }], [], []).timetables[0];
  const original = { ...emptyCache(), timetables: [{ ...table, departures: [
    { ...table.departures[0], destination: "我孫子", destinationEnglish: "Abiko", destinationCodes: [], destinationStations: undefined },
    { ...table.departures[0], destination: "羽田空港第１・第２ターミナル", destinationEnglish: "Haneda Airport Terminal 1 and 2", destinationCodes: [], destinationStations: ["odpt.Station:Keikyu.Airport.HanedaAirportTerminal1and2"], type: "AirportRapidLimitedExpress" },
  ] }] };
  const upgraded = enrichCachedTimetables(original);
  assert.deepEqual(upgraded.timetables[0].departures.map(item => item.destinationCodes), [["JL30"], ["KK17"]]);
  assert.equal(upgraded.timetables[0].departures[1].type, "エアポート快特");
  assert.deepEqual(original.timetables[0].departures[0].destinationCodes, []);
  assert.equal(original.timetables[0].departures[1].type, "AirportRapidLimitedExpress");
  const second = enrichCachedTimetables(upgraded);
  assert.deepEqual(second, upgraded, "reloading enriched cache must be idempotent");
});

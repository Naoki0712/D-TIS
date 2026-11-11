import { cachedDestinationCode, externalStationCode } from "./browser-external-station-codes";
import { locationFrom, type GeoPoint } from "./travel-time";

/** ODPT v4 JSON-LD is normalized here so every operator uses the same board. */
export type Raw = Record<string, any>;
export type Selection = { railway: string; station: string; direction: string };
export type Departure = {
  time: string; type: string; typeEnglish: string; destination: string;
  destinationEnglish: string; destinationCodes: string[]; trainNumber: string | null; note: string | null;
  destinationStations?: string[];
  carCount?: number;
};
export type Timetable = {
  id: string; railway: string; station: string; direction: string; calendar: string;
  railwayName: string; railwayEnglish: string; stationName: string; stationEnglish: string;
  stationCode: string; directionName: string; directionEnglish: string;
  generatedAt: string | null; validUntil: string | null; departures: Departure[];
  mode?: "rail" | "bus"; lineCode?: string; calendarDates?: string[]; calendarDuration?: string;
};
export type CatalogStation = {
  id: string; name: string; code?: string; directions: string[]; directionNames?: Record<string, string>;
  location?: GeoPoint;
};
export type CatalogLine = {
  id: string; name: string; englishName?: string; lineCode?: string; mode?: "rail" | "bus";
  directionNames?: Record<string, string>; stations: CatalogStation[]; supportsCarCount?: boolean;
};
export type Cache = {
  fetchedAt: string; source: "live" | "cache"; frequencySeconds: number;
  timetables: Timetable[]; lines: CatalogLine[];
  trainInformation: { railway: string; railwayName: string; text: string; generatedAt: string | null; validUntil: string | null }[];
  warnings?: string[]; busLoadedSelections?: string[];
};
export type FetchResource = (type: string, filters?: Record<string, string>) => Promise<Raw[]>;

export const requiredOperators = ["TokyoMetro", "Toei", "YokohamaMunicipal", "MIR", "Yurikamome"];
const id = (row: Raw) => row["owl:sameAs"] ?? row["@id"] ?? "";
const short = (value?: string): string => value?.split(":").at(-1)?.split(".").at(-1) ?? "";
const list = (value: any): any[] => Array.isArray(value) ? value : value == null ? [] : [value];
const title = (value: any, fallback = ""): string => typeof value === "string" ? value : value?.ja ?? value?.en ?? fallback;
const supported = (railway: string) => typeof railway === "string" && railway.startsWith("odpt.Railway:");
const cleanDirection = (name: string) => name.replace(/方面$/, "");
const englishDirection = (name: string) => name.replace(/^For\s+/i, "");

const railwayDefaults: Record<string, [string, string, string]> = {
  "TokyoMetro.Ginza": ["銀座線", "Tokyo Metro Ginza Line", "G"],
  "TokyoMetro.Chiyoda": ["千代田線", "Tokyo Metro Chiyoda Line", "C"],
  "TokyoMetro.Fukutoshin": ["副都心線", "Tokyo Metro Fukutoshin Line", "F"],
  "TokyoMetro.Hanzomon": ["半蔵門線", "Tokyo Metro Hanzomon Line", "Z"],
  "TokyoMetro.Hibiya": ["日比谷線", "Tokyo Metro Hibiya Line", "H"],
  "TokyoMetro.Marunouchi": ["丸ノ内線", "Tokyo Metro Marunouchi Line", "M"],
  "TokyoMetro.MarunouchiBranch": ["丸ノ内線 方南町支線", "Tokyo Metro Marunouchi Branch Line", "Mb"],
  "TokyoMetro.Namboku": ["南北線", "Tokyo Metro Namboku Line", "N"],
  "TokyoMetro.Tozai": ["東西線", "Tokyo Metro Tozai Line", "T"],
  "TokyoMetro.Yurakucho": ["有楽町線", "Tokyo Metro Yurakucho Line", "Y"],
  "Toei.Asakusa": ["都営浅草線", "Toei Asakusa Line", "A"],
  "Toei.Mita": ["都営三田線", "Toei Mita Line", "I"],
  "Toei.Shinjuku": ["都営新宿線", "Toei Shinjuku Line", "S"],
  "Toei.Oedo": ["都営大江戸線", "Toei Oedo Line", "E"],
  "Toei.Arakawa": ["東京さくらトラム", "Tokyo Sakura Tram", "SA"],
  "Toei.NipporiToneri": ["日暮里・舎人ライナー", "Nippori-Toneri Liner", "NT"],
  "YokohamaMunicipal.Blue": ["横浜市営地下鉄ブルーライン", "Yokohama Municipal Subway Blue Line", "B"],
  "YokohamaMunicipal.Green": ["横浜市営地下鉄グリーンライン", "Yokohama Municipal Subway Green Line", "G"],
  "MIR.TsukubaExpress": ["つくばエクスプレス", "Tsukuba Express", "TX"],
  "Yurikamome.Yurikamome": ["ゆりかもめ", "Yurikamome", "U"],
};
function railwayMetadata(railway: string, raw?: Raw) {
  const defaults = railwayDefaults[railway.split(":").at(-1) ?? ""];
  return {
    name: defaults?.[0] ?? title(raw?.["odpt:railwayTitle"], short(railway)),
    english: defaults?.[1] ?? raw?.["odpt:railwayTitle"]?.en ?? short(railway),
    code: raw?.["odpt:lineCode"] ?? defaults?.[2] ?? "",
  };
}
const trainTypes: Record<string, [string, string]> = {
  Local: ["各駅停車", "Local"], Express: ["急行", "Express"], SemiExpress: ["準急", "Semi Express"],
  Rapid: ["快速", "Rapid"], SemiRapid: ["区間快速", "Semi Rapid"], CommuterRapid: ["通勤快速", "Commuter Rapid"],
  CommuterExpress: ["通勤急行", "Commuter Express"], LimitedExpress: ["特急", "Limited Express"],
  RapidExpress: ["快速急行", "Rapid Express"], AirportLimitedExpress: ["エアポート快特", "Airport Limited Express"],
  AirportRapid: ["エアポート快特", "Airport Rapid"], AccessExpress: ["アクセス特急", "Access Express"],
  CommuterSemiExpress: ["通勤準急", "Commuter Semi Express"],
  RapidLimitedExpress: ["快特", "Rapid Limited Express"],
  AirportRapidLimitedExpress: ["エアポート快特", "Airport Rapid Limited Express"],
  CommuterLimitedExpress: ["通勤特急", "Commuter Limited Express"],
};

/** Upgrade old offline data in memory without rewriting the user's cache. */
export function enrichCachedTimetables(cache: Cache): Cache {
  return { ...cache, timetables: cache.timetables.map(table => ({
    ...table,
    stationCode: table.stationCode || externalStationCode(table.station),
    departures: table.departures.map(departure => {
      const alias = trainTypes[departure.type];
      const codes = departure.destinationCodes?.length ? departure.destinationCodes
        : departure.destinationStations?.length ? departure.destinationStations.map(externalStationCode).filter(Boolean)
        : [cachedDestinationCode(table.railway, departure.destination, departure.destinationEnglish)].filter(Boolean);
      return { ...departure, destinationCodes: codes,
        ...(alias ? { type: alias[0], typeEnglish: alias[1] } : {}),
      };
    }),
  })) };
}

function calendarFields(calendar: string, calendars: Raw[]) {
  const raw = calendars.find((row) => id(row) === calendar);
  return {
    calendar: calendar.includes(":Specific.") ? calendar : short(calendar),
    ...(Array.isArray(raw?.["odpt:day"]) ? { calendarDates: raw["odpt:day"] as string[] } : {}),
    ...(typeof raw?.["odpt:duration"] === "string" ? { calendarDuration: raw["odpt:duration"] as string } : {}),
  };
}

export function normalizeRailway(
  tables: Raw[], stations: Raw[], allStations: Raw[], railways: Raw[] = [], directions: Raw[] = [], calendars: Raw[] = [],
): Pick<Cache, "timetables" | "lines" | "frequencySeconds"> {
  const stationRows = new Map(allStations.map((row) => [id(row), row]));
  for (const row of stations) stationRows.set(id(row), row);
  const shortStations = new Map([...stationRows.values()].map((row) => [short(id(row)), row]));
  const railwayRows = new Map(railways.map((row) => [id(row), row]));
  const directionRows = new Map(directions.map((row) => [id(row), row]));
  const stationName = (sid: string) => title(stationRows.get(sid)?.["odpt:stationTitle"] ?? shortStations.get(short(sid))?.["odpt:stationTitle"], short(sid));
  const stationEnglish = (sid: string) => stationRows.get(sid)?.["odpt:stationTitle"]?.en ?? shortStations.get(short(sid))?.["odpt:stationTitle"]?.en ?? short(sid);
  const stationCode = (sid: string) => stationRows.get(sid)?.["odpt:stationCode"] || externalStationCode(sid);
  const directionTitle = (direction: string, railway: string, english = false) => {
    const raw = directionRows.get(direction)?.["odpt:railDirectionTitle"];
    const compassDirection = ["Inbound", "Outbound", "Northbound", "Southbound", "Eastbound", "Westbound"].includes(short(direction));
    if (raw && !compassDirection) return english ? englishDirection(raw.en ?? short(direction)) : cleanDirection(title(raw, short(direction)));
    const namedStation = shortStations.get(short(direction));
    if (namedStation) return english ? namedStation["odpt:stationTitle"]?.en ?? short(direction) : title(namedStation["odpt:stationTitle"], short(direction));
    const line = railwayRows.get(railway);
    const order: Raw[] = list(line?.["odpt:stationOrder"]).slice().sort((a, b) => Number(a["odpt:index"]) - Number(b["odpt:index"]));
    const ascending = line?.["odpt:ascendingRailDirection"] === direction;
    const descending = line?.["odpt:descendingRailDirection"] === direction;
    const terminal = ascending ? order.at(-1) : descending ? order[0] : undefined;
    if (terminal?.["odpt:station"]) return english ? stationEnglish(terminal["odpt:station"]) : stationName(terminal["odpt:station"]);
    const generic: Record<string, [string, string]> = {
      Inbound: ["上り", "Inbound"], Outbound: ["下り", "Outbound"], Northbound: ["北行", "Northbound"],
      Southbound: ["南行", "Southbound"], Eastbound: ["東行", "Eastbound"], Westbound: ["西行", "Westbound"],
      InnerLoop: ["内回り", "Inner loop"], OuterLoop: ["外回り", "Outer loop"],
    };
    return generic[short(direction)]?.[english ? 1 : 0] ?? short(direction);
  };
  const timetables: Timetable[] = tables.filter((row) => supported(row["odpt:railway"])).map((row) => {
    const railway = row["odpt:railway"] ?? "";
    const station = row["odpt:station"] ?? "";
    const direction = row["odpt:railDirection"] ?? "";
    const metadata = railwayMetadata(railway, railwayRows.get(railway));
    return {
      id: id(row), railway, station, direction, mode: "rail", lineCode: metadata.code,
      ...calendarFields(row["odpt:calendar"] ?? "", calendars),
      railwayName: metadata.name, railwayEnglish: metadata.english,
      stationName: stationName(station), stationEnglish: stationEnglish(station), stationCode: stationCode(station),
      directionName: directionTitle(direction, railway), directionEnglish: directionTitle(direction, railway, true),
      generatedAt: row["dc:date"] ?? null, validUntil: row["dct:valid"] ?? null,
      departures: list(row["odpt:stationTimetableObject"]).filter((x) => /^\d{1,2}:\d{2}$/.test(x["odpt:departureTime"] ?? "")).map((x) => ({
        time: x["odpt:departureTime"], type: (trainTypes[short(x["odpt:trainType"])]?.[0] ?? short(x["odpt:trainType"])) || "各駅停車",
        typeEnglish: (trainTypes[short(x["odpt:trainType"])]?.[1] ?? short(x["odpt:trainType"])) || "Local",
        destination: list(x["odpt:destinationStation"]).map(stationName).join("・"),
        destinationEnglish: list(x["odpt:destinationStation"]).map(stationEnglish).join(" / "),
        destinationCodes: list(x["odpt:destinationStation"]).map(stationCode).filter(Boolean),
        destinationStations: list(x["odpt:destinationStation"]),
        ...(Number.isInteger(Number(x["odpt:carComposition"])) && Number(x["odpt:carComposition"]) > 0
          ? { carCount: Number(x["odpt:carComposition"]) } : {}),
        trainNumber: x["odpt:trainNumber"] ?? null, note: x["odpt:note"] ?? null,
      })),
    };
  });
  const lines = new Map<string, CatalogLine>();
  for (const row of stations) {
    const railway = row["odpt:railway"], sid = id(row);
    if (!railway || !sid || !supported(railway)) continue;
    const metadata = railwayMetadata(railway, railwayRows.get(railway));
    if (!lines.has(railway)) lines.set(railway, { id: railway, name: metadata.name, englishName: metadata.english, lineCode: metadata.code, mode: "rail", directionNames: {}, stations: [] });
    const line = lines.get(railway)!;
    const stationTables = timetables.filter((table) => table.railway === railway && table.station === sid);
    const stationDirections = [...new Set(stationTables.map((table) => table.direction).filter(Boolean))];
    const directionNames = Object.fromEntries(stationDirections.map((direction) => [direction, directionTitle(direction, railway)]));
    Object.assign(line.directionNames!, directionNames);
    line.stations.push({ id: sid, name: stationName(sid), code: stationCode(sid), directions: stationDirections, directionNames,
      location: locationFrom(row["geo:lat"], row["geo:long"]) });
  }
  for (const line of lines.values()) line.stations.sort((a, b) => (a.code ?? "").localeCompare(b.code ?? "", "en", { numeric: true }) || a.name.localeCompare(b.name, "ja"));
  return { timetables, lines: [...lines.values()], frequencySeconds: Math.max(60, Math.min(86400, ...tables.map((row) => Number(row["odpt:frequency"]) || 86400))) };
}

export function normalizeBusCatalog(patterns: Raw[], poles: Raw[] = []): CatalogLine[] {
  const lines = new Map<string, CatalogLine>();
  const poleRows = new Map(poles.map(row => [id(row), row]));
  for (const pattern of patterns) {
    const railway = pattern["odpt:busroute"], direction = id(pattern);
    const order = list(pattern["odpt:busstopPoleOrder"]).slice().sort((a, b) => Number(a["odpt:index"]) - Number(b["odpt:index"]));
    if (!railway || !direction || order.length < 2) continue;
    const routeNumber = title(pattern["dc:title"]).split(/[\s　]/)[0] || short(railway);
    if (!lines.has(railway)) lines.set(railway, { id: railway, name: `都営バス ${routeNumber}`, englishName: `Toei Bus ${short(railway)}`, lineCode: "BUS", mode: "bus", directionNames: {}, stations: [] });
    const line = lines.get(railway)!;
    const terminal = title(order.at(-1)?.["odpt:note"], title(pattern["dc:title"], short(direction))).replace(/行$/, "");
    line.directionNames![direction] = terminal;
    // The last stop has no departure for this pattern.
    for (const stop of order.slice(0, -1)) {
      const sid = stop["odpt:busstopPole"];
      if (!sid) continue;
      let station = line.stations.find((item) => item.id === sid);
      if (!station) {
        const pole = sid.split(".").at(-1);
        const position = poleRows.get(sid) ?? stop;
        station = { id: sid, name: `${title(stop["odpt:note"], short(sid))}${pole ? `（${pole}番のりば）` : ""}`, directions: [], directionNames: {},
          location: locationFrom(position["geo:lat"], position["geo:long"]) };
        line.stations.push(station);
      }
      if (!station.directions.includes(direction)) station.directions.push(direction);
      station.directionNames![direction] = terminal;
    }
  }
  for (const line of lines.values()) line.stations.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return [...lines.values()].sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
}

export function normalizeBusTimetables(tables: Raw[], lines: CatalogLine[], calendars: Raw[]): Timetable[] {
  const result: Timetable[] = [];
  for (const row of tables) {
    const railway = row["odpt:busroute"], station = row["odpt:busstopPole"];
    const line = lines.find((item) => item.id === railway), stop = line?.stations.find((item) => item.id === station);
    if (!line || !stop) continue;
    const groups = new Map<string, Raw[]>();
    for (const departure of list(row["odpt:busstopPoleTimetableObject"])) {
      if (!/^\d{1,2}:\d{2}$/.test(departure["odpt:departureTime"] ?? "")) continue;
      const direction = departure["odpt:busroutePattern"];
      if (!direction) continue;
      if (!groups.has(direction)) groups.set(direction, []);
      groups.get(direction)!.push(departure);
    }
    for (const [direction, departures] of groups) {
      const name = stop.directionNames?.[direction] ?? departures[0]["odpt:destinationSign"] ?? "";
      result.push({
        id: `${id(row)}:${direction}`, railway, station, direction, mode: "bus", lineCode: "BUS",
        ...calendarFields(row["odpt:calendar"] ?? "", calendars),
        railwayName: line.name, railwayEnglish: line.englishName ?? "Toei Bus", stationName: stop.name, stationEnglish: stop.name,
        stationCode: "", directionName: name, directionEnglish: name,
        generatedAt: row["dc:date"] ?? null, validUntil: row["dct:valid"] ?? null,
        departures: departures.map((departure) => ({
          time: departure["odpt:departureTime"], type: line.name.replace(/^都営バス\s*/, ""), typeEnglish: short(railway),
          destination: title(departure["odpt:destinationSign"], name), destinationEnglish: title(departure["odpt:destinationSign"], name),
          destinationCodes: [], trainNumber: null, note: departure["odpt:note"] ?? null,
        })),
      });
    }
  }
  return result;
}

function busKey(selection: Selection) { return `${selection.railway}|${selection.station}`; }
export function missingBusSelections(cache: Cache, selections: Selection[]) {
  return selections.filter((selection) => selection.railway.startsWith("odpt.Busroute:") && !cache.busLoadedSelections?.includes(busKey(selection)));
}
async function settledMap<T, R>(items: T[], work: (item: T) => Promise<R>, concurrency = 6): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await work(items[index]) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}

export async function fetchSelectedBuses(cache: Cache, selections: Selection[], fetchResource: FetchResource, calendars?: Raw[]): Promise<Cache> {
  const unique = new Map(selections.filter((selection) => selection.railway.startsWith("odpt.Busroute:")).map((selection) => [busKey(selection), selection]));
  if (!unique.size) return cache;
  const calendarRows = calendars ?? await fetchResource("odpt:Calendar");
  const items = [...unique.entries()];
  const results = await settledMap(items, async ([key, selection]) => ({
    key, selection, tables: normalizeBusTimetables(await fetchResource("odpt:BusstopPoleTimetable", {
      "odpt:operator": "odpt.Operator:Toei", "odpt:busroute": selection.railway, "odpt:busstopPole": selection.station,
    }), cache.lines, calendarRows),
  }));
  const next = { ...cache, timetables: [...cache.timetables], busLoadedSelections: [...(cache.busLoadedSelections ?? [])], warnings: [...(cache.warnings ?? [])] };
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") { next.warnings.push(`都営バス ${items[i][1].railway}: 取得できませんでした。`); continue; }
    const { key, selection, tables } = result.value;
    next.timetables = next.timetables.filter((table) => !(table.railway === selection.railway && table.station === selection.station)).concat(tables);
    if (!next.busLoadedSelections.includes(key)) next.busLoadedSelections.push(key);
  }
  return next;
}

export async function refreshOdpt(previous: Cache | null, selections: Selection[], fetchResource: FetchResource, operators = requiredOperators): Promise<Cache> {
  const warnings: string[] = [];
  const metadata = await settledMap(operators, async (operator) => {
    const filter = { "odpt:operator": `odpt.Operator:${operator}` };
    const resources = await Promise.allSettled([
      fetchResource("odpt:Railway", filter), fetchResource("odpt:Station", filter), fetchResource("odpt:TrainInformation", filter),
    ]);
    return { operator, resources };
  });
  const railways: Raw[] = [], stations: Raw[] = [], information: Raw[] = [];
  const preservedOperators = new Set<string>();
  const informationOperators = new Set<string>();
  for (const result of metadata) {
    if (result.status !== "fulfilled") continue;
    const { operator, resources } = result.value;
    if (resources[0].status === "fulfilled" && resources[1].status === "fulfilled") {
      railways.push(...resources[0].value.filter((row) => supported(id(row))));
      stations.push(...resources[1].value.filter((row) => supported(row["odpt:railway"])));
    } else { preservedOperators.add(operator); warnings.push(`${operator}: 路線・駅情報を取得できませんでした。`); }
    if (resources[2].status === "fulfilled") { information.push(...resources[2].value); informationOperators.add(operator); }
  }
  const auxiliary = await Promise.allSettled([
    fetchResource("odpt:RailDirection"), fetchResource("odpt:Calendar"), fetchResource("odpt:Station"),
    fetchResource("odpt:BusroutePattern", { "odpt:operator": "odpt.Operator:Toei" }),
    fetchResource("odpt:BusstopPole", { "odpt:operator": "odpt.Operator:Toei" }),
  ]);
  const directions = auxiliary[0].status === "fulfilled" ? auxiliary[0].value : [];
  const calendars = auxiliary[1].status === "fulfilled" ? auxiliary[1].value : [];
  const allStations = auxiliary[2].status === "fulfilled" ? auxiliary[2].value : [];
  const patterns = auxiliary[3].status === "fulfilled" ? auxiliary[3].value : null;
  const poles = auxiliary[4].status === "fulfilled" ? auxiliary[4].value : [];
  const tableResults = await settledMap(railways, async (railway) => ({ railway: id(railway), tables: await fetchResource("odpt:StationTimetable", { "odpt:railway": id(railway) }) }));
  const tables: Raw[] = [], failedRailways = new Set<string>();
  for (let i = 0; i < tableResults.length; i++) {
    const result = tableResults[i];
    if (result.status === "fulfilled") tables.push(...result.value.tables);
    else { failedRailways.add(id(railways[i])); warnings.push(`${railwayMetadata(id(railways[i]), railways[i]).name}: 時刻表を取得できませんでした。`); }
  }
  // Unfiltered Station is capped at 1,000 rows. Resolve every actual through-
  // service destination by its exact ID rather than relying on that first page.
  const knownStations = new Set([...allStations, ...stations].map(id));
  const destinations = [...new Set<string>(tables.flatMap((row) => list(row["odpt:stationTimetableObject"]).flatMap((departure) => list(departure["odpt:destinationStation"]))))].filter((sid) => !knownStations.has(sid));
  const destinationBatches: string[][] = [];
  for (let offset = 0; offset < destinations.length; offset += 40) destinationBatches.push(destinations.slice(offset, offset + 40));
  const destinationResults = await settledMap(destinationBatches, (batch) => fetchResource("odpt:Station", { "owl:sameAs": batch.join(",") }));
  for (const result of destinationResults) {
    if (result.status === "fulfilled") allStations.push(...result.value);
    else warnings.push("直通先の駅情報を取得できませんでした。");
  }
  if (!railways.length && !patterns && !previous) throw new Error("ODPTの路線情報を取得できませんでした。");
  const normalized = normalizeRailway(tables, stations, allStations, railways, directions, calendars);
  const preserve = (railway: string) => failedRailways.has(railway) || preservedOperators.has(railway.split(":").at(-1)?.split(".")[0] ?? "");
  const previousLines = (previous?.lines ?? []).filter((line) => preserve(line.id));
  const busLines = patterns ? normalizeBusCatalog(patterns, poles) : (previous?.lines ?? []).filter((line) => line.mode === "bus" || line.id.startsWith("odpt.Busroute:"));
  if (!patterns) warnings.push("都営バス: 系統情報を取得できませんでした。");
  const cached: Cache = {
    fetchedAt: new Date().toISOString(), source: "live", frequencySeconds: normalized.frequencySeconds,
    lines: [...normalized.lines.filter((line) => !previousLines.some((old) => old.id === line.id)), ...previousLines, ...busLines].sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true })),
    timetables: [...normalized.timetables, ...(previous?.timetables ?? []).filter((table) => preserve(table.railway) || table.mode === "bus" || table.railway.startsWith("odpt.Busroute:"))],
    trainInformation: [
      ...information.filter((row) => supported(row["odpt:railway"])).map((row) => ({ railway: row["odpt:railway"] ?? "", railwayName: railwayMetadata(row["odpt:railway"] ?? "").name, text: title(row["odpt:trainInformationText"]), generatedAt: row["dc:date"] ?? null, validUntil: row["dct:valid"] ?? null })),
      ...(previous?.trainInformation ?? []).filter((row) => !informationOperators.has(row.railway.split(":").at(-1)?.split(".")[0] ?? "")),
    ],
    warnings, busLoadedSelections: [],
  };
  if (auxiliary[1].status === "rejected" && selections.some((selection) => selection.railway.startsWith("odpt.Busroute:"))) {
    cached.warnings!.push("都営バス: 運行日情報を取得できないため、前回の時刻表を使用します。");
    return cached;
  }
  return fetchSelectedBuses(cached, selections, fetchResource, calendars);
}

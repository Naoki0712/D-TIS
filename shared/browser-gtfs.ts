import { strFromU8, unzipSync } from "fflate";
import type { Cache, CatalogLine, Timetable } from "./browser-odpt-normalization";
import { locationFrom } from "./travel-time";

type Row = Record<string, string>;
export type GtfsFiles = Record<string, string>;

/** RFC 4180 quoting, including commas, escaped quotes and newlines in names. */
export function parseGtfsCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ",") { row.push(field); field = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      row.push(field); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else field += char;
  }
  if (quoted) throw new Error("GTFS CSVの引用符が閉じられていません。");
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  const headers = (rows.shift() ?? []).map(value => value.replace(/^\uFEFF/, "").trim());
  return rows.map(values => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])));
}

export function unzipGtfs(bytes: Uint8Array): GtfsFiles {
  const names = new Set(["stops.txt", "routes.txt", "trips.txt", "stop_times.txt", "calendar.txt", "calendar_dates.txt", "frequencies.txt", "agency.txt"]);
  let totalSize = 0;
  const files = unzipSync(bytes, { filter(file) {
    const name = file.name.split("/").at(-1) ?? "";
    if (!names.has(name)) return false;
    totalSize += file.originalSize;
    if (totalSize > 200_000_000) throw new Error("GTFSの展開サイズが200MBを超えています。");
    return true;
  } });
  return Object.fromEntries(Object.entries(files).map(([path, data]) => [path.split("/").at(-1)!, strFromU8(data)]));
}

const dashed = (date: string) => date.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
const hash = (value: string) => {
  let number = 2166136261;
  for (const char of value) number = Math.imul(number ^ char.charCodeAt(0), 16777619);
  return (number >>> 0).toString(36);
};

/** Namespaces stable IDs per feed; two agencies may both use stop_id=1. */
export function normalizeGtfs(files: GtfsFiles, feedUrl: string): Pick<Cache, "lines" | "timetables" | "warnings"> {
  for (const name of ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt"]) {
    if (!files[name]) throw new Error(`GTFSに${name}がありません。`);
  }
  if (!files["calendar.txt"] && !files["calendar_dates.txt"]) throw new Error("GTFSに運行日情報がありません。");
  const parse = (name: string) => parseGtfsCsv(files[name] ?? "");
  const prefix = hash(feedUrl.replace(/([?&])acl:consumerKey=[^&]*/g, "$1"));
  const sid = (id: string) => `gtfs.Stop:${prefix}.${encodeURIComponent(id)}`;
  const rid = (id: string) => `gtfs.Route:${prefix}.${encodeURIComponent(id)}`;
  const stops = new Map(parse("stops.txt").map(row => [row.stop_id, row]));
  const routes = new Map(parse("routes.txt").map(row => [row.route_id, row]));
  const trips = new Map(parse("trips.txt").map(row => [row.trip_id, row]));
  const dates = new Map<string, Set<string>>();
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (const row of parse("calendar.txt")) {
    const start = Date.parse(`${dashed(row.start_date)}T00:00:00Z`), end = Date.parse(`${dashed(row.end_date)}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 3660 * 86400000) throw new Error("GTFSの運行日範囲が不正です。");
    const values = dates.get(row.service_id) ?? new Set<string>();
    for (let day = start; day <= end; day += 86400000) {
      const date = new Date(day);
      if (row[weekdays[date.getUTCDay()]] === "1") values.add(date.toISOString().slice(0, 10));
    }
    dates.set(row.service_id, values);
  }
  for (const row of parse("calendar_dates.txt")) {
    const values = dates.get(row.service_id) ?? new Set<string>();
    if (row.exception_type === "1") values.add(dashed(row.date));
    if (row.exception_type === "2") values.delete(dashed(row.date));
    dates.set(row.service_id, values);
  }
  const stopTimes = new Map<string, Row[]>();
  for (const row of parse("stop_times.txt")) {
    const rows = stopTimes.get(row.trip_id) ?? [];
    rows.push(row); stopTimes.set(row.trip_id, rows);
  }
  const frequencies = new Map<string, Row[]>();
  for (const row of parse("frequencies.txt")) {
    const rows = frequencies.get(row.trip_id) ?? [];
    rows.push(row); frequencies.set(row.trip_id, rows);
  }
  const lines = new Map<string, CatalogLine>(), timetables = new Map<string, Timetable>();
  const warnings = new Set<string>();
  const seconds = (value: string) => /^\d{1,2}:\d{2}:\d{2}$/.test(value) ? value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0) : NaN;
  for (const [tripId, trip] of trips) {
    const route = routes.get(trip.route_id), times = (stopTimes.get(tripId) ?? []).sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
    if (!route || times.length < 2) continue;
    const lastStop = stops.get(times.at(-1)!.stop_id);
    const destination = trip.trip_headsign || lastStop?.stop_name || "終点";
    const direction = `gtfs.Direction:${prefix}.${encodeURIComponent(trip.route_id)}.${encodeURIComponent(trip.direction_id || "0")}.${encodeURIComponent(destination)}`;
    const railway = rid(trip.route_id);
    if (!lines.has(railway)) lines.set(railway, { id: railway, name: route.route_long_name || route.route_short_name || trip.route_id, lineCode: route.route_short_name || "", mode: ["0", "1", "2"].includes(route.route_type) ? "rail" : "bus", stations: [], directionNames: {} });
    const line = lines.get(railway)!;
    line.directionNames![direction] = destination;
    let offsets = [0];
    if (frequencies.has(tripId)) {
      offsets = [];
      for (const frequency of frequencies.get(tripId)!) {
        if (frequency.exact_times !== "1") { warnings.add("GTFSの時刻非固定の頻度運行は、発車時刻を確定できないため表示していません。"); continue; }
        const start = seconds(frequency.start_time), end = seconds(frequency.end_time), interval = Number(frequency.headway_secs), baseline = seconds(times[0].departure_time);
        if (![start, end, interval, baseline].every(Number.isFinite) || interval <= 0 || end - start > 48 * 3600) continue;
        for (let time = start; time < end; time += interval) offsets.push(time - baseline);
      }
    }
    for (const time of times.slice(0, -1)) {
      const stop = stops.get(time.stop_id);
      if (!stop || time.pickup_type === "1") continue;
      const station = sid(time.stop_id);
      let choice = line.stations.find(row => row.id === station);
      if (!choice) { choice = { id: station, name: stop.stop_name || time.stop_id, code: stop.stop_code || "", directions: [], directionNames: {}, location: locationFrom(stop.stop_lat, stop.stop_lon) }; line.stations.push(choice); }
      if (!choice.directions.includes(direction)) choice.directions.push(direction);
      choice.directionNames![direction] = destination;
      const key = `${railway}|${station}|${direction}|${trip.service_id}`;
      if (!timetables.has(key)) timetables.set(key, { id: key, railway, station, direction, mode: line.mode, lineCode: line.lineCode, calendar: `gtfs.Service:${prefix}.${encodeURIComponent(trip.service_id)}`, calendarDates: [...(dates.get(trip.service_id) ?? [])].sort(), railwayName: line.name, railwayEnglish: line.name, stationName: choice.name, stationEnglish: choice.name, stationCode: choice.code ?? "", directionName: destination, directionEnglish: destination, generatedAt: null, validUntil: null, departures: [] });
      const base = seconds(time.departure_time || time.arrival_time);
      if (!Number.isFinite(base)) continue;
      for (const offset of offsets) {
        const departure = base + offset;
        if (departure < 0 || departure >= 100 * 3600) continue;
        const hhmm = `${String(Math.floor(departure / 3600)).padStart(2, "0")}:${String(Math.floor(departure / 60) % 60).padStart(2, "0")}`;
        timetables.get(key)!.departures.push({ time: hhmm, type: line.mode === "rail" ? "各駅停車" : route.route_short_name || "バス", typeEnglish: line.mode === "rail" ? "Local" : "Bus", destination: time.stop_headsign || destination, destinationEnglish: time.stop_headsign || destination, destinationCodes: [], trainNumber: trip.trip_short_name || null, note: null });
      }
    }
  }
  return { lines: [...lines.values()], timetables: [...timetables.values()], warnings: [...warnings] };
}

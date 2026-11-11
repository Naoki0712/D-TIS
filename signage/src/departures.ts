import holidayJp from "@holiday-jp/holiday_jp";
import type { Departure, Facility, Timetable } from "./types";
import { routeDisplaySettings } from "../../shared/display-settings";

type SelectedRoute = Facility["selectedRoutes"][number];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Use Japan time even when a Controller preview is opened in another timezone. */
export function japanTime(instant: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return new Date(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
}

export function serviceDate(now: Date): Date {
  const date = new Date(now);
  if (date.getHours() < 3) date.setDate(date.getDate() - 1);
  date.setHours(12, 0, 0, 0);
  return date;
}

const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function calendarRank(table: Timetable, now: Date): number {
  const date = serviceDate(now);
  const key = dateKey(date);
  if (table.calendarDates?.length) return table.calendarDates.includes(key) ? 4 : 0;
  if (table.calendarDuration) {
    const [start, end] = table.calendarDuration.split("/");
    if ((start && key < start.slice(0, 10)) || (end && key > end.slice(0, 10))) return 0;
  }
  const calendar = table.calendar.split(":").at(-1)?.split(".").at(-1) ?? "";
  const day = date.getDay();
  const holiday = holidayJp.isHoliday(date);
  if (calendar === "Everyday" || calendar === "Daily") return 1;
  if (calendar === "SaturdayHoliday") return day === 0 || day === 6 || holiday ? 2 : 0;
  if (calendar === "Holiday") return day === 0 || holiday ? 3 : 0;
  if (calendar === "Weekday") return day > 0 && day < 6 && !holiday ? 2 : 0;
  return calendar === weekdays[day] && (day === 0 || !holiday) ? 3 : 0;
}

export function timetableFor(selected: SelectedRoute, tables: Timetable[], now: Date): Timetable | undefined {
  const matches = tables.filter(table => table.railway === selected.railway
    && table.station === selected.station && (!selected.direction || table.direction === selected.direction));
  const rank = Math.max(0, ...matches.map(table => calendarRank(table, now)));
  if (!rank) return undefined;
  const active = matches.filter(table => calendarRank(table, now) === rank);
  return { ...active[0], departures: active.flatMap(table => table.departures) };
}

/** Keep each selected direction on screen, including directions without a timetable. */
export function displayPages(selected: SelectedRoute[], mode: Facility["directionDisplayMode"]): SelectedRoute[][] {
  const groups = new Map<string, SelectedRoute[]>();
  for (const route of selected) {
    const key = `${route.railway}|${route.station}`;
    groups.set(key, [...(groups.get(key) ?? []), route]);
  }
  return [...groups.values()].flatMap(routes => {
    if (routeDisplaySettings(routes[0], mode).directionDisplayMode !== "combined") return routes.map(route => [route]);
    const pages: SelectedRoute[][] = [];
    for (let index = 0; index < routes.length; index += 2) pages.push(routes.slice(index, index + 2));
    return pages;
  });
}

export function nextDepartures(table: Timetable | undefined, now: Date, leadMinutes = 0): Departure[] {
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Add the travel threshold without changing the service date/calendar above.
  const current = (minutes < 180 ? minutes + 1440 : minutes) + now.getSeconds() / 60
    + (Number.isFinite(leadMinutes) ? Math.max(0, leadMinutes) : 0);
  const unique = new Set<string>();
  return (table?.departures ?? []).flatMap(departure => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(departure.time);
    if (!match || Number(match[2]) > 59) return [];
    let absoluteMinutes = Number(match[1]) * 60 + Number(match[2]);
    if (absoluteMinutes < 180) absoluteMinutes += 1440;
    const key = `${departure.time}|${departure.trainNumber}|${departure.destination}|${departure.type}`;
    if (absoluteMinutes < current || unique.has(key)) return [];
    unique.add(key);
    return [{ departure, absoluteMinutes }];
  }).sort((a, b) => a.absoluteMinutes - b.absoluteMinutes).slice(0, 2).map(item => item.departure);
}

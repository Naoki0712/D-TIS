import test from "node:test";
import assert from "node:assert/strict";
import { calendarRank, displayPages, japanTime, nextDepartures, timetableFor } from "../src/departures";
import type { Departure, Timetable } from "../src/types";

const selected = { railway: "odpt.Railway:TokyoMetro.Hanzomon", station: "Sumiyoshi", direction: "Shibuya" };
const table = (calendar: string, times: string[] = []): Timetable => ({
  ...selected, calendar, railwayName: "半蔵門線", railwayEnglish: "Hanzomon Line", stationName: "住吉",
  stationEnglish: "Sumiyoshi", stationCode: "Z12", directionName: "渋谷", directionEnglish: "Shibuya",
  generatedAt: null, validUntil: null,
  departures: times.map(time => ({ time, type: "各駅停車", typeEnglish: "Local", destination: "渋谷",
    destinationEnglish: "Shibuya", destinationCodes: ["Z01"], trainNumber: null, note: null } satisfies Departure)),
});

test("both directions stay together and different stations rotate independently", () => {
  const opposite = { ...selected, direction: "Oshiage" };
  const other = { ...selected, station: "Shibuya" };
  assert.deepEqual(displayPages([selected, other, opposite], "combined"), [[selected, opposite], [other]]);
  assert.deepEqual(displayPages([selected, opposite], "separate"), [[selected], [opposite]]);
  assert.deepEqual(displayPages([selected, opposite], undefined), [[selected], [opposite]]);
});

test("Japanese holiday on a weekday uses the holiday timetable", () => {
  const now = new Date(2026, 10, 3, 12, 0);
  const weekday = table("Weekday", ["12:10"]);
  const holiday = table("SaturdayHoliday", ["12:20"]);
  assert.equal(calendarRank(weekday, now), 0);
  assert.equal(timetableFor(selected, [weekday, holiday], now)?.departures[0].time, "12:20");
});

test("Saturday and Sunday-specific schedules take priority over a combined schedule", () => {
  const saturday = new Date(2026, 10, 7, 12, 0);
  assert.equal(timetableFor(selected, [table("SaturdayHoliday", ["12:10"]), table("Saturday", ["12:20"])], saturday)?.departures[0].time, "12:20");
  const sunday = new Date(2026, 10, 8, 12, 0);
  assert.equal(calendarRank(table("Holiday"), sunday), 3);
});

test("bus special calendars apply only on listed dates", () => {
  const special = { ...table("odpt.Calendar:Toei.Specific.123", ["12:05"]), calendarDates: ["2026-11-04"] };
  assert.equal(calendarRank(special, new Date(2026, 10, 3, 12)), 0);
  assert.equal(calendarRank(special, new Date(2026, 10, 4, 12)), 4);
});

test("after midnight keeps the preceding service day's timetable and excludes departed trains", () => {
  const now = new Date(2026, 10, 7, 0, 10);
  const selectedTable = timetableFor(selected, [table("Weekday", ["23:55", "00:05", "00:10", "00:20", "05:00"])], now);
  assert.ok(selectedTable);
  assert.deepEqual(nextDepartures(selectedTable, now).map(departure => departure.time), ["00:10", "00:20"]);
  assert.deepEqual(nextDepartures(table("Weekday", ["24:20", "25:00"]), now).map(departure => departure.time), ["24:20", "25:00"]);
});

test("expired departures disappear, duplicates are removed, and absent schedules stay empty", () => {
  const now = new Date(2026, 10, 4, 12, 0);
  assert.deepEqual(nextDepartures(table("Weekday", ["11:59", "12:05", "12:05", "12:10", "12:20"]), now).map(departure => departure.time), ["12:05", "12:10"]);
  assert.deepEqual(nextDepartures(undefined, now), []);
  assert.equal(timetableFor(selected, [table("Holiday")], now), undefined);
});

test("Japan time is independent of the browser's timezone", () => {
  const date = japanTime(new Date("2026-11-03T23:30:00Z"));
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 10);
  assert.equal(date.getDate(), 4);
  assert.equal(date.getHours(), 8);
  assert.equal(date.getMinutes(), 30);
});

import test from "node:test";
import assert from "node:assert/strict";
import { nextDepartures } from "../src/departures";
import type { Timetable } from "../src/types";
test("travel cutoff does not wrap at midnight or change the selected service date", () => {
  const table = { departures: ["23:59", "24:05", "24:20"].map(time => ({ time, type: "普通", typeEnglish: "Local", destination: "終点", destinationEnglish: "End", destinationCodes: [], trainNumber: null, note: null })) } as unknown as Timetable;
  assert.deepEqual(nextDepartures(table, new Date(2026, 10, 11, 23, 55), 12).map(d => d.time), ["24:20"]);
  assert.deepEqual(nextDepartures(table, new Date(2026, 10, 12, 0, 1), 6).map(d => d.time), ["24:20"]);
});

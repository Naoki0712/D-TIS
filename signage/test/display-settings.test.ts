import test from "node:test";
import assert from "node:assert/strict";
import { selectOutput, effectiveDisplaySettings, withOutputSettings, routeDisplaySettings, type FacilitySettings } from "../../shared/display-settings";
import { displayPages } from "../src/departures";
import { stationChoices, matchingLines } from "../../controller/src/catalog";

const route = { railway: "Metro.A", station: "Metro.A.One", direction: "Out" };
const facility: FacilitySettings = { facilityName: "共通", selectedRoutes: [route], directionDisplayMode: "combined", tickerText: "共通文面", updatedAt: "",
  devices: [{ id: "led", code: "LED", name: "LED", type: "led", enabled: true }, { id: "lcd", code: "LCD", name: "LCD", type: "lcd", enabled: true }] };

test("legacy settings are inherited and the default kiosk selects LCD before LED", () => {
  assert.equal(selectOutput(facility)?.id, "lcd");
  assert.equal(selectOutput(facility, "led")?.id, "led");
  assert.equal(selectOutput(facility, "unknown"), undefined);
  assert.equal(effectiveDisplaySettings(facility, "led").tickerText, "共通文面");
});

test("editing primary output snapshots inherited settings so other equipment is independent", () => {
  const edited = withOutputSettings(facility, "lcd", { ...effectiveDisplaySettings(facility), facilityName: "LCD専用", tickerText: "LCD文面" });
  assert.equal(edited.facilityName, "LCD専用");
  assert.equal(effectiveDisplaySettings(edited, "lcd").tickerText, "LCD文面");
  assert.equal(effectiveDisplaySettings(edited, "led").tickerText, "共通文面");
  assert.equal(facility.devices[0].settings, undefined);
  const second = withOutputSettings(edited, "led", { ...effectiveDisplaySettings(edited, "led"), tickerText: "LED文面" });
  assert.equal(effectiveDisplaySettings(second, "lcd").tickerText, "LCD文面");
  assert.equal(effectiveDisplaySettings(second, "led").tickerText, "LED文面");
});

test("per-route mode overrides old global mode and visibility defaults preserve existing displays", () => {
  const routes = [route, { ...route, direction: "In" }, { ...route, railway: "B", station: "B.One", direction: "Out", display: { directionDisplayMode: "separate" as const } }, { ...route, railway: "B", station: "B.One", direction: "In", display: { directionDisplayMode: "separate" as const } }];
  assert.deepEqual(displayPages(routes, "combined").map(page => page.length), [2, 1, 1]);
  assert.equal(routeDisplaySettings(route).showLineName, true);
  assert.equal(routeDisplaySettings({ ...route, display: { showTrainType: false, showDirection: false, showCarCount: true } }).showTrainType, false);
});

test("station-first lookup groups interchanges but keeps each railway's real station identity", () => {
  const lines = [{ id: "A", name: "半蔵門線", lineCode: "Z", stations: [{ id: "A.Sumiyoshi", name: "住吉", code: "Z12", directions: ["Out"] }] },
    { id: "B", name: "新宿線", stations: [{ id: "B.Sumiyoshi", name: "住吉", directions: ["West"] }] }];
  const choices = stationChoices(lines, "住吉");
  assert.equal(choices.length, 1);
  assert.equal(choices[0].matches.length, 2);
  assert.equal(matchingLines(choices[0], "新宿")[0].station.id, "B.Sumiyoshi");
  assert.equal(stationChoices(lines, "z12")[0].name, "住吉");
});

import test from "node:test";
import assert from "node:assert/strict";
import { stationChoices } from "../../controller/src/catalog";
import { fitStationMap, locatedStationChoices, projectLocation, unprojectLocation } from "../../controller/src/route-map";

const station = { id: "A.Asakusa", name: "浅草", directions: ["Out"], location: { latitude: 35.7118, longitude: 139.7984 } };
const line = { id: "A", name: "銀座線", stations: [station] };

test("duplicate catalog responses do not create duplicate station and railway choices", () => {
  const choices = stationChoices([line, line, { ...line, id: "B", name: "浅草線", stations: [{ ...station, id: "B.Asakusa" }] }]);
  assert.equal(choices.length, 1);
  assert.deepEqual(choices[0].matches.map(match => match.station.id), ["A.Asakusa", "B.Asakusa"]);
});

test("map ignores unusable positions and can use an interchange's second railway coordinates", () => {
  const choices = stationChoices([{ ...line, stations: [{ ...station, location: undefined }, { id: "A.Missing", name: "位置なし", directions: [] },
    { ...station, id: "A.Invalid", name: "不正な座標", location: { latitude: 91, longitude: 139 } }] },
    { ...line, id: "B", stations: [{ ...station, id: "B.Asakusa" }] }]);
  const located = locatedStationChoices(choices);
  assert.equal(choices.length, 3);
  assert.equal(located.length, 1);
  assert.equal(located[0].name, "浅草");
  assert.equal(located[0].matches[0].station.id, "A.Asakusa");
  assert.deepEqual(located[0].location, station.location);
});

test("map projection preserves Tokyo coordinates and fits all stations inside a phone viewport", () => {
  const locations = [station.location, { latitude: 35.658, longitude: 139.7016 }, { latitude: 35.8617, longitude: 139.6455 }];
  for (const location of locations) {
    const restored = unprojectLocation(projectLocation(location, 13), 13);
    assert.ok(Math.abs(restored.latitude - location.latitude) < 0.000001);
    assert.ok(Math.abs(restored.longitude - location.longitude) < 0.000001);
  }
  const stations = locations.map((location, index) => ({ name: `${index}`, matches: [], location }));
  const view = fitStationMap(stations, 320, 280), center = projectLocation(view.center, view.zoom);
  for (const station of stations) {
    const position = projectLocation(station.location, view.zoom);
    assert.ok(Math.abs(position.x - center.x) <= 112);
    assert.ok(Math.abs(position.y - center.y) <= 92);
  }
});

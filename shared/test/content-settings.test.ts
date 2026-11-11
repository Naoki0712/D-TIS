import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCloudFacility } from "../cloud-protocol";
import { effectiveDisplaySettings, withOutputSettings, type FacilitySettings } from "../display-settings";
import { contentSettings, assetUrl } from "../content-settings";
import { estimateTravelMinutes, distanceKilometres, locationFrom } from "../travel-time";



test("new content survives validation and is scoped to its own Signage output", () => {
  const facility: FacilitySettings = { facilityName: "A", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "案内", updatedAt: "", devices: [{ id: "one", code: "LCD", name: "一", type: "lcd", enabled: true }, { id: "two", code: "LCD", name: "二", type: "lcd", enabled: true }] };
  const edited = withOutputSettings(facility, "one", { ...effectiveDisplaySettings(facility), appearance: { preset: "mincho" }, transition: "split-flap", travel: { mode: "manual", minutes: 5 }, media: [{ id: "image", kind: "image", url: "https://example.test/photo.png", alt: "写真", durationSeconds: 15 }], ticker: { speed: 80, segments: [{ id: "text", text: "案内", font: "mincho", weight: 700, pauseSeconds: 3, color: "#ff3300", blink: true }] } });
  const normalized = normalizeCloudFacility(edited);
  assert.equal(effectiveDisplaySettings(normalized, "one").ticker?.segments[0].weight, 400);
  assert.equal(effectiveDisplaySettings(normalized, "one").media?.length, 1);
  assert.equal(effectiveDisplaySettings(normalized, "two").media, undefined);
  assert.equal(effectiveDisplaySettings(normalized, "two").appearance, undefined);
});
test("untrusted content cannot inject CSS, scripts, paths, or oversized fields", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "http://example.test/a", "https://user:password@example.test/a", "storage://dtis-media/../private/a"]) assert.equal(assetUrl(url), false);
  assert.throws(() => contentSettings({ ticker: { speed: 70, segments: [{ id: "a", text: "x", color: "red;position:fixed" }] } }));
  assert.throws(() => contentSettings({ travel: { mode: "gps", minutes: 0, latitude: 91, longitude: 139 } }));
  assert.throws(() => contentSettings({ media: Array.from({ length: 21 }, () => ({})) }));
  assert.throws(() => contentSettings({ appearance: { preset: "custom" } }));
});
test("walking estimates use valid coordinates, manual fallback, and additional boarding time", () => {
  assert.equal(locationFrom(null, 139), undefined);
  const origin = { latitude: 35, longitude: 139 }, dest = { latitude: 35.01, longitude: 139 };
  assert.ok(distanceKilometres(origin, dest) > 1.1 && distanceKilometres(origin, dest) < 1.12);
  const estimate = estimateTravelMinutes({ mode: "gps", minutes: 2, bufferMinutes: 3, ...origin, walkingSpeedKmh: 4.8 }, dest);
  assert.equal(estimate.minutes, 24); assert.equal(estimate.estimated, true);
  assert.deepEqual(estimateTravelMinutes({ mode: "gps", minutes: 7 }), { minutes: 7, estimated: false, missingLocation: true });
  assert.equal(estimateTravelMinutes({ mode: "off", minutes: 7 }).minutes, 0);
});

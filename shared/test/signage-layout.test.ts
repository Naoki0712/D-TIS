import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCloudFacility } from "../cloud-protocol";
import { effectiveDisplaySettings, withOutputSettings, type FacilitySettings } from "../display-settings";
import { defaultTextStyle, fitPart, parseLayout } from "../signage-layout";
import { parseServiceStatus, delayedTime } from "../service-status";

const facility: FacilitySettings = { facilityName: "", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "", updatedAt: "",
  devices: [{ id: "a", code: "LCD-1", name: "入口", type: "lcd", enabled: true }, { id: "b", code: "LCD-2", name: "受付", type: "lcd", enabled: true }] };

test("layout, individual board text, service status and separate animations survive a cloud round trip for one output", () => {
  const settings = { ...effectiveDisplaySettings(facility), selectedRoutes: [{ railway: "rail", station: "station", direction: "out", service: { status: "delayed" as const, delayMinutes: 12, message: "12分遅れ" } }],
    transition: "zoom" as const, departureAnimation: "slide" as const, layout: { parts: [{ id: "board", kind: "departures" as const, x: 2, y: 4, width: 96, height: 80,
      fieldText: { lineName: "東京メトロ半蔵門線" }, fieldStyles: { lineName: { ...defaultTextStyle, blink: true, color: "#ff3300" } } },
      { id: "text", kind: "text" as const, x: 2, y: 88, width: 80, height: 12, text: "足元にご注意ください", style: { ...defaultTextStyle, font: "mincho" as const, weight: 700 as const } }] } };
  const parsed = normalizeCloudFacility(withOutputSettings(facility, "a", settings));
  const result = effectiveDisplaySettings(parsed, "a");
  assert.equal(result.departureAnimation, "slide"); assert.equal(result.transition, "zoom");
  assert.deepEqual(result.selectedRoutes[0].service, settings.selectedRoutes[0].service);
  assert.equal(result.layout?.parts[0].fieldStyles?.lineName?.blink, true);
  assert.equal(result.layout?.parts[1].style?.weight, 400);
  assert.equal(effectiveDisplaySettings(parsed, "b").layout, undefined);
  assert.equal(effectiveDisplaySettings(parsed, "b").selectedRoutes.length, 0);
});
test("invalid persisted parts cannot escape the canvas or inject unvalidated text styles", () => {
  const part = { id: "a", kind: "text", x: 0, y: 0, width: 40, height: 20, text: "案内" };
  for (const patch of [{ x: -1 }, { x: 80 }, { width: 0 }, { height: NaN }, { kind: "__proto__" }, { style: { ...defaultTextStyle, color: "red;background:url(x)" } }, { fieldStyles: { lineName: { ...defaultTextStyle, fontSize: 500 } } }, { fieldText: { unsafe: "x" } }]) {
    assert.throws(() => parseLayout({ parts: [{ ...part, ...patch }] }));
  }
  assert.throws(() => parseLayout({ parts: [part, part] }));
  assert.throws(() => parseLayout({ parts: Array.from({ length: 51 }, (_, i) => ({ ...part, id: String(i) })) }));
  assert.deepEqual(fitPart({ ...part, kind: "text", x: 95, y: -2, width: 30, height: 20 }), { ...part, x: 70, y: 0, width: 30, height: 20 });
});
test("service overrides reject invalid delay minutes and adjusted times cross midnight", () => {
  assert.equal(delayedTime("23:58", 7), "00:05"); assert.equal(delayedTime("24:10", 5), "00:15");
  for (const delayMinutes of [-1, 0, .5, 361, NaN]) assert.throws(() => parseServiceStatus({ status: "delayed", delayMinutes, message: "" }));
  assert.equal(parseServiceStatus({ status: "suspended", delayMinutes: 0, message: "運転再開未定" }).status, "suspended");
});

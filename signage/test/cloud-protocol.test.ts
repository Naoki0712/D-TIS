import test from "node:test";
import assert from "node:assert/strict";
import { newCommand, normalizeCloudFacility, parseCommand, COMMAND_LIFETIME_MS } from "../../shared/cloud-protocol";

const settings = { facilityName: "D-TIS", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "", updatedAt: "",
  devices: [{ id: "primary", code: "LCD-01", name: "メイン画面", type: "lcd", enabled: true }] };

test("commands accept valid transitions and reject stale, future, and invalid revisions", () => {
  const command = newCommand("display", { enabled: false }, 3);
  const issued = Date.parse(command.issuedAt);
  assert.deepEqual(parseCommand(command, issued), command);
  assert.equal(parseCommand(command, issued + COMMAND_LIFETIME_MS + 1), null);
  assert.equal(parseCommand(command, issued - 5001), null);
  for (const baseRevision of [-1, 0.1, "3", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseCommand({ ...command, baseRevision }, issued), null);
  }
  assert.equal(parseCommand({ ...command, issuedAt: "bad-date" }, issued), null);
  assert.equal(parseCommand({ ...command, id: "not-an-id" }, issued), null);
  assert.equal(parseCommand({ ...command, action: "reboot" }, issued), null);
});

test("settings are validated before a signage render and unknown fields are discarded", () => {
  const normalized = normalizeCloudFacility({ ...settings, apiToken: "never-persist-credentials" });
  assert.deepEqual(normalized, settings);
  assert.equal("apiToken" in normalized, false);
  assert.throws(() => normalizeCloudFacility({ ...settings, devices: [settings.devices[0], settings.devices[0]] }), /重複/);
  assert.throws(() => normalizeCloudFacility({ ...settings, tickerText: "x".repeat(2001) }));
  assert.throws(() => normalizeCloudFacility({ ...settings, selectedRoutes: [{ railway: "A", station: "", direction: "B" }] }));
  assert.throws(() => normalizeCloudFacility({ ...settings, devices: [{ ...settings.devices[0], enabled: "true" }] }));
  const command = newCommand("settings", settings, 0);
  assert.ok(parseCommand(command));
  assert.equal(parseCommand({ ...command, payload: { ...settings, devices: null } }), null);
  assert.equal(parseCommand(newCommand("display", { enabled: "false" }, 0)), null);
});

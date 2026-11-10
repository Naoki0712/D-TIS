import test from "node:test";
import assert from "node:assert/strict";
import { mergeDeviceList, mergeDeviceSnapshot } from "../cloud-view-state";
import type { DeviceRecord } from "../cloud";

const record: DeviceRecord = { id: crypto.randomUUID(), owner_id: crypto.randomUUID(), name: "Signage", display_enabled: true,
  revision: 3, refresh_version: 0, last_seen_at: "2026-11-10T10:00:10Z", updated_at: "2026-11-10T10:00:00Z",
  settings: { facilityName: "最新の表示", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "", devices: [], updatedAt: "" } };

test("a poll that began before an applied command cannot rewind the Controller's confirmed state", () => {
  const stale = { ...record, revision: 2, settings: { ...record.settings, facilityName: "古い表示" } };
  assert.equal(mergeDeviceSnapshot(record, stale), record);
  assert.equal(mergeDeviceList([record], [stale])[0].settings.facilityName, "最新の表示");
  const next = { ...record, revision: 4 };
  assert.equal(mergeDeviceSnapshot(record, next), next);
});

test("out-of-order heartbeat responses preserve the newest last-seen time", () => {
  const staleHeartbeat = { ...record, last_seen_at: "2026-11-10T10:00:01Z" };
  assert.equal(mergeDeviceSnapshot(record, staleHeartbeat).last_seen_at, record.last_seen_at);
  assert.equal(mergeDeviceSnapshot(record, { ...record, last_seen_at: null }).last_seen_at, record.last_seen_at);
});

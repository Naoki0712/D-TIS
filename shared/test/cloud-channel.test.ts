import test from "node:test";
import assert from "node:assert/strict";
import { newCommand, sendCommand, type CloudMessage, type DeviceChannel, type DeviceRecord } from "../cloud";

function fakeChannel() {
  const listeners = new Set<(message: CloudMessage) => void>();
  const channel: DeviceChannel = {
    async send() { /* A transport receipt is not a successful render. */ },
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async close() { listeners.clear(); },
  };
  return { channel, listeners, emit: (message: CloudMessage) => { for (const listener of listeners) listener(message); } };
}
const device: DeviceRecord = {
  id: crypto.randomUUID(), owner_id: crypto.randomUUID(), name: "Signage", revision: 1,
  display_enabled: false, refresh_version: 0, last_seen_at: null, updated_at: "",
  settings: { facilityName: "D-TIS", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "", devices: [], updatedAt: "" },
};

test("a transport receipt never completes a command before the Signage commit receipt", async () => {
  const fake = fakeChannel();
  const command = newCommand("display", { enabled: false }, 0);
  let completed = false;
  const result = sendCommand(fake.channel, command).then(value => { completed = true; return value; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(completed, false);
  fake.emit({ type: "ack", commandId: crypto.randomUUID(), device });
  await Promise.resolve();
  assert.equal(completed, false);
  fake.emit({ type: "ack", commandId: command.id, device });
  assert.deepEqual(await result, device);
  assert.equal(fake.listeners.size, 0);
});

test("command rejection, malformed receipt, and missing receipt reject and clean up listeners", async () => {
  const rejected = fakeChannel();
  const command = newCommand("refresh", {}, 0);
  const result = sendCommand(rejected.channel, command);
  rejected.emit({ type: "reject", commandId: command.id, error: "revision_conflict" });
  await assert.rejects(result, /revision_conflict/);
  assert.equal(rejected.listeners.size, 0);
  const malformed = fakeChannel();
  const invalidResult = sendCommand(malformed.channel, command);
  malformed.emit({ type: "ack", commandId: command.id, device: {} });
  await assert.rejects(invalidResult, /形式/);
  assert.equal(malformed.listeners.size, 0);
  const missing = fakeChannel();
  await assert.rejects(sendCommand(missing.channel, command, 5), /完了通知がありません/);
  assert.equal(missing.listeners.size, 0);
});

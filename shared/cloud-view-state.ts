import type { DeviceRecord } from "./cloud";

/** Network responses can arrive out of order; a confirmed revision never goes backwards. */
export function mergeDeviceSnapshot(previous: DeviceRecord | undefined, incoming: DeviceRecord): DeviceRecord {
  if (!previous || incoming.revision > previous.revision) return incoming;
  if (incoming.revision < previous.revision) return previous;
  return (Date.parse(previous.last_seen_at ?? "") || 0) > (Date.parse(incoming.last_seen_at ?? "") || 0)
    ? { ...incoming, last_seen_at: previous.last_seen_at } : incoming;
}

export function mergeDeviceList(previous: DeviceRecord[], incoming: DeviceRecord[]): DeviceRecord[] {
  const byId = new Map(previous.map(device => [device.id, device]));
  return incoming.map(device => mergeDeviceSnapshot(byId.get(device.id), device));
}

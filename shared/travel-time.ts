import type { TravelSettings } from "./display-settings";

export type GeoPoint = { latitude: number; longitude: number };

export function locationFrom(latitude: unknown, longitude: unknown): GeoPoint | undefined {
  const valid = (value: unknown) => typeof value === "number" || typeof value === "string" && value.trim() !== "";
  if (!valid(latitude) || !valid(longitude)) return undefined;
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { latitude: lat, longitude: lon };
}

export function distanceKilometres(from: GeoPoint, to: GeoPoint): number {
  const radians = (angle: number) => angle * Math.PI / 180;
  const lat = radians(to.latitude - from.latitude), lon = radians(to.longitude - from.longitude);
  const a = Math.sin(lat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/** Walking estimate from straight-line distance, not an actual street route. */
export function estimateTravelMinutes(travel?: TravelSettings, destination?: GeoPoint): {
  minutes: number; estimated: boolean; missingLocation: boolean;
} {
  if (!travel || travel.mode === "off") return { minutes: 0, estimated: false, missingLocation: false };
  const positive = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, value!) : 0;
  const additional = positive(travel.minutes) + positive(travel.bufferMinutes);
  if (travel.mode === "manual") return { minutes: Math.ceil(additional), estimated: false, missingLocation: false };
  const origin = locationFrom(travel.latitude, travel.longitude);
  const station = locationFrom(destination?.latitude, destination?.longitude);
  if (!origin || !station) return { minutes: Math.ceil(additional), estimated: false, missingLocation: true };
  const speed = Math.min(8, Math.max(1, positive(travel.walkingSpeedKmh) || 4.8));
  return { minutes: Math.ceil(distanceKilometres(origin, station) * 1.3 / speed * 60 + additional), estimated: true, missingLocation: false };
}

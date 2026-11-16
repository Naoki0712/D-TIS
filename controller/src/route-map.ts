import type { GeoPoint } from "../../shared/display-settings";
import type { StationChoice } from "./catalog";

export type MapPoint = { x: number; y: number };
export type MapView = { center: GeoPoint; zoom: number };
export type LocatedStationChoice = StationChoice & { location: GeoPoint };
export const MIN_MAP_ZOOM = 3;
export const MAX_MAP_ZOOM = 18;

/** Ignore missing and invalid positions; those stations remain available in search. */
export function locatedStationChoices(choices: StationChoice[]): LocatedStationChoice[] {
  return choices.flatMap(choice => {
    const location = choice.matches.map(match => match.station.location).find(position => position
      && Number.isFinite(position.latitude) && Number.isFinite(position.longitude)
      && Math.abs(position.latitude) <= 85.05112878 && Math.abs(position.longitude) <= 180);
    return location ? [{ ...choice, location }] : [];
  });
}

export function projectLocation(location: GeoPoint, zoom: number): MapPoint {
  const scale = 256 * 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, location.latitude));
  const sine = Math.sin(latitude * Math.PI / 180);
  return { x: (location.longitude + 180) / 360 * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
}

export function unprojectLocation(point: MapPoint, zoom: number): GeoPoint {
  const scale = 256 * 2 ** zoom;
  return { latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * point.y / scale))) * 180 / Math.PI,
    longitude: point.x / scale * 360 - 180 };
}

export function fitStationMap(stations: LocatedStationChoice[], width: number, height: number): MapView {
  if (!stations.length) return { center: { latitude: 35.6812, longitude: 139.7671 }, zoom: 11 };
  const points = stations.map(station => projectLocation(station.location, 0));
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  const zoom = Math.max(MIN_MAP_ZOOM, Math.min(14, Math.floor(Math.log2(Math.min(
    Math.max(100, width - 96) / Math.max(maxX - minX, 0.005),
    Math.max(100, height - 96) / Math.max(maxY - minY, 0.005),
  )))));
  return { center: unprojectLocation({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 0), zoom };
}

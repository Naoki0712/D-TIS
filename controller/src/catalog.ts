export type CatalogStation = { id: string; name: string; code?: string; directions: string[]; directionNames?: Record<string, string> };
export type CatalogLine = { id: string; name: string; stations: CatalogStation[]; mode?: "rail" | "bus"; lineCode?: string; directionNames?: Record<string, string>; supportsCarCount?: boolean };
export type StationChoice = { name: string; matches: { line: CatalogLine; station: CatalogStation }[] };
const searchable = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s/g, "");

/** An interchange is chosen once, before choosing one of its actual railway IDs. */
export function stationChoices(lines: CatalogLine[], query = ""): StationChoice[] {
  const choices = new Map<string, StationChoice>();
  const search = searchable(query);
  for (const line of lines) for (const station of line.stations) {
    const existing = choices.get(station.name) ?? { name: station.name, matches: [] };
    existing.matches.push({ line, station });
    choices.set(station.name, existing);
  }
  return [...choices.values()].filter(choice => !search || searchable(choice.name).includes(search)
    || choice.matches.some(({ station }) => searchable(`${station.id} ${station.code ?? ""}`).includes(search)))
    .sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
}

export function matchingLines(choice: StationChoice | undefined, query: string) {
  const search = searchable(query);
  return (choice?.matches ?? []).filter(({ line }) => !search || searchable(`${line.name} ${line.id} ${line.lineCode ?? ""}`).includes(search));
}

export const routeGroupKey = (route: { railway: string; station: string }) => `${route.railway}|${route.station}`;

export function groupRoutes<T extends { railway: string; station: string }>(routes: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const route of routes) {
    const key = routeGroupKey(route);
    groups.set(key, [...(groups.get(key) ?? []), route]);
  }
  return [...groups.values()];
}

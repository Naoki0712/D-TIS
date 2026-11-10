import { stationAssetNumbers } from "./station-asset-numbers";
import { railwayDefinition, railwayDefinitions } from "./railway";
import { sitePath } from "./app-urls";

export { railwayColor, railwaySymbol } from "./railway";

export const sharedLogo = sitePath("assets/Logo/1.svg");
export const unknownAsset = sitePath("assets/unknown.svg");

const definitionsBySymbol = new Map(
  Object.values(railwayDefinitions).map(definition => [definition.symbol.toUpperCase(), definition]),
);

/** Accept ODPT's Z12 and Z-12 spellings and supplied variants such as OH-47h. */
export function stationAsset(code?: string): string {
  const match = code?.trim().match(/^([A-Za-z]+)[ -]?(\d{1,2})([A-Za-z]?)$/);
  if (!match) return unknownAsset;
  const prefix = match[1].toLowerCase() === "mb" ? "Mb" : match[1].toUpperCase();
  const number = `${match[2].padStart(2, "0")}${match[3].toLowerCase()}`;
  const definition = definitionsBySymbol.get(prefix === "Mb" ? "M" : prefix);
  if (!definition || !stationAssetNumbers[prefix]?.includes(number)) return unknownAsset;
  return sitePath(`assets/${definition.folder}/${prefix}-${number}.png`);
}

/** Resolve by railway identity first, so Yokohama's G cannot be confused with Ginza. */
export function railwayAsset(railwayId: string, stationCode?: string): string {
  if (/TokyoMetro\.Ginza$/.test(railwayId)) return unknownAsset;
  const definition = railwayDefinition(railwayId)
    ?? definitionsBySymbol.get(stationCode?.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? "");
  return definition && definition.symbolFile !== null
    ? sitePath(`assets/${definition.folder}/${definition.symbolFile ?? `${definition.symbol}.png`}`)
    : unknownAsset;
}

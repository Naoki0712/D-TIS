import { stationAssetNumbers } from "./station-asset-numbers";
import { railwayDefinition, railwayDefinitions } from "./railway";
import { sitePath } from "./app-urls";

export { railwayColor, railwaySymbol } from "./railway";

export const sharedLogo = sitePath("assets/Logo/1.svg");
export const unknownAsset = sitePath("assets/unknown.svg");

const definitionsBySymbol = new Map(
  Object.values(railwayDefinitions).map(definition => [definition.symbol.toUpperCase(), definition]),
);

/** Explicit numbering without supplied artwork still gets a readable badge. */
const vectorNumbering: Record<string, { numbers: readonly string[]; color: string }> = {
  SH: { numbers: ["01", "02", "03"], color: "#8d4897" },
  SO: { numbers: ["08", "10", "14", "18", "37", "51", "52"], color: "#005eaa" },
};

function numberedBadge(prefix: string, number: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="5" y="5" width="90" height="90" rx="22" fill="white" stroke="${color}" stroke-width="9"/><g fill="#141414" font-family="Arial,sans-serif" font-weight="700" text-anchor="middle"><text x="50" y="43" font-size="29">${prefix}</text><text x="50" y="79" font-size="36">${number}</text></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Accept ODPT's Z12 and Z-12 spellings and supplied variants such as OH-47h. */
export function stationAsset(code?: string, identity?: string): string {
  const match = code?.trim().match(/^([A-Za-z]+)[ -]?(\d{1,2})([A-Za-z]?)$/);
  if (!match) return unknownAsset;
  const prefix = match[1].toLowerCase() === "mb" ? "Mb" : match[1].toUpperCase();
  const number = `${match[2].padStart(2, "0")}${match[3].toLowerCase()}`;
  const vector = vectorNumbering[prefix];
  if (vector?.numbers.includes(number)) return numberedBadge(prefix, number, vector.color);
  // Both operators use G. Unqualified codes use Tokyo Metro; station/railway
  // identity keeps Yokohama's G01–G10 on its own supplied artwork.
  if (prefix === "G") {
    const green = identity?.includes("YokohamaMunicipal.Green") === true;
    const limit = green ? 10 : 19;
    if (!/^\d{2}$/.test(number) || Number(number) < 1 || Number(number) > limit) return unknownAsset;
    if (green) return sitePath(`assets/Green_Line/G-${number}.png`);
    const names = ["渋谷", "表参道", "外苑前", "青山一丁目", "赤坂見附", "溜池山王", "虎ノ門", "新橋", "銀座", "京橋", "日本橋", "三越前", "神田", "末広町", "上野広小路", "上野", "稲荷町", "田原町", "浅草"];
    return sitePath(`assets/Ginza_Line/station_icon_g-${number}-${names[Number(number) - 1]}.png`);
  }
  const definition = definitionsBySymbol.get(prefix === "Mb" ? "M" : prefix);
  if (!definition || !stationAssetNumbers[prefix]?.includes(number)) return unknownAsset;
  return sitePath(`assets/${definition.folder}/${prefix}-${number}.png`);
}

/** Resolve by railway identity first, so Yokohama's G cannot be confused with Ginza. */
export function railwayAsset(railwayId: string, stationCode?: string): string {
  const definition = railwayDefinition(railwayId)
    ?? definitionsBySymbol.get(stationCode?.match(/^[A-Za-z]+/)?.[0].toUpperCase() ?? "");
  return definition && definition.symbolFile !== null
    ? sitePath(`assets/${definition.folder}/${definition.symbolFile ?? `${definition.symbol}.png`}`)
    : unknownAsset;
}

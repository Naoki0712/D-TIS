export const shortId = (value: string) => value.split(":").at(-1)?.split(".").at(-1) ?? value;

export type RailwayDefinition = {
  symbol: string;
  folder: string;
  name: string;
  color: string;
  /** null means only station-number images have been supplied for this line. */
  symbolFile?: string | null;
};

export const railwayDefinitions: Record<string, RailwayDefinition> = {
  Marunouchi: { symbol: "M", folder: "Marunouchi_Line", name: "東京メトロ丸ノ内線", color: "#f62e36" },
  MarunouchiBranch: { symbol: "M", folder: "Marunouchi_Line", name: "東京メトロ丸ノ内線 方南町支線", color: "#f62e36" },
  Hibiya: { symbol: "H", folder: "Hibiya_Line", name: "東京メトロ日比谷線", color: "#b5b5ac", symbolFile: "H.svg" },
  Tozai: { symbol: "T", folder: "Tozai_Line", name: "東京メトロ東西線", color: "#009bbf" },
  Chiyoda: { symbol: "C", folder: "Chiyoda_Line", name: "東京メトロ千代田線", color: "#00bb85" },
  Yurakucho: { symbol: "Y", folder: "Yurakucho_Line", name: "東京メトロ有楽町線", color: "#c1a470" },
  Hanzomon: { symbol: "Z", folder: "Hanzomon_Line", name: "東京メトロ半蔵門線", color: "#8f76d6" },
  Namboku: { symbol: "N", folder: "Namboku_Line", name: "東京メトロ南北線", color: "#00ac9b", symbolFile: "N.svg" },
  Fukutoshin: { symbol: "F", folder: "Fukutoshin_Line", name: "東京メトロ副都心線", color: "#9c5e31" },
  Asakusa: { symbol: "A", folder: "Asakusa_Line", name: "都営浅草線", color: "#e85298", symbolFile: "A.svg" },
  Mita: { symbol: "I", folder: "Mita_Line", name: "都営三田線", color: "#0079c2" },
  Shinjuku: { symbol: "S", folder: "Shinjuku_Line", name: "都営新宿線", color: "#6cbb5a" },
  Oedo: { symbol: "E", folder: "Oedo_Line", name: "都営大江戸線", color: "#b6007a" },
  Arakawa: { symbol: "SA", folder: "Tokyo_Sakura_Tram", name: "東京さくらトラム（都電荒川線）", color: "#d85a7d" },
  NipporiToneri: { symbol: "NT", folder: "Nippori-Toneri_Liner", name: "日暮里・舎人ライナー", color: "#b5c900" },
  Blue: { symbol: "B", folder: "Blue_Line", name: "横浜市営地下鉄ブルーライン", color: "#006bb6" },
  Green: { symbol: "G", folder: "Green_Line", name: "横浜市営地下鉄グリーンライン", color: "#00a040" },
  TsukubaExpress: { symbol: "TX", folder: "Tsukuba_Express_Line", name: "つくばエクスプレス", color: "#d52b4b" },
  Yurikamome: { symbol: "U", folder: "Yurikamome_Line", name: "ゆりかもめ", color: "#00a7db", symbolFile: "U.svg" },
  ToeiBus: { symbol: "BUS", folder: "Toei_Bus", name: "都営バス", color: "#009d57", symbolFile: "bus.svg" },
  DenEnToshi: { symbol: "DT", folder: "Den-en-toshi_Line", name: "東急田園都市線", color: "#00a88f" },
  Toyoko: { symbol: "TY", folder: "Toyoko_Line", name: "東急東横線", color: "#da0442" },
  Meguro: { symbol: "MG", folder: "Meguro_Line", name: "東急目黒線", color: "#009cd3" },
  Minatomirai: { symbol: "MM", folder: "Minatomirai_Line", name: "みなとみらい線", color: "#18398a" },
  Ikebukuro: { symbol: "SI", folder: "Ikebukuro_Line", name: "西武池袋線", color: "#ee7b1a" },
  Tojo: { symbol: "TJ", folder: "Tojo_Line", name: "東武東上線", color: "#004da1" },
  Isesaki: { symbol: "TI", folder: "Isesaki_Line", name: "東武伊勢崎線", color: "#ed1a3d" },
  TobuSkytree: { symbol: "TS", folder: "SKYTREE_Line", name: "東武スカイツリーライン", color: "#00a6bf" },
  Nikko: { symbol: "TN", folder: "Nikko_Line", name: "東武日光線", color: "#f18f27" },
  JobanLocal: { symbol: "JL", folder: "Joban_Line_Local", name: "常磐線各駅停車", color: "#00b261", symbolFile: null },
  ChuoSobuLocal: { symbol: "JB", folder: "Chuo-Sobu_Line_Local", name: "中央・総武線各駅停車", color: "#ffd400", symbolFile: null },
  ToyoRapid: { symbol: "TR", folder: "Toyo-Rapid_Line", name: "東葉高速線", color: "#3fb036", symbolFile: "TR.PNG" },
  SaitamaRailway: { symbol: "SR", folder: "Saitama-Railway-Saitama-Stadium_Line", name: "埼玉高速鉄道埼玉スタジアム線", color: "#345caa", symbolFile: null },
  Odawara: { symbol: "OH", folder: "Odawara_Line", name: "小田急小田原線", color: "#2288cc" },
  Enoshima: { symbol: "OE", folder: "Enoshima_Line", name: "小田急江ノ島線", color: "#2288cc" },
  Tama: { symbol: "OT", folder: "Tama_Line", name: "小田急多摩線", color: "#2288cc" },
  Keio: { symbol: "KO", folder: "Keio_Line", name: "京王線", color: "#dd0077", symbolFile: null },
  Keisei: { symbol: "KS", folder: "Keisei_Line", name: "京成線", color: "#005aaa" },
  Keikyu: { symbol: "KK", folder: "Keikyu_Line", name: "京急線", color: "#e60012", symbolFile: null },
  Hokuso: { symbol: "HS", folder: "Hokuso_Line", name: "北総線", color: "#00a7db", symbolFile: "HS.PNG" },
};

const railwayAliases: Record<string, string> = {
  "JR-East.JobanLocal": "JobanLocal",
  "JR-East.ChuoSobuLocal": "ChuoSobuLocal",
  "ToyoRapid.ToyoRapid": "ToyoRapid",
  "SaitamaRailway.SaitamaRailway": "SaitamaRailway",
  "Odakyu.Odawara": "Odawara",
  "Odakyu.Enoshima": "Enoshima",
  "Odakyu.Tama": "Tama",
  "Keio.Keio": "Keio",
  "Keio.NewKeio": "Keio",
  "Keio.KeioNew": "Keio",
  "Keio.Sagamihara": "Keio",
  "Keio.Takao": "Keio",
  "Keio.Keibajo": "Keio",
  "Keio.Dobutsuen": "Keio",
  "Keisei.Main": "Keisei",
  "Keisei.Oshiage": "Keisei",
  "Keisei.Kanamachi": "Keisei",
  "Keisei.Chiba": "Keisei",
  "Keisei.Chihara": "Keisei",
  "Keisei.HigashiNarita": "Keisei",
  "Keisei.NaritaSkyAccess": "Keisei",
  "Keisei.NaritaAirport": "Keisei",
  "Keisei.Matsudo": "Keisei",
  "Keikyu.Main": "Keikyu",
  "Keikyu.Airport": "Keikyu",
  "Keikyu.Daishi": "Keikyu",
  "Keikyu.Zushi": "Keikyu",
  "Keikyu.Kurihama": "Keikyu",
  "Hokuso.Hokuso": "Hokuso",
};

export function railwayDefinition(id: string): RailwayDefinition | undefined {
  if (/odpt\.Busroute(?:Pattern)?:Toei\.|ToeiBus/i.test(id)) return railwayDefinitions.ToeiBus;
  const identity = id.split(":").at(-1) ?? id;
  const alias = railwayAliases[identity];
  if (alias) return railwayDefinitions[alias];
  const key = shortId(id);
  return railwayDefinitions[key]
    ?? (/Sky[Tt]ree/i.test(key) ? railwayDefinitions.TobuSkytree : undefined);
}

export const railwaySymbol = (id: string) => railwayDefinition(id)?.symbol ?? "";
export const railwayColor = (id: string) => railwayDefinition(id)?.color ?? "#72727d";

export function railwayName(id: string, name: string) {
  const definition = railwayDefinition(id);
  if (definition && definition !== railwayDefinitions.ToeiBus) return definition.name;
  return id.includes("TokyoMetro.") && !name.startsWith("東京メトロ") ? `東京メトロ${name}` : name;
}
export function directionName(id: string, name: string) {
  return shortId(id) === "Oshiage" ? "押上" : name.replace(/[〈（(].*$/, "");
}
export const railwaySymbols: Record<string, string> = {
  ...Object.fromEntries(Object.entries(railwayDefinitions).map(([key, definition]) => [key, definition.symbol])),
};

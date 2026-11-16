/**
 * ODPT supplies names but omits numbering for many through-service stations.
 * These are explicit station identities, not numbers inferred from station order.
 * References: the operators' official station maps and station information:
 * https://www.jreast.co.jp/equipment/equipment_1/wheelchair/pdf/joban.pdf
 * https://www.jreast.co.jp/map/
 * https://www.odakyu.jp/station/
 * https://www.keio.co.jp/train/station/
 * https://www.keisei.co.jp/keisei/quality/image/youran2025.pdf
 * https://www.keikyu.co.jp/ride/kakueki/
 * https://www.toyokosoku.co.jp/station
 * https://www.s-rail.co.jp/ticket/line/
 * https://www.hokuso-railway.co.jp/railway/station/
 * https://www.seiburailway.jp/railway/station/
 * https://www.tobu.co.jp/railway/guide/line/tojo_line.html
 * https://www.tokyu.co.jp/railway/map/
 * https://www.sotetsu.co.jp/train/stations/
 */
type Entry = { code: string; japanese: string; names: string[]; origins: readonly string[] };
const stationCodes = new Map<string, Entry>();
const entries: Entry[] = [];
const normalizedName = (value: string) => value.normalize("NFKC").replace(/[\s\-・･〈〉（）()]/g, "").toLowerCase();
const stationKey = (value: string) => value.normalize("NFKC").replace(/[\s\-]/g, "").toLowerCase();

function register(line: string, origins: readonly string[], stations: Record<string, [string, string]>) {
  for (const [name, [code, japanese]] of Object.entries(stations)) {
    const entry = { code, japanese, names: [normalizedName(name), normalizedName(japanese)], origins };
    stationCodes.set(stationKey(`odpt.Station:${line}.${name}`), entry);
    entries.push(entry);
  }
}

const chiyoda = ["TokyoMetro.Chiyoda"];
const tozai = ["TokyoMetro.Tozai"];
const namboku = ["TokyoMetro.Namboku"];
const shinjuku = ["Toei.Shinjuku"];
const asakusa = ["Toei.Asakusa"];

register("JR-East.JobanLocal", chiyoda, {
  Ayase: ["JL19", "綾瀬"], Matsudo: ["JL22", "松戸"], Kashiwa: ["JL28", "柏"],
  Abiko: ["JL30", "我孫子"], Toride: ["JL32", "取手"],
});
register("JR-East.ChuoSobuLocal", tozai, {
  Mitaka: ["JB01", "三鷹"], Nakano: ["JB07", "中野"], NishiFunabashi: ["JB30", "西船橋"], Tsudanuma: ["JB33", "津田沼"],
});
register("ToyoRapid.ToyoRapid", tozai, {
  NishiFunabashi: ["TR01", "西船橋"], YachiyoMidorigaoka: ["TR06", "八千代緑が丘"], ToyoKatsutadai: ["TR09", "東葉勝田台"],
});
register("SaitamaRailway.SaitamaRailway", namboku, {
  AkabaneIwabuchi: ["SR19", "赤羽岩淵"], Hatogaya: ["SR22", "鳩ヶ谷"], UrawaMisono: ["SR26", "浦和美園"],
});
register("Odakyu.Odawara", chiyoda, {
  Shinjuku: ["OH01", "新宿"], YoyogiUehara: ["OH05", "代々木上原"], SeijogakuenMae: ["OH14", "成城学園前"],
  MukogaokaYuen: ["OH19", "向ヶ丘遊園"], ShinYurigaoka: ["OH23", "新百合ヶ丘"], Machida: ["OH27", "町田"],
  SagamiOno: ["OH28", "相模大野"], Ebina: ["OH32", "海老名"], HonAtsugi: ["OH34", "本厚木"], Isehara: ["OH36", "伊勢原"],
});
register("Odakyu.Enoshima", chiyoda, { Shonandai: ["OE09", "湘南台"] });
register("Odakyu.Tama", chiyoda, { OdakyuTamaCenter: ["OT06", "小田急多摩センター"], Karakida: ["OT07", "唐木田"] });
register("OdakyuHakone.HakoneTozan", chiyoda, { HakoneYumoto: ["OH51", "箱根湯本"] });

register("Keio.Keio", shinjuku, {
  Shinjuku: ["KO01", "新宿"], Sakurajosui: ["KO08", "桜上水"], HachimanYama: ["KO10", "八幡山"],
  Tsutsujigaoka: ["KO14", "つつじヶ丘"], Chofu: ["KO18", "調布"], Takahatafudo: ["KO29", "高幡不動"], KeioHachioji: ["KO34", "京王八王子"],
});
register("Keio.KeioNew", shinjuku, { Shinjuku: ["KO01", "新宿"], Sasazuka: ["KO04", "笹塚"] });
register("Keio.Sagamihara", shinjuku, { Wakabadai: ["KO39", "若葉台"], KeioTamaCenter: ["KO41", "京王多摩センター"], Hashimoto: ["KO45", "橋本"] });
register("Keio.Takao", shinjuku, { Takao: ["KO52", "高尾"], Takaosanguchi: ["KO53", "高尾山口"] });
register("Keio.Dobutsuen", shinjuku, { Takahatafudo: ["KO29", "高幡不動"], TamaDobutsukoen: ["KO47", "多摩動物公園"] });
register("Keio.Keibajo", shinjuku, { FuchukeibaSeimommae: ["KO46", "府中競馬正門前"] });

register("Keisei.Main", asakusa, {
  KeiseiUeno: ["KS01", "京成上野"], Nippori: ["KS02", "日暮里"], Machiya: ["KS04", "町屋"], KeiseiTakasago: ["KS10", "京成高砂"],
  KeiseiYawata: ["KS16", "京成八幡"], KeiseiNishifuna: ["KS20", "京成西船"], KeiseiSakura: ["KS35", "京成佐倉"],
  Sogosando: ["KS38", "宗吾参道"], KeiseiNarita: ["KS40", "京成成田"], NaritaAirportTerminal1: ["KS42", "成田空港"],
});
register("Keisei.Oshiage", asakusa, { Aoto: ["KS09", "青砥"], Oshiage: ["KS45", "押上"] });
register("Keisei.NaritaSkyAccess", asakusa, { NaritaAirportTerminal1: ["KS42", "成田空港"] });
register("Keikyu.Main", asakusa, {
  Sengakuji: ["KK00", "泉岳寺"], Shinagawa: ["KK01", "品川"], KeikyuKamata: ["KK11", "京急蒲田"],
  KeikyuKawasaki: ["KK20", "京急川崎"], KanagawaShimmachi: ["KK34", "神奈川新町"], Yokohama: ["KK37", "横浜"],
  Kamiooka: ["KK44", "上大岡"], KanazawaBunko: ["KK49", "金沢文庫"], Uraga: ["KK64", "浦賀"],
});
register("Keikyu.Airport", asakusa, { HanedaAirportTerminal1and2: ["KK17", "羽田空港第１・第２ターミナル"] });
register("Keikyu.Kurihama", asakusa, { KeikyuKurihama: ["KK67", "京急久里浜"], Miurakaigan: ["KK71", "三浦海岸"], Misakiguchi: ["KK72", "三崎口"] });
register("Keikyu.Zushi", asakusa, { ZushiHayama: ["KK53", "逗子・葉山"] });
register("Hokuso.Hokuso", asakusa, { InzaiMakinohara: ["HS13", "印西牧の原"], ImbaNihonIdai: ["HS14", "印旛日本医大"] });

// Preserve the established four through destinations, with qualified identities.
register("Tokyu.DenEnToshi", ["TokyoMetro.Hanzomon"], {
  Shibuya: ["DT01", "渋谷"], SangenJaya: ["DT03", "三軒茶屋"], FutakoTamagawa: ["DT07", "二子玉川"],
  Mizonokuchi: ["DT10", "溝の口"], Saginuma: ["DT14", "鷺沼"], Azamino: ["DT16", "あざみ野"],
  Aobadai: ["DT20", "青葉台"], Nagatsuta: ["DT22", "長津田"], ChuoRinkan: ["DT27", "中央林間"],
});
const fukutoshin = ["TokyoMetro.Fukutoshin", "TokyoMetro.Yurakucho"];
register("Seibu.Ikebukuro", fukutoshin, {
  Ikebukuro: ["SI01", "池袋"], Nerima: ["SI06", "練馬"], ShakujiiKoen: ["SI10", "石神井公園"],
  Hoya: ["SI12", "保谷"], Hibarigaoka: ["SI13", "ひばりヶ丘"], Kiyose: ["SI15", "清瀬"],
  Tokorozawa: ["SI17", "所沢"], NishiTokorozawa: ["SI18", "西所沢"], Kotesashi: ["SI19", "小手指"],
  Irumashi: ["SI23", "入間市"], Hanno: ["SI26", "飯能"], HigashiHanno: ["SI27", "東飯能"], Agano: ["SI31", "吾野"],
});
for (const line of ["Seibu.SeibuYurakucho", "Seibu.Yurakucho"]) register(line, fukutoshin, {
  KotakeMukaihara: ["SI37", "小竹向原"], ShinSakuradai: ["SI38", "新桜台"], Nerima: ["SI06", "練馬"],
});
for (const line of ["Seibu.SeibuChichibu", "Seibu.Chichibu"]) register(line, fukutoshin, { SeibuChichibu: ["SI36", "西武秩父"] });
register("Seibu.Sayama", fukutoshin, { SeibukyujoMae: ["SI41", "西武球場前"] });
register("Tobu.Tojo", fukutoshin, {
  Ikebukuro: ["TJ01", "池袋"], KamiItabashi: ["TJ07", "上板橋"], Narimasu: ["TJ10", "成増"], Wakoshi: ["TJ11", "和光市"],
  Shiki: ["TJ14", "志木"], KamiFukuoka: ["TJ19", "上福岡"], Kawagoe: ["TJ21", "川越"], Kawagoeshi: ["TJ22", "川越市"],
  Sakado: ["TJ26", "坂戸"], ShinrinKoen: ["TJ30", "森林公園"], MusashiRanzan: ["TJ32", "武蔵嵐山"], Ogawamachi: ["TJ33", "小川町"], Yorii: ["TJ38", "寄居"],
});
const hanzomonHibiya = ["TokyoMetro.Hanzomon", "TokyoMetro.Hibiya"];
const skytreeStations: Record<string, [string, string]> = {
  Asakusa: ["TS01", "浅草"], TokyoSkytree: ["TS02", "とうきょうスカイツリー"], Oshiage: ["TS03", "押上"],
  KitaSenju: ["TS09", "北千住"], Takenotsuka: ["TS14", "竹ノ塚"], KitaKoshigaya: ["TS21", "北越谷"],
  KitaKasukabe: ["TS28", "北春日部"], TobuDobutsuKoen: ["TS30", "東武動物公園"],
};
for (const line of ["Tobu.Isesaki", "Tobu.TobuSkytree", "Tobu.Skytree"]) register(line, hanzomonHibiya, skytreeStations);
register("Tobu.Isesaki", hanzomonHibiya, { Kuki: ["TI02", "久喜"], Tatebayashi: ["TI10", "館林"], Ota: ["TI18", "太田"], Isesaki: ["TI25", "伊勢崎"] });
register("Tobu.Nikko", hanzomonHibiya, {
  TobuDobutsuKoen: ["TS30", "東武動物公園"], SugitoTakanodai: ["TN01", "杉戸高野台"], MinamiKurihashi: ["TN03", "南栗橋"],
  Kurihashi: ["TN04", "栗橋"], ShinTochigi: ["TN12", "新栃木"], TobuNikko: ["TN25", "東武日光"],
});
register("Tokyu.Toyoko", ["TokyoMetro.Fukutoshin", "TokyoMetro.Hibiya"], {
  Shibuya: ["TY01", "渋谷"], NakaMeguro: ["TY03", "中目黒"], Jiyugaoka: ["TY07", "自由が丘"],
  MusashiKosugi: ["TY11", "武蔵小杉"], Motosumiyoshi: ["TY12", "元住吉"], Hiyoshi: ["TY13", "日吉"], Kikuna: ["TY16", "菊名"], Yokohama: ["TY21", "横浜"],
});
register("YokohamaMinatomiraiRailway.Minatomirai", ["TokyoMetro.Fukutoshin"], {
  ShinTakashima: ["MM02", "新高島"], Minatomirai: ["MM03", "みなとみらい"],
  Bashamichi: ["MM04", "馬車道"], NihonOdori: ["MM05", "日本大通り"], MotomachiChukagai: ["MM06", "元町・中華街"],
});
register("YokohamaMinatomiraiRailway.Minatomirai", ["YokohamaMinatomiraiRailway.Minatomirai"], { Yokohama: ["MM01", "横浜"] });
register("Tokyu.Meguro", ["TokyoMetro.Namboku", "Toei.Mita"], {
  Meguro: ["MG01", "目黒"], Okusawa: ["MG07", "奥沢"], MusashiKosugi: ["MG11", "武蔵小杉"],
  Motosumiyoshi: ["MG12", "元住吉"], Hiyoshi: ["MG13", "日吉"],
});
const tokyuThrough = ["TokyoMetro.Fukutoshin", "TokyoMetro.Namboku", "Toei.Mita", "Tokyu.Toyoko", "Tokyu.Meguro", "Tokyu.ShinYokohama"];
register("Tokyu.ShinYokohama", tokyuThrough, { ShinYokohama: ["SH01", "新横浜"], ShinTsunashima: ["SH02", "新綱島"] });
register("Tokyu.ShinYokohama", ["Tokyu.ShinYokohama"], { Hiyoshi: ["SH03", "日吉"] });
register("Sotetsu.Main", tokyuThrough, { Nishiya: ["SO08", "西谷"], Futamatagawa: ["SO10", "二俣川"], Yamato: ["SO14", "大和"], Ebina: ["SO18", "海老名"] });
register("Sotetsu.Izumino", tokyuThrough, { Shonandai: ["SO37", "湘南台"] });
register("Sotetsu.ShinYokohama", ["Sotetsu.Main", "Sotetsu.Izumino"], { Nishiya: ["SO08", "西谷"], HazawaYokohamaKokudai: ["SO51", "羽沢横浜国大"], ShinYokohama: ["SO52", "新横浜"] });

export const externalStationCode = (station: string): string => stationCodes.get(stationKey(station))?.code ?? "";
export const externalStationName = (station: string): string => stationCodes.get(stationKey(station))?.japanese ?? "";

/** Old offline caches have destination names but do not retain their ODPT IDs. */
export function cachedDestinationCode(railway: string, japanese: string, english: string): string {
  const origin = railway.replace(/^odpt\.Railway:/, "");
  const names = [normalizedName(japanese), normalizedName(english)].filter(Boolean);
  const matches = entries.filter(entry => entry.origins.includes(origin) && entry.names.some(name => names.includes(name)));
  const codes = [...new Set(matches.map(entry => entry.code))];
  // Interchanges can belong to two external lines; omit an ambiguous code.
  return codes.length === 1 ? codes[0] : "";
}

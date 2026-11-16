import { railwayDefinition, shortId } from "./railway";

/** Japanese readings shared by the display and cached ODPT data. */
const stationReadings: Record<string, string> = {
  上り: "のぼり", 下り: "くだり", 内回り: "うちまわり", 外回り: "そとまわり",
  北行: "ほっこう", 南行: "なんこう", 東行: "とうこう", 西行: "せいこう",
  北行き: "きたいき", 南行き: "みなみいき", 東行き: "ひがしいき", 西行き: "にしいき",
  渋谷: "しぶや", 表参道: "おもてさんどう", 外苑前: "がいえんまえ", 青山一丁目: "あおやまいっちょうめ",
  赤坂見附: "あかさかみつけ", 溜池山王: "ためいけさんのう", 虎ノ門: "とらのもん", 新橋: "しんばし", 銀座: "ぎんざ",
  京橋: "きょうばし", 日本橋: "にほんばし", 三越前: "みつこしまえ", 神田: "かんだ", 末広町: "すえひろちょう",
  上野広小路: "うえのひろこうじ", 上野: "うえの", 稲荷町: "いなりちょう", 田原町: "たわらまち", 浅草: "あさくさ",
  押上: "おしあげ", 住吉: "すみよし", 中央林間: "ちゅうおうりんかん", 長津田: "ながつた", 鷺沼: "さぎぬま", 二子玉川: "ふたこたまがわ",
  溝の口: "みぞのくち", 三軒茶屋: "さんげんぢゃや", 青葉台: "あおばだい", あざみ野: "あざみの",
  久喜: "くき", 南栗橋: "みなみくりはし", 北越谷: "きたこしがや", 北春日部: "きたかすかべ", 東武動物公園: "とうぶどうぶつこうえん",
  北千住: "きたせんじゅ", 竹ノ塚: "たけのつか", 杉戸高野台: "すぎとたかのだい", 栗橋: "くりはし", 新栃木: "しんとちぎ",
  東武日光: "とうぶにっこう", 館林: "たてばやし", 太田: "おおた", 伊勢崎: "いせさき",
  池袋: "いけぶくろ", 練馬: "ねりま", 石神井公園: "しゃくじいこうえん", 保谷: "ほうや", "ひばりヶ丘": "ひばりがおか", "ひばりケ丘": "ひばりがおか",
  清瀬: "きよせ", 所沢: "ところざわ", 西所沢: "にしところざわ", 小手指: "こてさし", 入間市: "いるまし", 飯能: "はんのう",
  東飯能: "ひがしはんのう", 吾野: "あがの", 西武秩父: "せいぶちちぶ", 西武球場前: "せいぶきゅうじょうまえ",
  小竹向原: "こたけむかいはら", 新桜台: "しんさくらだい", 和光市: "わこうし", 志木: "しき", 上福岡: "かみふくおか",
  川越: "かわごえ", 川越市: "かわごえし", 坂戸: "さかど", 森林公園: "しんりんこうえん", 武蔵嵐山: "むさしらんざん", 小川町: "おがわまち", 寄居: "よりい", 成増: "なります",
  中目黒: "なかめぐろ", 自由が丘: "じゆうがおか", 武蔵小杉: "むさしこすぎ", 元住吉: "もとすみよし", 日吉: "ひよし", 菊名: "きくな", 横浜: "よこはま",
  新高島: "しんたかしま", 馬車道: "ばしゃみち", 日本大通り: "にほんおおどおり", "元町・中華街": "もとまち・ちゅうかがい",
  目黒: "めぐろ", 奥沢: "おくさわ", 新横浜: "しんよこはま", 新綱島: "しんつなしま", 海老名: "えびな", 湘南台: "しょうなんだい", 西谷: "にしや", 二俣川: "ふたまたがわ", 大和: "やまと", 羽沢横浜国大: "はざわよこはまこくだい",
  綾瀬: "あやせ", 北綾瀬: "きたあやせ", 代々木上原: "よよぎうえはら", 松戸: "まつど", 柏: "かしわ", 我孫子: "あびこ", 取手: "とりで",
  新宿: "しんじゅく", 成城学園前: "せいじょうがくえんまえ", "向ヶ丘遊園": "むこうがおかゆうえん", "新百合ヶ丘": "しんゆりがおか",
  町田: "まちだ", 相模大野: "さがみおおの", 本厚木: "ほんあつぎ", 伊勢原: "いせはら", 小田急多摩センター: "おだきゅうたませんたー", 唐木田: "からきだ", 箱根湯本: "はこねゆもと",
  三鷹: "みたか", 中野: "なかの", 西船橋: "にしふなばし", 津田沼: "つだぬま", 八千代緑が丘: "やちよみどりがおか", 東葉勝田台: "とうようかつただい",
  赤羽岩淵: "あかばねいわぶち", 鳩ヶ谷: "はとがや", 浦和美園: "うらわみその", 西高島平: "にしたかしまだいら", 白金高輪: "しろかねたかなわ", 高島平: "たかしまだいら",
  桜上水: "さくらじょうすい", 八幡山: "はちまんやま", "つつじヶ丘": "つつじがおか", 調布: "ちょうふ", 高幡不動: "たかはたふどう", 京王八王子: "けいおうはちおうじ",
  笹塚: "ささづか", "笹塚": "ささづか", 若葉台: "わかばだい", 京王多摩センター: "けいおうたませんたー", 橋本: "はしもと", 高尾: "たかお", 高尾山口: "たかおさんぐち", 多摩動物公園: "たまどうぶつこうえん", 府中競馬正門前: "ふちゅうけいばせいもんまえ",
  京成上野: "けいせいうえの", 日暮里: "にっぽり", 町屋: "まちや", 京成高砂: "けいせいたかさご", 京成八幡: "けいせいやわた", 京成西船: "けいせいにしふな",
  京成佐倉: "けいせいさくら", 宗吾参道: "そうごさんどう", 京成成田: "けいせいなりた", 成田空港: "なりたくうこう", 青砥: "あおと",
  泉岳寺: "せんがくじ", 品川: "しながわ", 京急蒲田: "けいきゅうかまた", 京急川崎: "けいきゅうかわさき", 神奈川新町: "かながわしんまち",
  上大岡: "かみおおおか", 金沢文庫: "かなざわぶんこ", 浦賀: "うらが", 京急久里浜: "けいきゅうくりはま", 三浦海岸: "みうらかいがん", 三崎口: "みさきぐち",
  "逗子・葉山": "ずし・はやま", 印西牧の原: "いんざいまきのはら", 印旛日本医大: "いんばにほんいだい",
  荻窪: "おぎくぼ", 方南町: "ほうなんちょう", 新宿三丁目: "しんじゅくさんちょうめ", 東新宿: "ひがししんじゅく", 千川: "せんかわ", 新木場: "しんきば", 豊洲: "とよす",
  飯田橋: "いいだばし", 市ヶ谷: "いちがや", 九段下: "くだんした", 大手町: "おおてまち", 永田町: "ながたちょう", 北参道: "きたさんどう", 明治神宮前: "めいじじんぐうまえ",
  秋葉原: "あきはばら", つくば: "つくば", 守谷: "もりや", 八潮: "やしお", 流山おおたかの森: "ながれやまおおたかのもり",
  西馬込: "にしまごめ", 本八幡: "もとやわた", 大島: "おおじま", 都庁前: "とちょうまえ", 光が丘: "ひかりがおか", 清澄白河: "きよすみしらかわ",
  中山: "なかやま", センター北: "せんたーきた", センター南: "せんたーみなみ", 上永谷: "かみながや", 踊場: "おどりば",
};

const lineReadings: Record<string, string> = {
  Ginza: "とうきょうめとろ ぎんざせん", Marunouchi: "とうきょうめとろ まるのうちせん", MarunouchiBranch: "とうきょうめとろ まるのうちせん ほうなんちょうしせん",
  Hibiya: "とうきょうめとろ ひびやせん", Tozai: "とうきょうめとろ とうざいせん", Chiyoda: "とうきょうめとろ ちよだせん",
  Yurakucho: "とうきょうめとろ ゆうらくちょうせん", Hanzomon: "とうきょうめとろ はんぞうもんせん", Namboku: "とうきょうめとろ なんぼくせん", Fukutoshin: "とうきょうめとろ ふくとしんせん",
  Asakusa: "とえい あさくさせん", Mita: "とえい みたせん", Shinjuku: "とえい しんじゅくせん", Oedo: "とえい おおえどせん",
  Arakawa: "とうきょうさくらとらむ", NipporiToneri: "にっぽり とねりらいなー", Blue: "よこはましえいちかてつ ぶるーらいん", Green: "よこはましえいちかてつ ぐりーんらいん",
  TsukubaExpress: "つくばえくすぷれす", Yurikamome: "ゆりかもめ", DenEnToshi: "とうきゅう でんえんとしせん", Toyoko: "とうきゅう とうよこせん", Meguro: "とうきゅう めぐろせん",
  Minatomirai: "みなとみらいせん", Ikebukuro: "せいぶ いけぶくろせん", Tojo: "とうぶ とうじょうせん", Isesaki: "とうぶ いせさきせん", TobuSkytree: "とうぶ すかいつりーらいん", Nikko: "とうぶ にっこうせん",
};

const typeReadings: Record<string, string> = {
  各駅停車: "かくえきていしゃ", 普通: "ふつう", 急行: "きゅうこう", 準急: "じゅんきゅう", 特急: "とっきゅう", 快特: "かいとく",
  快速: "かいそく", 快速急行: "かいそくきゅうこう", 区間快速: "くかんかいそく", 区間急行: "くかんきゅうこう", 区間準急: "くかんじゅんきゅう",
  通勤快速: "つうきんかいそく", 通勤急行: "つうきんきゅうこう", 通勤準急: "つうきんじゅんきゅう", 通勤特急: "つうきんとっきゅう",
  アクセス特急: "あくせすとっきゅう", エアポート快特: "えあぽーとかいとく", エアポート急行: "えあぽーときゅうこう", エアポート特急: "えあぽーととっきゅう",
  "Fライナー": "えふらいなー", "Ｆライナー": "えふらいなー", "S-TRAIN": "えすとれいん", "Sトレイン": "えすとれいん", "THライナー": "てぃーえいちらいなー", "TJライナー": "てぃーじぇいらいなー",
};
const hiragana = (value: string) => value.replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));

const syllables: Record<string, string> = {
  kya: "きゃ", kyu: "きゅ", kyo: "きょ", gya: "ぎゃ", gyu: "ぎゅ", gyo: "ぎょ", sha: "しゃ", shu: "しゅ", sho: "しょ", shi: "し",
  cha: "ちゃ", chu: "ちゅ", cho: "ちょ", chi: "ち", tsu: "つ", sya: "しゃ", syu: "しゅ", syo: "しょ", tya: "ちゃ", tyu: "ちゅ", tyo: "ちょ",
  nya: "にゃ", nyu: "にゅ", nyo: "にょ", hya: "ひゃ", hyu: "ひゅ", hyo: "ひょ", bya: "びゃ", byu: "びゅ", byo: "びょ",
  pya: "ぴゃ", pyu: "ぴゅ", pyo: "ぴょ", mya: "みゃ", myu: "みゅ", myo: "みょ", rya: "りゃ", ryu: "りゅ", ryo: "りょ", ja: "じゃ", ju: "じゅ", jo: "じょ",
  ka: "か", ki: "き", ku: "く", ke: "け", ko: "こ", ga: "が", gi: "ぎ", gu: "ぐ", ge: "げ", go: "ご",
  sa: "さ", si: "し", su: "す", se: "せ", so: "そ", za: "ざ", zi: "じ", ji: "じ", zu: "ず", ze: "ぜ", zo: "ぞ",
  ta: "た", ti: "ち", tu: "つ", te: "て", to: "と", da: "だ", di: "ぢ", du: "づ", de: "で", do: "ど",
  na: "な", ni: "に", nu: "ぬ", ne: "ね", no: "の", ha: "は", hi: "ひ", hu: "ふ", fu: "ふ", he: "へ", ho: "ほ",
  ba: "ば", bi: "び", bu: "ぶ", be: "べ", bo: "ぼ", pa: "ぱ", pi: "ぴ", pu: "ぷ", pe: "ぺ", po: "ぽ",
  ma: "ま", mi: "み", mu: "む", me: "め", mo: "も", ya: "や", yu: "ゆ", yo: "よ", ra: "ら", ri: "り", ru: "る", re: "れ", ro: "ろ", wa: "わ", wo: "を",
  a: "あ", i: "い", u: "う", e: "え", o: "お",
};

/** ODPT romanizations cover stations outside the fixed through-destination list. */
function romanizedReading(value: string): string {
  let source = value.toLowerCase().replace(/ā/g, "aa").replace(/ī/g, "ii").replace(/ū/g, "uu").replace(/ē/g, "ei").replace(/ō/g, "ou").replace(/[\s\-'’]/g, "");
  let result = "";
  while (source) {
    if (/^n(?:n|[^aeiouy]|$)/.test(source)) { result += "ん"; source = source.slice(1); continue; }
    if (/^([bcdfghjklmpqrstvwxyz])\1/.test(source)) { result += "っ"; source = source.slice(1); continue; }
    const token = [3, 2, 1].map(length => source.slice(0, length)).find(part => syllables[part]);
    if (!token) return "";
    result += syllables[token]; source = source.slice(token.length);
  }
  return result;
}

export function normalizeStationEnglish(value: string): string {
  return value.replace(/Oshiage\s*[<〈＜(（]\s*SKYTREE\s*[>〉＞)）]/gi, "Oshiage'SKYTREE'");
}

export function stationReading(japanese: string, english = "", identity = ""): string {
  const name = japanese.replace(/[〈<（(].*$/, "").replace(/駅$/, "");
  if (stationReadings[name]) return stationReadings[name];
  if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(name)) return hiragana(name);
  if (japanese.includes("・")) {
    const pieces = japanese.split("・").map((part, index) => stationReading(part, english.split(/\s*\/\s*/)[index] ?? ""));
    if (pieces.every(Boolean)) return pieces.join("・");
  }
  const romanized = (english || shortId(identity)).replace(/\s+Station$/i, "").replace(/['〈<(].*$/, "");
  return romanizedReading(romanized);
}

export function railwayReading(japaneseOrIdentity: string): string {
  const definition = railwayDefinition(japaneseOrIdentity);
  if (definition) {
    return lineReadings[shortId(japaneseOrIdentity)]
      ?? Object.entries(lineReadings).find(([key]) => railwayDefinition(key) === definition)?.[1] ?? "";
  }
  const shortName = japaneseOrIdentity.replace(/^(東京メトロ|都営|東急|東武|西武)/, "");
  const match = Object.entries(lineReadings).find(([key]) => railwayDefinition(key)?.name.replace(/^(東京メトロ|都営|東急|東武|西武)/, "") === shortName);
  return match?.[1] ?? "";
}

export function trainTypeReading(japanese: string): string {
  return typeReadings[japanese] ?? "";
}

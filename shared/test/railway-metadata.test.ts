import assert from "node:assert/strict";
import { test } from "node:test";
import { externalStationCode, externalStationName, cachedDestinationCode } from "../browser-external-station-codes";
import { enrichCachedTimetables, normalizeRailway, type Cache } from "../browser-odpt-normalization";
import { normalizeStationEnglish, railwayReading, stationReading, trainTypeReading } from "../railway-readings";
import { stationAsset, unknownAsset } from "../assets";

test("through-service destination IDs resolve supplied Seibu, Tobu and Tokyu numbering", () => {
  const cases = [
    ["Seibu.Ikebukuro.Hanno", "SI26"], ["Seibu.Ikebukuro.Kotesashi", "SI19"], ["Seibu.Ikebukuro.ShakujiiKoen", "SI10"],
    ["Seibu.Ikebukuro.Hoya", "SI12"], ["Seibu.Ikebukuro.Kiyose", "SI15"], ["Seibu.SeibuChichibu.SeibuChichibu", "SI36"],
    ["Tobu.Tojo.ShinrinKoen", "TJ30"], ["Tobu.Tojo.Kawagoeshi", "TJ22"], ["Tobu.Tojo.Ogawamachi", "TJ33"],
    ["Tobu.Isesaki.Kuki", "TI02"], ["Tobu.Isesaki.KitaKoshigaya", "TS21"], ["Tobu.Isesaki.Takenotsuka", "TS14"],
    ["Tobu.Nikko.MinamiKurihashi", "TN03"], ["Tokyu.DenEnToshi.Saginuma", "DT14"], ["Tokyu.Toyoko.MusashiKosugi", "TY11"],
    ["Tokyu.Meguro.Hiyoshi", "MG13"], ["YokohamaMinatomiraiRailway.Minatomirai.MotomachiChukagai", "MM06"],
    ["Tokyu.ShinYokohama.ShinYokohama", "SH01"], ["Sotetsu.Main.Ebina", "SO18"], ["Sotetsu.Izumino.Shonandai", "SO37"],
  ];
  for (const [identity, code] of cases) {
    assert.equal(externalStationCode(`odpt.Station:${identity}`), code, identity);
    assert.notEqual(stationAsset(code), unknownAsset, code);
    const name = externalStationName(`odpt.Station:${identity}`);
    assert.ok(name, identity);
    assert.ok(stationReading(name), `${name} needs a Japanese reading`);
  }
  assert.equal(externalStationCode("odpt.Station:Seibu.Ikebukuro.KoteSashi"), "SI19", "ODPT capitalization variants are harmless");
  assert.equal(externalStationCode("odpt.Station:Unknown.Unknown.Hanno"), "", "never infer numbers from an unqualified terminal name");
});

test("live ODPT destinations without stationCode use qualified registry and normalize Oshiage English", () => {
  const railway = "odpt.Railway:TokyoMetro.Fukutoshin", station = "odpt.Station:TokyoMetro.Fukutoshin.Shibuya";
  const terminals = ["odpt.Station:Seibu.Ikebukuro.Hanno", "odpt.Station:Tobu.Tojo.ShinrinKoen", "odpt.Station:Tokyu.Toyoko.MusashiKosugi"];
  const table = normalizeRailway([{
    "odpt:railway": railway, "odpt:station": station, "odpt:railDirection": "odpt.RailDirection:TokyoMetro.Wakoshi", "odpt:calendar": "odpt.Calendar:Weekday",
    "odpt:stationTimetableObject": terminals.map((destination, index) => ({ "odpt:departureTime": `14:0${index}`, "odpt:destinationStation": [destination], "odpt:trainType": "odpt.TrainType:Tobu.SectionSemiExpress" })),
  }], [{ "owl:sameAs": station, "odpt:railway": railway, "odpt:stationTitle": { ja: "渋谷", en: "Shibuya" } }], []).timetables[0];
  assert.deepEqual(table.departures.map(row => row.destinationCodes), [["SI26"], ["TJ30"], ["TY11"]]);
  assert.deepEqual(table.departures.map(row => row.destination), ["飯能", "森林公園", "武蔵小杉"]);
  assert.equal(table.departures[0].type, "区間準急");
  assert.equal(trainTypeReading(table.departures[0].type), "くかんじゅんきゅう");
  assert.equal(normalizeStationEnglish("Oshiage<SKYTREE>"), "Oshiage'SKYTREE'");
});

test("old offline caches gain through-destination numbering and Oshiage spelling in memory", () => {
  const original = {
    fetchedAt: "2026-11-16T00:00:00Z", source: "cache", frequencySeconds: 60, lines: [], trainInformation: [],
    timetables: [{ railway: "odpt.Railway:TokyoMetro.Fukutoshin", station: "odpt.Station:TokyoMetro.Fukutoshin.Shibuya", stationCode: "F16",
      stationEnglish: "Shibuya", directionEnglish: "Oshiage<SKYTREE>", departures: [
        { destination: "飯能", destinationEnglish: "Hanno", destinationCodes: [], type: "RapidExpress" },
        { destination: "森林公園", destinationEnglish: "Shinrin-koen", destinationCodes: [], type: "Local" },
        { destination: "押上", destinationEnglish: "Oshiage<SKYTREE>", destinationCodes: [], type: "Local" },
      ] }],
  } as unknown as Cache;
  const upgraded = enrichCachedTimetables(original);
  assert.deepEqual(upgraded.timetables[0].departures.slice(0, 2).map(row => row.destinationCodes), [["SI26"], ["TJ30"]]);
  assert.equal(upgraded.timetables[0].departures[0].type, "快速急行");
  assert.equal(upgraded.timetables[0].departures[2].destinationEnglish, "Oshiage'SKYTREE'");
  assert.equal(upgraded.timetables[0].directionEnglish, "Oshiage'SKYTREE'");
  assert.equal(original.timetables[0].departures[0].destinationCodes.length, 0);
  assert.equal(original.timetables[0].departures[2].destinationEnglish, "Oshiage<SKYTREE>");
  assert.equal(cachedDestinationCode("odpt.Railway:Toei.Mita", "武蔵小杉", "Musashi-kosugi"), "MG11");
  assert.equal(cachedDestinationCode("odpt.Railway:TokyoMetro.Fukutoshin", "武蔵小杉", "Musashi-kosugi"), "TY11");
  assert.equal(cachedDestinationCode("odpt.Railway:TokyoMetro.Fukutoshin", "日吉", "Hiyoshi"), "TY13");
  assert.equal(cachedDestinationCode("odpt.Railway:TokyoMetro.Namboku", "日吉", "Hiyoshi"), "MG13");
  assert.equal(cachedDestinationCode("odpt.Railway:TokyoMetro.Fukutoshin", "横浜", "Yokohama"), "TY21");
});

test("line and service readings cover all display families and support romanized destinations", () => {
  for (const railway of ["TokyoMetro.Ginza", "TokyoMetro.Hanzomon", "TokyoMetro.Fukutoshin", "Toei.Asakusa", "MIR.TsukubaExpress", "YokohamaMunicipal.Green"]) {
    assert.match(railwayReading(`odpt.Railway:${railway}`), /^[\p{Script=Hiragana}ー\s]+$/u, railway);
  }
  for (const type of ["各駅停車", "特急", "通勤特急", "区間急行", "区間準急", "区間快速", "アクセス特急", "エアポート快特", "Fライナー", "S-TRAIN"]) {
    assert.ok(trainTypeReading(type), type);
  }
  assert.equal(stationReading("押上〈スカイツリー前〉", "Oshiage<SKYTREE>"), "おしあげ");
  assert.equal(stationReading("聖蹟桜ヶ丘", "Seiseki-sakuragaoka"), "せいせきさくらがおか");
  assert.equal(stationReading("新守谷", "Shin-moriya"), "しんもりや");
  assert.equal(stationReading("下り", "Outbound"), "くだり");
  assert.equal(stationReading("内回り", "Inner loop"), "うちまわり");
});

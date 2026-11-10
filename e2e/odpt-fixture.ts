// A catalog larger than the former 120-station cutoff; no external data requests.
const tx = "odpt.Railway:MIR.TsukubaExpress";
const ginza = "odpt.Railway:TokyoMetro.Ginza";
const direction = "odpt.RailDirection:Outbound";
const stations = Array.from({ length: 131 }, (_, index) => ({
  "owl:sameAs": `odpt.Station:MIR.TsukubaExpress.Test${index}`,
  "odpt:railway": tx,
  "odpt:stationTitle": { ja: `試験駅${String(index).padStart(3, "0")}`, en: `Test ${index}` },
  "odpt:stationCode": `TX${index}`,
}));
const ginzaStation = { "owl:sameAs": "odpt.Station:TokyoMetro.Ginza.Asakusa", "odpt:railway": ginza,
  "odpt:stationTitle": { ja: "浅草", en: "Asakusa" }, "odpt:stationCode": "G19" };

export function odptFixture(url: URL): object[] {
  const type = url.pathname.split("/").at(-1), operator = url.searchParams.get("odpt:operator");
  if (type === "odpt:Railway") {
    const id = operator === "odpt.Operator:MIR" ? tx : operator === "odpt.Operator:TokyoMetro" ? ginza : "";
    return id ? [{ "owl:sameAs": id, "odpt:railwayTitle": { ja: id === ginza ? "銀座線" : "つくばエクスプレス" }, "odpt:ascendingRailDirection": direction }] : [];
  }
  if (type === "odpt:Station") return !operator ? [...stations, ginzaStation]
    : operator === "odpt.Operator:MIR" ? stations : operator === "odpt.Operator:TokyoMetro" ? [ginzaStation] : [];
  if (type === "odpt:StationTimetable") return [...stations, ginzaStation]
    .filter(row => row["odpt:railway"] === url.searchParams.get("odpt:railway"))
    .map(row => ({ "owl:sameAs": `table:${row["owl:sameAs"]}`, "odpt:railway": row["odpt:railway"],
      "odpt:station": row["owl:sameAs"], "odpt:railDirection": direction, "odpt:calendar": "odpt.Calendar:Weekday",
      "odpt:stationTimetableObject": [{ "odpt:departureTime": "24:15", "odpt:destinationStation": [row["owl:sameAs"]] }] }));
  if (type === "odpt:BusroutePattern") return [{ "owl:sameAs": "odpt.BusroutePattern:Toei.Test", "odpt:busroute": "odpt.Busroute:Toei.Test", "dc:title": "テスト01", "odpt:busstopPoleOrder": [
    { "odpt:index": 1, "odpt:busstopPole": "odpt.BusstopPole:Toei.Test1", "odpt:note": "試験バス停" },
    { "odpt:index": 2, "odpt:busstopPole": "odpt.BusstopPole:Toei.Test2", "odpt:note": "終点" },
  ] }];
  return [];
}

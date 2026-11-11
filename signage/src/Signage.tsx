import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppHeader } from "../../shared/AppHeader";
import { railwayName, directionName, shortId } from "../../shared/railway";
import { railwayAsset, stationAsset, railwayColor, unknownAsset } from "../../shared/assets";
import { useSignageRuntime } from "./useSignageRuntime";
import { displayPages, japanTime, nextDepartures, timetableFor } from "./departures";
import { trainTypeColor } from "./train-types";
import { routeDisplaySettings, type DirectionDisplayMode } from "../../shared/display-settings";
import type { Facility, Timetable } from "./types";
import { SignageSharing } from "../../shared/live-preview";
import { useDisplayFont } from "../../shared/fonts";
import { estimateTravelMinutes } from "../../shared/travel-time";
import type { TravelSettings, TransitionStyle } from "../../shared/display-settings";
import { RichTicker } from "./RichTicker";
import { MediaDisplay } from "./MediaDisplay";

const readings: Record<string, string> = {
  半蔵門線: "とうきょうめとろ はんぞうもんせん",
  東京メトロ半蔵門線: "とうきょうめとろ はんぞうもんせん",
  渋谷: "しぶや",
  "押上〈スカイツリー前〉": "おしあげ〈スカイツリーまえ〉",
  押上: "おしあげ",
  中央林間: "ちゅうおうりんかん",
  長津田: "ながつた",
  久喜: "くき",
  南栗橋: "みなみくりはし",
  北越谷: "きたこしがや",
  住吉: "すみよし",
  浅草線: "とえい あさくさせん",
  三田線: "とえい みたせん",
  新宿線: "とえい しんじゅくせん",
  大江戸線: "とえい おおえどせん",
  千代田線: "とうきょうめとろ ちよだせん",
  副都心線: "とうきょうめとろ ふくとしんせん",
  日比谷線: "とうきょうめとろ ひびやせん",
  丸ノ内線: "とうきょうめとろ まるのうちせん",
  南北線: "とうきょうめとろ なんぼくせん",
  東西線: "とうきょうめとろ とうざいせん",
  有楽町線: "とうきょうめとろ ゆうらくちょうせん",
};

const typeReadings: Record<string, string> = {
  各駅停車: "かくえきていしゃ", 普通: "ふつう", 急行: "きゅうこう", 準急: "じゅんきゅう",
  快速: "かいそく", 快速急行: "かいそくきゅうこう", 通勤快速: "つうきんかいそく", 通勤急行: "つうきんきゅうこう",
};

function DepartureBoard({ selected, tables, now, showEnglish, fallbackMode, travel, transition }: {
  selected: Facility["selectedRoutes"][number]; tables: Timetable[]; now: Date; showEnglish: boolean; fallbackMode?: DirectionDisplayMode; travel?: TravelSettings; transition?: TransitionStyle;
}) {
  const options = routeDisplaySettings(selected, fallbackMode);
  const timetable = timetableFor(selected, tables, now);
  const route = timetable ?? tables.find(table => table.railway === selected.railway
    && table.station === selected.station && table.direction === selected.direction);
  const estimate = estimateTravelMinutes(travel, selected.stationLocation);
  const departures = nextDepartures(timetable, now, estimate.minutes);
  const bus = route?.mode === "bus" || selected.railway.startsWith("odpt.Busroute:");
  const name = railwayName(selected.railway, route?.railwayName ?? shortId(selected.railway));
  const direction = directionName(selected.direction, route?.directionName ?? shortId(selected.direction));
  const secondary = (japanese: string, english: string) => showEnglish ? english : (readings[japanese] ?? english);
  return <section className="departure-board" aria-label={`${name} ${direction}${bus ? "行き" : "方面"}`}
    style={{ "--line-color": railwayColor(selected.railway) } as CSSProperties}>
    <div className={`route-heading${!options.showLineName ? " hide-line-name" : ""}${!options.showDirection ? " hide-direction" : ""}`}>
      <img src={railwayAsset(selected.railway, route?.stationCode)} alt="" onError={event => { event.currentTarget.src = unknownAsset; }} />
      {options.showLineName && <div className="route-name"><h2>{name}</h2><p>{secondary(route?.railwayName ?? name, route?.railwayEnglish ?? "")}</p></div>}
      {options.showDirection && <div className="direction-name"><h2>{direction}{bus ? "行き" : "方面"}</h2><p>
        {showEnglish || !readings[route?.directionName ?? direction]
          ? `for ${route?.directionEnglish ?? direction}`
          : `${readings[route?.directionName ?? direction]}${bus ? "ゆき" : "ほうめん"}`}
      </p></div>}
    </div>
    {travel && travel.mode !== "off" && <p className="travel-estimate">{estimate.estimated ? "徒歩の目安" : "移動・余裕時間"} {estimate.minutes}分を含めて乗れる便{estimate.missingLocation ? "（位置情報なし・手動時間のみ）" : ""}</p>}
    <div className="departure-list" data-transition={transition ?? "fade"}>{departures.length ? departures.map((departure, index) => {
      const destinationIcon = departure.destinationCodes[0] ? stationAsset(departure.destinationCodes[0]) : "";
      const serviceColumn = options.showTrainType || options.showCarCount && departures.some(item => item.carCount);
      return <article key={`${departure.time}-${departure.trainNumber}-${index}`} className={!serviceColumn ? "without-train-type" : ""}>
        <time>{departure.time}</time>
        {serviceColumn && <div className={`train-type${options.showCarCount && departure.carCount ? " with-car-count" : ""}${!options.showTrainType ? " type-hidden" : ""}`}
          style={{ "--train-type-color": trainTypeColor(departure.type, selected.railway),
            "--type-scale": Math.min(1, 4 / Math.max(1, [...departure.type].length)) } as CSSProperties}>
          {options.showTrainType && <><strong>{departure.type}</strong><span>{showEnglish ? departure.typeEnglish : (typeReadings[departure.type] ?? departure.typeEnglish)}</span></>}
          {options.showCarCount && !!departure.carCount && <span className="car-count">{departure.carCount}{showEnglish ? " cars" : "両"}</span>}
        </div>}
        {destinationIcon && destinationIcon !== unknownAsset ? <img className="destination-code" src={destinationIcon} alt={departure.destinationCodes[0]}
          onError={event => { event.currentTarget.style.visibility = "hidden"; }} /> : <div className="destination-code-placeholder" />}
        <div className={`destination-name${departure.destination.length > 7 ? " long-destination" : ""}`}>
          <strong>{departure.destination}</strong><span>{secondary(departure.destination, departure.destinationEnglish)}</span>
        </div>
      </article>;
    }) : <div className="no-service">{timetable ? estimate.minutes > 0 ? "移動時間を含めて乗れる便がありません" : `本日の${bus ? "バス" : "列車"}の運行は終了しました` : "本日の時刻表がありません"}</div>}</div>
  </section>;
}

export function Signage() {
  const { facility, data, state, selectedOutput, outputMissing, connectionError, channel } = useSignageRuntime();
  const [now, setNow] = useState(() => japanTime(new Date()));
  const [rotationTick, setRotationTick] = useState(0);
  useEffect(() => {
    const clock = setInterval(() => setNow(japanTime(new Date())), 1000);
    const rotation = setInterval(
      () => setRotationTick((tick) => tick + 1),
      5000,
    );
    return () => {
      clearInterval(clock);
      clearInterval(rotation);
    };
  }, []);

  const pages = useMemo(() => displayPages(facility?.selectedRoutes ?? [], facility?.directionDisplayMode), [facility]);
  const page = pages[Math.floor(rotationTick / 4) % Math.max(pages.length, 1)] ?? [];
  const route = data?.timetables.find(table => table.railway === page[0]?.railway && table.station === page[0]?.station);
  const showEnglish = rotationTick % 2 === 1;
  const displayPaused = state?.displayEnabled === false || selectedOutput?.enabled === false;
  const tickerText = facility?.tickerText?.trim().replace(/\r?\n/g, "　") ?? "";
  const fontStyle = useDisplayFont(facility?.appearance);
  const media = facility?.media ?? [];
  const alternating = facility?.mediaLayout === "alternating";
  const showMedia = media.length > 0 && (!alternating || rotationTick % 6 >= 3 || !facility?.selectedRoutes.length);

  return (
    <><SignageSharing channel={channel} outputId={selectedOutput?.id} /><main style={fontStyle} data-font-preset={facility?.appearance?.preset ?? "gothic"} className={`signage${displayPaused ? " signage-paused" : ""}${tickerText && !displayPaused ? " has-ticker" : ""}`}>
      {!displayPaused && <AppHeader product="Signage" facilityName={facility?.facilityName}
        facilitySecondary={route && facility?.facilityName === `${route.stationName}駅`
          ? showEnglish ? `${route.stationEnglish} Station` : readings[route.stationName] ? `${readings[route.stationName]}えき` : `${route.stationEnglish} Station`
          : undefined}>
        <time>{now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
      </AppHeader>}
      {connectionError && <p className="signage-connection-error" role="status">{connectionError}</p>}
      {data?.stale && !connectionError && <p className="signage-connection-error" role="status">交通情報の更新に一部失敗したため、保存済みの時刻表を表示しています。{data.fetchedAt ? `最終取得: ${new Date(data.fetchedAt).toLocaleString("ja-JP")}` : ""}</p>}
      <div className={`signage-content${showMedia && !displayPaused ? alternating || !facility?.selectedRoutes.length ? " media-only" : " with-media" : ""}`}>
      {displayPaused ? <section className="signage-pause-message" aria-label="表示停止中">
        <h1>表示を停止しています</h1>
        <p>Controllerから表示を再開できます。</p>
      </section> : outputMissing ? <section className="odpt-empty"><h2>設備が見つかりません</h2><p>Controllerで設備を選び直してください。</p></section> : !facility?.selectedRoutes?.length ? (
        <section className="odpt-empty">
          <span>CONTROLLER</span>
          <h2>表示する路線を追加してください</h2>
          <p>路線・駅・方面を選択すると、ここに時刻表を表示します。</p>
        </section>
      ) : !data || data.source === "unavailable" ? (
        <section className="odpt-empty">
          <span>ODPT</span>
          <h2>データ接続中</h2>
          <p>{data?.error ?? "駅時刻表を取得しています。"}</p>
        </section>
      ) : (
        <div className={`departure-pages${page.length > 1 ? " combined" : ""}`}>
          {page.map(selected => <DepartureBoard key={`${selected.railway}-${selected.station}-${selected.direction}`}
            selected={selected} tables={data.timetables} now={now} showEnglish={showEnglish} fallbackMode={facility.directionDisplayMode} travel={facility.travel} transition={facility.transition} />)}
          {pages.length > 1 && <div className="page-indicator" aria-label="表示ページ">
            {Math.floor(rotationTick / 4) % pages.length + 1} / {pages.length}
          </div>}
        </div>
      )}
      {!!media.length && !displayPaused && !outputMissing && <MediaDisplay media={media} visible={showMedia} />}
      </div>
      {!displayPaused && !outputMissing && <RichTicker text={tickerText} ticker={facility?.ticker} />}
    </main></>
  );
}

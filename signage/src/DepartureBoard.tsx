import { useEffect, useRef, useState, type CSSProperties } from "react";
import { railwayName, directionName, shortId } from "../../shared/railway";
import { railwayAsset, stationAsset, railwayColor, unknownAsset } from "../../shared/assets";
import { nextDepartures, timetableFor } from "./departures";
import { trainTypeColor } from "./train-types";
import { routeDisplaySettings, type DirectionDisplayMode, type TravelSettings, type TransitionStyle, type SignagePart, type BoardTextField } from "../../shared/display-settings";
import type { Facility, Timetable, Departure } from "./types";
import { estimateTravelMinutes } from "../../shared/travel-time";
import { normalizeStationEnglish, railwayReading, stationReading, trainTypeReading } from "../../shared/railway-readings";
import { delayedTime } from "../../shared/service-status";
import { partTextStyle } from "../../shared/part-text-style";

export function DepartureBoard({ selected, tables, now, showEnglish, fallbackMode, travel, departureAnimation, fieldText, fieldStyles }: {
  selected: Facility["selectedRoutes"][number]; tables: Timetable[]; now: Date; showEnglish: boolean; fallbackMode?: DirectionDisplayMode; travel?: TravelSettings; departureAnimation?: TransitionStyle;
  fieldText?: SignagePart["fieldText"]; fieldStyles?: SignagePart["fieldStyles"];
}) {
  const options = routeDisplaySettings(selected, fallbackMode);
  const timetable = timetableFor(selected, tables, now);
  const route = timetable ?? tables.find(table => table.railway === selected.railway
    && table.station === selected.station && table.direction === selected.direction);
  const estimate = estimateTravelMinutes(travel, selected.stationLocation);
  const delay = selected.service?.status === "delayed" ? selected.service.delayMinutes : 0;
  const departures = nextDepartures(timetable, now, estimate.minutes, delay);
  const suspended = selected.service?.status === "suspended";
  const identity = (d: Departure) => `${d.time}|${d.trainNumber}|${d.destination}|${d.type}`;
  const previous = useRef(departures);
  const [leaving, setLeaving] = useState<Departure[]>([]);
  useEffect(() => {
    if (!timetable) { previous.current = []; setLeaving([]); return; }
    const removed = previous.current.filter(d => !departures.some(next => identity(next) === identity(d)));
    previous.current = departures;
    if (suspended) { setLeaving([]); return; }
    if (removed.length) setLeaving(removed);
  }, [departures.map(identity).join(";"), suspended, !!timetable]);
  useEffect(() => {
    if (!leaving.length) return;
    const timer = window.setTimeout(() => setLeaving([]), 700);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const bus = route?.mode === "bus" || selected.railway.startsWith("odpt.Busroute:");
  const name = railwayName(selected.railway, route?.railwayName ?? shortId(selected.railway));
  const direction = directionName(selected.direction, route?.directionName ?? shortId(selected.direction));
  const secondary = (japanese: string, english: string, identity = "") => showEnglish
    ? normalizeStationEnglish(english) : stationReading(japanese, english, identity);
  const field = (key: BoardTextField) => ({ "data-edit-field": key, style: fieldStyles?.[key] ? partTextStyle(fieldStyles[key]!) : undefined,
    className: fieldStyles?.[key]?.blink ? "ticker-blink" : undefined });
  return <section className="departure-board" aria-label={`${name} ${direction}${bus ? "行き" : "方面"}`}
    style={{ "--line-color": railwayColor(selected.railway) } as CSSProperties}>
    <div className={`route-heading${!options.showLineName ? " hide-line-name" : ""}${!options.showDirection ? " hide-direction" : ""}`}>
      <img src={railwayAsset(selected.railway, route?.stationCode)} alt="" onError={event => { event.currentTarget.src = unknownAsset; }} />
      {options.showLineName && <div className="route-name"><h2 {...field("lineName")}>{fieldText?.lineName ?? name}</h2><p {...field("lineSecondary")}>{fieldText?.lineSecondary ?? (showEnglish ? route?.railwayEnglish ?? "" : railwayReading(route?.railwayName ?? name) || railwayReading(selected.railway))}</p></div>}
      {options.showDirection && <div className="direction-name"><h2 {...field("directionName")}>{fieldText?.directionName ?? `${direction}${bus ? "行き" : "方面"}`}</h2><p {...field("directionSecondary")}>
        {fieldText?.directionSecondary ?? (showEnglish
          ? `for ${normalizeStationEnglish(route?.directionEnglish ?? direction)}`
          : `${stationReading(route?.directionName ?? direction, route?.directionEnglish, selected.direction)}${bus ? "ゆき" : "ほうめん"}`)}
      </p></div>}
    </div>
    {travel && travel.mode !== "off" && <p className="travel-estimate">{estimate.estimated ? "徒歩の目安" : "移動・余裕時間"} {estimate.minutes}分を含めて乗れる便{estimate.missingLocation ? "（位置情報なし・手動時間のみ）" : ""}</p>}
    {selected.service?.status !== "normal" && selected.service?.message && <p className="service-message">{selected.service.message}</p>}
    {suspended ? <div className="service-suspended" role="status"><strong>運転見合わせ</strong><span>{showEnglish ? "Service suspended" : "運転再開までお待ちください"}</span></div> : <div className="departure-list" data-departure-animation={departureAnimation ?? "slide"}>{[...leaving, ...departures].length ? [...leaving, ...departures].map((departure) => {
      const destinationIcon = departure.destinationCodes[0] ? stationAsset(departure.destinationCodes[0], departure.destinationStations?.[0] ?? selected.railway) : "";
      const serviceColumn = options.showTrainType || options.showCarCount && departures.some(item => item.carCount);
      const late = departure.delayMinutes ?? delay;
      return <article key={identity(departure)} data-leaving={leaving.some(d => identity(d) === identity(departure)) || undefined} className={!serviceColumn ? "without-train-type" : ""}>
        <time {...field("departureTime")} className={`${late > 0 ? "departure-delayed" : ""}${fieldStyles?.departureTime?.blink ? " ticker-blink" : ""}`} style={{ ...field("departureTime").style, ...(late > 0 ? { color: "#ffe04b" } : {}) }}>{departure.cancelled ? "運休" : late > 0 ? delayedTime(departure.time, late) : departure.time}
          {late > 0 && !departure.cancelled && <small>定刻 {departure.time} ＋{late}分</small>}
        </time>
        {serviceColumn && <div className={`train-type${options.showCarCount && departure.carCount ? " with-car-count" : ""}${!options.showTrainType ? " type-hidden" : ""}`}
          style={{ "--train-type-color": trainTypeColor(departure.type, selected.railway),
            "--type-scale": Math.min(1, 4 / Math.max(1, [...departure.type].length)) } as CSSProperties}>
          {options.showTrainType && <><strong {...field("trainType")}>{departure.type}</strong><span>{showEnglish ? departure.typeEnglish : trainTypeReading(departure.type)}</span></>}
          {options.showCarCount && !!departure.carCount && <span className="car-count">{departure.carCount}{showEnglish ? " cars" : "両"}</span>}
        </div>}
        {destinationIcon && destinationIcon !== unknownAsset ? <img className="destination-code" src={destinationIcon} alt={departure.destinationCodes[0]}
          onError={event => { event.currentTarget.style.visibility = "hidden"; }} /> : <div className="destination-code-placeholder" />}
        <div className={`destination-name${departure.destination.length > 7 ? " long-destination" : ""}`}>
          <strong {...field("destinationName")}>{departure.destination}</strong><span {...field("destinationSecondary")}>{secondary(departure.destination, departure.destinationEnglish, departure.destinationStations?.[0])}</span>
        </div>
      </article>;
    }) : <div className="no-service">{timetable ? estimate.minutes > 0 ? "移動時間を含めて乗れる便がありません" : `本日の${bus ? "バス" : "列車"}の運行は終了しました` : "本日の時刻表がありません"}</div>}</div>}
  </section>;
}

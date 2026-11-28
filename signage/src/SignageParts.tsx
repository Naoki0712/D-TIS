import type { CSSProperties } from "react";
import type { DisplaySettings, SignagePart } from "../../shared/display-settings";
import { defaultTextStyle } from "../../shared/signage-layout";
import { partTextStyle } from "../../shared/part-text-style";
import type { OdptData } from "./types";
import { DepartureBoard } from "./DepartureBoard";
import { RichTicker } from "./RichTicker";
import { MediaDisplay } from "./MediaDisplay";
import { displayPages } from "./departures";
import { FittedDepartureBoard } from "./FittedDepartureBoard";

export function partPosition(part: SignagePart): CSSProperties {
  return { left: `${part.x}%`, top: `${part.y}%`, width: `${part.width}%`, height: `${part.height}%` };
}

/** The editor and the physical display render the same parts. */
export function SignagePartContent({ part, settings, data, now, showEnglish = false, pageRoutes }: {
  part: SignagePart; settings: DisplaySettings; data: OdptData | null; now: Date; showEnglish?: boolean;
  pageRoutes?: DisplaySettings["selectedRoutes"];
}) {
  const style = { ...defaultTextStyle, ...part.style };
  const textStyle = partTextStyle(style);
  if (part.kind === "text" || part.kind === "clock") return <div className={`signage-part-text${style.blink ? " ticker-blink" : ""}`} style={textStyle}>
    {part.kind === "clock" ? now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : part.text || ""}
  </div>;
  if (part.kind === "ticker") return <RichTicker text={settings.tickerText} ticker={settings.ticker} />;
  if (part.kind === "media") {
    const media = settings.media?.filter(item => !part.mediaId || item.id === part.mediaId) ?? [];
    return media.length ? <MediaDisplay media={media} transition={settings.transition} /> : <p className="part-placeholder">クイック設定で写真・動画を追加してください</p>;
  }
  const routes = part.routeIndex === undefined ? pageRoutes ?? displayPages(settings.selectedRoutes, settings.directionDisplayMode)[0] ?? [] : settings.selectedRoutes.slice(part.routeIndex, part.routeIndex + 1);
  return routes.length ? <div className={`departure-pages layout-departure-pages${routes.length > 1 ? " combined" : ""}`} style={{ gridTemplateRows: `repeat(${routes.length}, minmax(0, 1fr))` }}>{routes.map(selected => <FittedDepartureBoard key={`${selected.railway}|${selected.station}|${selected.direction}`}><DepartureBoard
    selected={selected} tables={data?.timetables ?? []} now={now} showEnglish={showEnglish} fallbackMode={settings.directionDisplayMode}
    travel={settings.travel} departureAnimation={settings.departureAnimation} fieldText={part.fieldText} fieldStyles={part.fieldStyles} /></FittedDepartureBoard>)}</div> : <p className="part-placeholder">クイック設定で路線・乗り物を追加してください</p>;
}

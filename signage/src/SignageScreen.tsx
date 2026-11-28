import type { CSSProperties, ReactNode, Ref } from "react";
import type { DisplaySettings } from "../../shared/display-settings";
import { effectiveLayout } from "../../shared/signage-layout";
import { shortId } from "../../shared/railway";
import { normalizeStationEnglish, stationReading } from "../../shared/railway-readings";
import type { OdptData } from "./types";
import { partPosition, SignagePartContent } from "./SignageParts";
import { displayPages } from "./departures";
import "../../shared/signage-layout.css";

/** The same complete screen is the default display and the editor's starting point. */
export function SignageScreen({ settings, data, now, pageRoutes, showEnglish = false, rotationTick = 0, children, stageRef, editing = false, grid = false, style }: {
  settings: DisplaySettings; data: OdptData | null; now: Date; pageRoutes: DisplaySettings["selectedRoutes"];
  showEnglish?: boolean; rotationTick?: number; children?: ReactNode; stageRef?: Ref<HTMLDivElement>; editing?: boolean; grid?: boolean; style?: CSSProperties;
}) {
  const first = pageRoutes[0];
  const route = data?.timetables.find(t => t.railway === first?.railway && t.station === first?.station);
  const station = route?.stationName || (first ? shortId(first.station) : "");
  const secondary = station && (showEnglish ? `${normalizeStationEnglish(route?.stationEnglish || shortId(first.station))} Station` : `${stationReading(station, route?.stationEnglish, first?.station)}えき`);
  const key = `${pageRoutes.map(r => `${r.railway}|${r.station}|${r.direction}`).join(";")}|${showEnglish}`;
  const alternating = settings.mediaLayout === "alternating" && !!settings.media?.length;
  const mediaPhase = !settings.selectedRoutes.length || rotationTick % 6 >= 3;
  const pages = displayPages(settings.selectedRoutes, settings.directionDisplayMode);
  const pageIndex = Math.max(0, pages.findIndex(routes => routes.some(r => r.railway === first?.railway && r.station === first?.station && r.direction === first?.direction)));
  return <div className={`signage-layout-surface signage-screen${editing ? " editor-canvas" : ""}`} style={style} aria-label={editing ? "Signageの編集キャンバス" : "Signageの表示画面"}>
    <div className="signage-display-header">
      {station && <div className="app-facility" aria-label="駅名"><strong>{station}{station.endsWith("駅") ? "" : "駅"}</strong><span>{secondary}</span></div>}
      <time>{now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
    </div>
    <div ref={stageRef} className={`layout-parts-stage${grid ? " show-grid" : ""}`} aria-label={editing ? "パーツ配置領域" : undefined}>
      {children ?? effectiveLayout(settings).parts.map(part => <div key={part.kind === "departures" ? `${part.id}|${key}` : part.id} className="signage-layout-part" style={partPosition(part)}
        hidden={alternating && (part.kind === "media" ? !mediaPhase : part.kind === "departures" && mediaPhase)}>
        <SignagePartContent part={part} settings={settings} data={data} now={now} showEnglish={showEnglish} pageRoutes={pageRoutes} />
      </div>)}
      {pages.length > 1 && <div className="page-indicator screen-page-indicator" aria-label="表示ページ">{pageIndex + 1} / {pages.length}</div>}
    </div>
  </div>;
}

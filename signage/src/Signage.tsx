import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "../../shared/AppHeader";
import { SignageDisconnectButton } from "../../shared/CloudSetup";
import { shortId } from "../../shared/railway";
import { useSignageRuntime } from "./useSignageRuntime";
import { displayPages, japanTime } from "./departures";
import { SignageSharing } from "../../shared/live-preview";
import { useDisplayFont } from "../../shared/fonts";
import { RichTicker } from "./RichTicker";
import { MediaDisplay } from "./MediaDisplay";
import { DepartureBoard } from "./DepartureBoard";
import { SignagePartContent, partPosition } from "./SignageParts";
import "../../shared/signage-layout.css";
import { normalizeStationEnglish, stationReading } from "../../shared/railway-readings";


export function Signage() {
  const { facility, data, state, selectedOutput, outputMissing, connectionError, channel } = useSignageRuntime();
  const [now, setNow] = useState(() => japanTime(new Date()));
  const [rotationTick, setRotationTick] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    // Base the board's vertical sizing on the space left by the station header and ticker.
    const observer = new ResizeObserver(() => {
      element.parentElement?.style.setProperty("--board-unit", `${element.clientHeight / 100}px`);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
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
  const hasTicker = !!tickerText || !!facility?.ticker?.segments.some(segment => segment.text.trim());
  const stationName = route?.stationName || (page[0] ? shortId(page[0].station) : "");
  const stationSecondary = stationName && (showEnglish
    ? `${normalizeStationEnglish(route?.stationEnglish || shortId(page[0].station))} Station`
    : `${stationReading(stationName, route?.stationEnglish, page[0]?.station)}えき`);
  const fontStyle = useDisplayFont(facility?.appearance);
  const media = facility?.media ?? [];
  const alternating = facility?.mediaLayout === "alternating";
  const showMedia = media.length > 0 && (!alternating || rotationTick % 6 >= 3 || !facility?.selectedRoutes.length);
  const customLayout = facility?.layout;
  const routePageKey = `${page.map(r => `${r.railway}|${r.station}|${r.direction}`).join(";")}|${showEnglish}`;
  const pageKey = `${routePageKey}|${showMedia}`;

  return (
    <><SignageSharing channel={channel} outputId={selectedOutput?.id} /><main style={fontStyle} data-font-preset={facility?.appearance?.preset ?? "gothic"} data-ticker-size={facility?.ticker?.size ?? "medium"} className={`signage${displayPaused ? " signage-paused" : ""}${hasTicker && !displayPaused && !customLayout ? " has-ticker" : ""}`}>
      {!displayPaused && <>
        <AppHeader product="Signage" collapsible>
          <span className="signage-menu-name" title={selectedOutput?.name || state?.hostname}>デバイス名：{selectedOutput?.name || state?.hostname || "接続中…"}</span>
          <SignageDisconnectButton />
        </AppHeader>
        <div className="signage-display-header">
          {stationName && <div className="app-facility" aria-label="駅名">
            <strong>{stationName}{stationName.endsWith("駅") ? "" : "駅"}</strong>
            {stationSecondary && <span>{stationSecondary}</span>}
          </div>}
          <time>{now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
      </>}
      {connectionError && <p className="signage-connection-error" role="status">{connectionError}</p>}
      {data?.stale && !connectionError && <p className="signage-connection-error" role="status">交通情報の更新に一部失敗したため、保存済みの時刻表を表示しています。{data.fetchedAt ? `最終取得: ${new Date(data.fetchedAt).toLocaleString("ja-JP")}` : ""}</p>}
      <div ref={content} className={`signage-content${customLayout && !displayPaused ? " custom-layout" : showMedia && !displayPaused ? alternating || !facility?.selectedRoutes.length ? " media-only" : " with-media" : ""}`}>
      {displayPaused ? <section className="signage-pause-message" aria-label="表示停止中">
        <h1>表示を停止しています</h1>
        <p>Controllerから表示を再開できます。</p>
      </section> : outputMissing ? <section className="odpt-empty"><h2>設備が見つかりません</h2><p>Controllerで設備を選び直してください。</p></section> : customLayout && facility ? <div className="signage-layout-surface" data-page-transition={facility.transition ?? "fade"}>
        {customLayout.parts.map(part => <div key={part.kind === "departures" ? `${part.id}|${routePageKey}` : part.id} className="signage-layout-part" style={partPosition(part)} data-page-transition={part.kind === "departures" ? facility.transition ?? "fade" : undefined}>
          <SignagePartContent part={part} settings={facility} data={data} now={now} showEnglish={showEnglish} pageRoutes={page} />
        </div>)}
      </div> : !facility?.selectedRoutes?.length ? (
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
        <div key={pageKey} className={`departure-pages${page.length > 1 ? " combined" : ""}`} data-page-transition={facility.transition ?? "fade"}>
          {page.map(selected => <DepartureBoard key={`${selected.railway}-${selected.station}-${selected.direction}`}
            selected={selected} tables={data.timetables} now={now} showEnglish={showEnglish} fallbackMode={facility.directionDisplayMode} travel={facility.travel} departureAnimation={facility.departureAnimation} />)}
          {pages.length > 1 && <div className="page-indicator" aria-label="表示ページ">
            {Math.floor(rotationTick / 4) % pages.length + 1} / {pages.length}
          </div>}
        </div>
      )}
      {!!media.length && !displayPaused && !outputMissing && !customLayout && <MediaDisplay media={media} visible={showMedia} transition={facility?.transition} />}
      </div>
      {!displayPaused && !outputMissing && !customLayout && <RichTicker text={tickerText} ticker={facility?.ticker} />}
    </main></>
  );
}

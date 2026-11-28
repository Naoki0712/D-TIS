import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "../../shared/AppHeader";
import { SignageDisconnectButton } from "../../shared/CloudSetup";
import { useSignageRuntime } from "./useSignageRuntime";
import { displayPages, japanTime } from "./departures";
import { SignageSharing } from "../../shared/live-preview";
import { useDisplayFont } from "../../shared/fonts";
import { SignageScreen } from "./SignageScreen";


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
  const showEnglish = rotationTick % 2 === 1;
  const displayPaused = state?.displayEnabled === false || selectedOutput?.enabled === false;
  const fontStyle = useDisplayFont(facility?.appearance);

  return (
    <><SignageSharing channel={channel} outputId={selectedOutput?.id} /><main style={fontStyle} data-font-preset={facility?.appearance?.preset ?? "gothic"} data-ticker-size={facility?.ticker?.size ?? "medium"} className={`signage${displayPaused ? " signage-paused" : ""}`}>
      {!displayPaused && <AppHeader product="Signage" collapsible>
        <span className="signage-menu-name" title={selectedOutput?.name || state?.hostname}>デバイス名：{selectedOutput?.name || state?.hostname || "接続中…"}</span>
        <SignageDisconnectButton />
      </AppHeader>}
      {connectionError && <p className="signage-connection-error" role="status">{connectionError}</p>}
      {data?.stale && !connectionError && <p className="signage-connection-error" role="status">交通情報の更新に一部失敗したため、保存済みの時刻表を表示しています。{data.fetchedAt ? `最終取得: ${new Date(data.fetchedAt).toLocaleString("ja-JP")}` : ""}</p>}
      <div ref={content} className="signage-content unified-layout">
      {displayPaused ? <section className="signage-pause-message" aria-label="表示停止中"><h1>表示を停止しています</h1><p>Controllerから表示を再開できます。</p></section>
        : outputMissing ? <section className="odpt-empty"><h2>設備が見つかりません</h2><p>Controllerで設備を選び直してください。</p></section>
        : facility ? <SignageScreen settings={facility} data={data} now={now} pageRoutes={page} showEnglish={showEnglish} rotationTick={rotationTick} /> : null}
      </div>
    </main></>
  );
}

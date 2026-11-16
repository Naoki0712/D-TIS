import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { railwayColor } from "../../shared/railway";
import type { StationChoice } from "./catalog";
import { fitStationMap, locatedStationChoices, MAX_MAP_ZOOM, MIN_MAP_ZOOM, projectLocation, unprojectLocation, type MapView } from "./route-map";
import "./route-map.css";

export function StationMap({ stations, selected, onSelect }: {
  stations: StationChoice[]; selected?: StationChoice; onSelect(station: StationChoice): void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; center: { x: number; y: number }; zoom: number } | undefined>(undefined);
  const [size, setSize] = useState({ width: 640, height: 360 });
  const located = useMemo(() => locatedStationChoices(stations), [stations]);
  const [view, setView] = useState<MapView>(() => fitStationMap(located, 640, 360));
  const [tileError, setTileError] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [!!located.length]);
  useEffect(() => { setView(fitStationMap(located, size.width, size.height)); }, [located, size]);

  const center = projectLocation(view.center, view.zoom);
  const origin = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  const screen = (location: { latitude: number; longitude: number }) => {
    const point = projectLocation(location, view.zoom);
    return { x: point.x - origin.x, y: point.y - origin.y };
  };
  const visible = located.map(station => ({ station, ...screen(station.location) }))
    .filter(point => point.x >= -24 && point.x <= size.width + 24 && point.y >= -24 && point.y <= size.height + 24);
  const labels = new Set<string>(), cells = new Set<string>();
  for (const point of visible) {
    const cell = `${Math.floor(point.x / 95)}|${Math.floor(point.y / 40)}`;
    if (!cells.has(cell) || selected?.name === point.station.name) { labels.add(point.station.name); cells.add(cell); }
  }
  const tiles = [];
  const tileCount = 2 ** view.zoom;
  for (let y = Math.max(0, Math.floor(origin.y / 256)); y <= Math.min(tileCount - 1, Math.floor((origin.y + size.height) / 256)); y++) {
    for (let x = Math.max(0, Math.floor(origin.x / 256)); x <= Math.min(tileCount - 1, Math.floor((origin.x + size.width) / 256)); x++) {
      tiles.push({ key: `${view.zoom}/${x}/${y}`, x: x * 256 - origin.x, y: y * 256 - origin.y });
    }
  }

  function zoomBy(delta: number) {
    setView(previous => ({ ...previous, zoom: Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, previous.zoom + delta)) }));
  }
  function panBy(x: number, y: number) {
    setView(previous => {
      const point = projectLocation(previous.center, previous.zoom), scale = 256 * 2 ** previous.zoom;
      return { ...previous, center: unprojectLocation({ x: Math.max(0, Math.min(scale, point.x + x)), y: Math.max(0, Math.min(scale, point.y + y)) }, previous.zoom) };
    });
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a")) return;
    drag.current = { x: event.clientX, y: event.clientY, center, zoom: view.zoom };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    const scale = 256 * 2 ** start.zoom;
    setView({ zoom: start.zoom, center: unprojectLocation({
      x: Math.max(0, Math.min(scale, start.center.x - (event.clientX - start.x))),
      y: Math.max(0, Math.min(scale, start.center.y - (event.clientY - start.y))),
    }, start.zoom) });
  }
  function stopDrag() { drag.current = undefined; setDragging(false); }

  if (!located.length) return <div className="station-map-empty" role="status"><strong>地図に表示できる駅の位置情報がありません</strong><p>「駅名から選ぶ」から駅・停留所を検索してください。</p></div>;
  return <div className="station-map-section">
    <p className="station-map-help">駅の丸印を選択してください。ドラッグで移動、＋／−で拡大・縮小できます。</p>
    <div ref={canvas} className={`station-map${dragging ? " dragging" : ""}`} role="region" aria-label="駅・停留所を選択する地図" tabIndex={0}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) event.preventDefault();
        if (event.key === "ArrowLeft") panBy(-80, 0); else if (event.key === "ArrowRight") panBy(80, 0);
        else if (event.key === "ArrowUp") panBy(0, -80); else if (event.key === "ArrowDown") panBy(0, 80);
        else if (event.key === "+" || event.key === "=") zoomBy(1); else if (event.key === "-") zoomBy(-1);
      }}>
      <div className="station-map-tiles" aria-hidden="true">{tiles.map(tile => <img key={tile.key}
        src={`https://tile.openstreetmap.org/${tile.key}.png`} alt="" draggable={false} referrerPolicy="strict-origin-when-cross-origin"
        style={{ left: tile.x, top: tile.y }} onError={() => setTileError(true)} />)}</div>
      {visible.map(({ station, x, y }) => <button type="button" key={station.name} className={`station-map-pin${selected?.name === station.name ? " selected" : ""}`}
        aria-label={`地図で${station.name}を選択`} aria-pressed={selected?.name === station.name} title={`${station.name} · ${station.matches.map(match => match.line.name).join(" / ")}`}
        style={{ left: x, top: y, "--station-color": railwayColor(station.matches[0].line.id) } as React.CSSProperties}
        onClick={() => onSelect(station)}><span className="station-map-dot" />{labels.has(station.name) && <span className="station-map-label">{station.name}</span>}</button>)}
      <div className="station-map-controls" aria-label="地図の操作"><button type="button" aria-label="地図を拡大" disabled={view.zoom >= MAX_MAP_ZOOM} onClick={() => zoomBy(1)}>＋</button>
        <button type="button" aria-label="地図を縮小" disabled={view.zoom <= MIN_MAP_ZOOM} onClick={() => zoomBy(-1)}>−</button>
        <button type="button" className="station-map-fit" onClick={() => setView(fitStationMap(located, size.width, size.height))}>全体</button></div>
      <a className="station-map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
    </div>
    <p className="station-map-caption" role="status">{located.length}駅・停留所を地図に表示{stations.length > located.length ? `（位置情報のない${stations.length - located.length}件は駅名検索で選択できます）` : ""}
      {tileError && <span>背景地図を読み込めません。駅の丸印から選択できます。</span>}</p>
  </div>;
}

import { useRef, useState, type PointerEvent } from "react";
import type { DisplaySettings, PartTextStyle, SignageLayout, SignagePart, BoardTextField } from "../../shared/display-settings";
import { boardTextNames, defaultTextStyle, effectiveLayout, fitPart, initialLayout, partNames, snap } from "../../shared/signage-layout";
import { SignagePartContent, partPosition } from "../../signage/src/SignageParts";
import { displayPages, japanTime } from "../../signage/src/departures";
import type { OdptData } from "../../signage/src/types";
import { useDisplayFont } from "../../shared/fonts";
import { TickerEditor } from "./TickerEditor";
import { SignageScreen } from "../../signage/src/SignageScreen";
import "../../shared/signage-layout.css";
import "../../signage/src/styles.css";
import "../../signage/src/studio.css";

export function LayoutEditor({ settings, data, disabled, onChange }: {
  settings: DisplaySettings; data: OdptData | null; disabled: boolean; onChange(settings: DisplaySettings): void;
}) {
  const layout = effectiveLayout(settings);
  const [selectedId, setSelectedId] = useState("");
  const [selectedField, setSelectedField] = useState<BoardTextField | null>(null);
  const [fieldDefault, setFieldDefault] = useState(defaultTextStyle);
  const [grid, setGrid] = useState(true);
  const [previewMedia, setPreviewMedia] = useState(false);
  const layers = useRef<HTMLDetailsElement>(null);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const previewPages = displayPages(settings.selectedRoutes, settings.directionDisplayMode);
  const previewPage = Math.min(previewPageIndex, Math.max(0, previewPages.length - 1));
  const [historyVersion, setHistoryVersion] = useState(0);
  const history = useRef<{ past: SignageLayout[]; future: SignageLayout[] }>({ past: [], future: [] });
  const latest = useRef({ settings, layout, onChange }); latest.current = { settings, layout, onChange };
  const canvas = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ part: SignagePart; layout: SignageLayout; x: number; y: number; width: number; height: number; resize: boolean; moved: boolean } | null>(null);
  const selected = layout.parts.find(p => p.id === selectedId);
  const textStyle = selectedField ? { ...fieldDefault, ...selected?.fieldStyles?.[selectedField] } : { ...defaultTextStyle, ...selected?.style };
  const fontStyle = useDisplayFont(settings.appearance);
  function commit(next: SignageLayout, remember = true) {
    if (disabled) return;
    if (remember) { history.current.past.push(latest.current.layout); history.current.past = history.current.past.slice(-100); history.current.future = []; }
    latest.current.onChange({ ...latest.current.settings, layout: next }); setHistoryVersion(v => v + 1);
  }
  function patch(patch: Partial<SignagePart>) {
    commit({ parts: latest.current.layout.parts.map(p => p.id === selectedId ? fitPart({ ...p, ...patch }) : p) });
  }
  function style(patchStyle: Partial<PartTextStyle>) {
    const next = { ...textStyle, ...patchStyle }; if (next.font === "mincho") next.weight = 400;
    patch(selectedField ? { fieldStyles: { ...selected?.fieldStyles, [selectedField]: next } } : { style: next });
  }
  function add(kind: SignagePart["kind"]) {
    if (layout.parts.length >= 50) return;
    const id = crypto.randomUUID();
    const size = kind === "departures" ? { width: 96, height: 72 } : kind === "ticker" ? { width: 96, height: 12 } : { width: 40, height: 24 };
    commit({ parts: [...layout.parts, { id, kind, x: 2, y: 2, ...size, ...(kind === "text" ? { text: "テキストを入力", style: defaultTextStyle } : {}) }] });
    setSelectedId(id); setSelectedField(null);
  }
  function undo(redo = false) {
    const source = redo ? history.current.future : history.current.past, target = redo ? history.current.past : history.current.future;
    const next = source.pop(); if (!next) return; target.push(latest.current.layout); commit(next, false);
  }
  function start(event: PointerEvent<HTMLDivElement>, part: SignagePart, resize = false) {
    if (disabled || event.button !== 0) return;
    event.stopPropagation(); event.preventDefault(); setSelectedId(part.id); event.currentTarget.focus({ preventScroll: true });
    if (!resize) {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-edit-field]");
      setSelectedField(target?.dataset.editField as BoardTextField || null);
      if (target) {
        const computed = getComputedStyle(target), rgb = computed.color.match(/\d+/g);
        const designWidth = target.closest<HTMLElement>(".layout-board-design")?.clientWidth || event.currentTarget.getBoundingClientRect().width;
        setFieldDefault({ ...defaultTextStyle, fontSize: Math.max(12,Math.min(240,Math.round(parseFloat(computed.fontSize) * 1600 / designWidth))),
          color: rgb ? `#${rgb.slice(0,3).map(n => Number(n).toString(16).padStart(2,"0")).join("")}` : "#ffffff", weight: Number(computed.fontWeight) >= 600 ? 700 : 400 });
      }
    }
    const bounds = canvas.current!.getBoundingClientRect();
    dragging.current = { part, layout: latest.current.layout, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, resize, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = dragging.current; if (!drag || disabled) return;
    const dx = (event.clientX - drag.x) / drag.width * 100, dy = (event.clientY - drag.y) / drag.height * 100;
    if (Math.abs(dx) + Math.abs(dy) < .2 && !drag.moved) return;
    drag.moved = true;
    const part = fitPart({ ...drag.part, ...(drag.resize ? { width: snap(drag.part.width + dx), height: snap(drag.part.height + dy) } : { x: snap(drag.part.x + dx), y: snap(drag.part.y + dy) }) });
    commit({ parts: latest.current.layout.parts.map(p => p.id === part.id ? part : p) }, false);
  }
  function finish() {
    const drag = dragging.current;
    if (drag?.moved) { history.current.past.push(drag.layout); history.current.past = history.current.past.slice(-100); history.current.future = []; setHistoryVersion(v => v + 1); }
    dragging.current = null;
  }
  return <section className="layout-editor" aria-label="Signageレイアウトエディター" data-history={historyVersion}>
    <aside className="parts-palette" aria-label="編集メニュー"><div className="palette-add-row"><h2>パーツ</h2>
      {(Object.keys(partNames) as SignagePart["kind"][]).map(kind => <button type="button" key={kind} disabled={disabled || layout.parts.length >= 50} onClick={() => add(kind)}>＋ {partNames[kind]}</button>)}
      </div><div className="palette-tools-row">
      <label className="studio-check"><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} />グリッドを表示</label>
      <div className="layout-history"><button type="button" disabled={disabled || !history.current.past.length} onClick={() => undo()}>元に戻す</button><button type="button" disabled={disabled || !history.current.future.length} onClick={() => undo(true)}>やり直す</button></div>
      <button type="button" disabled={disabled || !settings.layout} onClick={() => { commit(initialLayout(settings)); setSelectedId(""); }}>初期配置に戻す</button>
      <details ref={layers} className="palette-layers"><summary>レイヤー</summary><ol className="part-layers">{layout.parts.map((p, index) => <li key={p.id}><button type="button" aria-pressed={selectedId === p.id} onClick={() => { setSelectedId(p.id); setSelectedField(null); if (p.kind === "media") setPreviewMedia(true); if (p.kind === "departures") setPreviewMedia(false); layers.current?.removeAttribute("open"); }}>{index + 1}. {p.kind === "text" ? p.text?.slice(0, 16) || "テキスト" : partNames[p.kind]}</button></li>)}</ol></details>
      </div>
    </aside>
    <div className="layout-workspace">
      {settings.mediaLayout === "alternating" && !!settings.media?.length && <label className="layout-preview-page">表示内容<select aria-label="プレビューの表示内容" value={previewMedia ? "media" : "departures"} onChange={e => setPreviewMedia(e.target.value === "media")}><option value="departures">交通案内</option><option value="media">写真・動画</option></select></label>}
      {previewPages.length > 1 && <label className="layout-preview-page">編集する表示ページ<select aria-label="編集する表示ページ" value={previewPage} onChange={e => { setPreviewPageIndex(Number(e.target.value)); setSelectedId(""); setSelectedField(null); }}>
        {previewPages.map((routes, index) => <option key={index} value={index}>{index + 1} / {previewPages.length} · {routes.map(route => data?.timetables.find(t => t.railway === route.railway && t.station === route.station && t.direction === route.direction)?.directionName || route.direction.split(".").at(-1)).join("・")}</option>)}
      </select></label>}
      {selected ? <div className="part-popover" role="region" aria-label="選択したパーツの編集"><div className="part-toolbar" role="toolbar" aria-label="パーツの書式">
        <strong>{selectedField ? boardTextNames[selectedField] : partNames[selected.kind]}</strong>
        {(selected.kind === "text" || selected.kind === "clock" || selectedField) && <>
          <label>書体<select value={textStyle.font} disabled={disabled} onChange={e => style({ font: e.target.value as PartTextStyle["font"] })}><option value="gothic">BIZ UDPゴシック</option><option value="mincho">BIZ UDP明朝</option>{settings.appearance?.customFont && <option value="custom">{settings.appearance.customFont.family}</option>}</select></label>
          <label>文字サイズ<input type="number" min={12} max={240} value={textStyle.fontSize} disabled={disabled} onChange={e => style({ fontSize: Math.max(12, Math.min(240, Number(e.target.value))) })} /></label>
          <label>文字色<input type="color" value={textStyle.color} disabled={disabled} onChange={e => style({ color: e.target.value })} /></label>
          <button type="button" aria-label="太字" aria-pressed={textStyle.weight === 700} disabled={disabled || textStyle.font === "mincho"} onClick={() => style({ weight: textStyle.weight === 700 ? 400 : 700 })}><b>B</b></button>
          <button type="button" aria-label="斜体" aria-pressed={textStyle.italic} disabled={disabled} onClick={() => style({ italic: !textStyle.italic })}><i>I</i></button>
          <button type="button" aria-label="下線" aria-pressed={textStyle.underline} disabled={disabled} onClick={() => style({ underline: !textStyle.underline })}><u>U</u></button>
          <label>文字揃え<select value={textStyle.align} disabled={disabled} onChange={e => style({ align: e.target.value as PartTextStyle["align"] })}><option value="left">左揃え</option><option value="center">中央揃え</option><option value="right">右揃え</option></select></label>
          <label className="studio-check"><input type="checkbox" checked={textStyle.blink} disabled={disabled} onChange={e => style({ blink: e.target.checked })} />点滅</label>
        </>}
        <button type="button" disabled={disabled || layout.parts.length >= 50} onClick={() => { const id = crypto.randomUUID(); commit({ parts: [...layout.parts, fitPart({ ...selected, id, x: selected.x + 2, y: selected.y + 2 })] }); setSelectedId(id); }}>複製</button>
        <button type="button" disabled={disabled} onClick={() => commit({ parts: [...layout.parts.filter(p => p.id !== selected.id), selected] })}>最前面へ</button>
        <button type="button" disabled={disabled} onClick={() => commit({ parts: [selected, ...layout.parts.filter(p => p.id !== selected.id)] })}>最背面へ</button>
        <button type="button" disabled={disabled} onClick={() => { commit({ parts: layout.parts.filter(p => p.id !== selected.id) }); setSelectedId(""); }}>削除</button>
        <button type="button" aria-label="パーツの選択を解除" onClick={() => setSelectedId("")}>×</button>
      </div>
      {selected.kind === "text" && <label className="part-text-input">テキスト<textarea aria-label="テキスト" maxLength={2000} value={selected.text ?? ""} disabled={disabled} onChange={e => patch({ text: e.target.value })} /></label>}
      {selected.kind === "departures" && selectedField && ["lineName","lineSecondary","directionName","directionSecondary"].includes(selectedField) && <label className="part-text-input">表示テキスト<input maxLength={200} placeholder="空欄に戻すと交通データの表記を使います" value={selected.fieldText?.[selectedField] ?? ""} disabled={disabled} onChange={e => { const fieldText = { ...selected.fieldText }; if (e.target.value) fieldText[selectedField] = e.target.value; else delete fieldText[selectedField]; patch({ fieldText }); }} /></label>}
      {selected.kind === "departures" && <p className="field-edit-help">キャンバス内の路線名・時刻・行き先などを選ぶと、その文字の書式を編集できます。</p>}
      {selected.kind === "departures" && <label className="part-source">表示する発車案内<select disabled={disabled} value={selected.routeIndex ?? "auto"} onChange={e => patch({ routeIndex: e.target.value === "auto" ? undefined : Number(e.target.value) })}><option value="auto">登録した路線を自動で切り替え</option>{settings.selectedRoutes.map((route, index) => <option value={index} key={index}>{data?.timetables.find(t => t.railway === route.railway && t.station === route.station)?.railwayName || route.railway.split(".").at(-1)} / {route.direction.split(".").at(-1)}</option>)}</select></label>}
      {selected.kind === "media" && <label className="part-source">表示する写真・動画<select disabled={disabled} value={selected.mediaId ?? ""} onChange={e => patch({ mediaId: e.target.value || undefined })}><option value="">すべて順番に表示</option>{settings.media?.map(item => <option value={item.id} key={item.id}>{item.alt || item.kind}</option>)}</select></label>}
      {selected.kind === "ticker" && <details className="part-ticker-options"><summary>スクロール文の文字・点滅を編集</summary><TickerEditor settings={settings} disabled={disabled} onChange={onChange} /></details>}
      <details className="part-geometry"><summary>位置と大きさ</summary><div>{([['x','左から'],['y','上から'],['width','幅'],['height','高さ']] as const).map(([key,label]) => <label key={key}>{label}（%）<input type="number" min={key === "width" ? 8 : key === "height" ? 6 : 0} max={100} step={2} value={selected[key]} disabled={disabled} onChange={e => patch({ [key]: Number(e.target.value) })} /></label>)}</div></details>
      </div> : <p className="canvas-hint">パーツを選ぶと、文字・配置の編集メニューが開きます。16:9 / 2%刻み</p>}
      <SignageScreen settings={settings} data={data} now={japanTime(new Date())} pageRoutes={previewPages[previewPage] ?? []} editing grid={grid} stageRef={canvas} style={fontStyle}>
        {layout.parts.map(part => <div key={part.id} className={`signage-layout-part editor-part${selectedId === part.id ? " is-selected" : ""}`} style={partPosition(part)}
          role="button" tabIndex={0} aria-label={`${partNames[part.kind]}パーツ ${part.id}`} aria-pressed={selectedId === part.id}
          hidden={settings.mediaLayout === "alternating" && !!settings.media?.length && (part.kind === "media" ? !previewMedia : part.kind === "departures" && previewMedia)}
          onFocus={() => setSelectedId(part.id)} onPointerDown={e => start(e, part)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
          onKeyDown={e => {
            if (disabled) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(e.shiftKey); return; }
            if (["Delete", "Backspace"].includes(e.key)) { e.preventDefault(); commit({ parts: layout.parts.filter(p => p.id !== part.id) }); setSelectedId(""); }
            if (e.key === "Escape") setSelectedId("");
            const offset = e.shiftKey ? 10 : 2;
            if (e.key.startsWith("Arrow")) { e.preventDefault(); commit({ parts: layout.parts.map(p => p.id === part.id ? fitPart({ ...p, x: p.x + (e.key === "ArrowLeft" ? -offset : e.key === "ArrowRight" ? offset : 0), y: p.y + (e.key === "ArrowUp" ? -offset : e.key === "ArrowDown" ? offset : 0) }) : p) }); }
          }}>
          <div className="editor-part-content"><SignagePartContent part={part} settings={settings} data={data} now={japanTime(new Date())} pageRoutes={previewPages[previewPage]} /></div>
          {selectedId === part.id && !disabled && <div className="part-resize" role="button" aria-label="パーツの大きさを変更" onPointerDown={e => start(e, part, true)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} />}
        </div>)}
      </SignageScreen>
      <p className="canvas-caption">表示中の画面をそのまま編集できます。変更後は「保存」を押してください。</p>
    </div>
  </section>;
}

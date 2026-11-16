import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DisplaySettings, TickerSegment } from "../../shared/display-settings";
import { useDisplayFont } from "../../shared/fonts";
import { editTickerText, replaceTickerRange, styleTickerRange, tickerText, type TextSelection, type TickerEdit } from "../../shared/ticker-document";

export function TickerEditor({ settings, disabled, onChange }: {
  settings: DisplaySettings; disabled: boolean; onChange(settings: DisplaySettings): void;
}) {
  const segments = settings.ticker?.segments ?? [{ id: "initial", text: settings.tickerText }];
  const text = tickerText(segments), size = settings.ticker?.size ?? "medium", speed = settings.ticker?.speed ?? 70;
  const editor = useRef<HTMLDivElement>(null), selection = useRef<TextSelection>({ start: 0, end: 0 });
  const latest = useRef({ settings, onChange, segments }); latest.current = { settings, onChange, segments };
  const history = useRef<{ past: TickerSegment[][]; future: TickerSegment[][] }>({ past: [], future: [] });
  const composing = useRef(false);
  const beforeEdit = useRef<TickerEdit | undefined>(undefined);
  const [revision, setRevision] = useState(0), [selectedCount, setSelectedCount] = useState(0), [notice, setNotice] = useState("");
  const [color, setColor] = useState("#ffffff"), [weight, setWeight] = useState<400 | 700>(700);
  const [font, setFont] = useState<"gothic" | "mincho" | "custom">("gothic"), [blink, setBlink] = useState(false), [pause, setPause] = useState(0);
  const fontStyle = useDisplayFont(settings.appearance);

  function captureSelection() {
    const root = editor.current, current = window.getSelection();
    if (!root || !current?.rangeCount || !root.contains(current.anchorNode) || !root.contains(current.focusNode)) return;
    const range = current.getRangeAt(0), prefix = range.cloneRange();
    prefix.selectNodeContents(root); prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length, end = start + range.toString().length;
    selection.current = { start, end }; setSelectedCount(end - start);
  }
  function restoreSelection() {
    const root = editor.current; if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange(); let offset = 0, started = false, ended = false;
    while (walker.nextNode()) {
      const node = walker.currentNode, length = node.textContent?.length ?? 0;
      if (!started && selection.current.start <= offset + length) { range.setStart(node, Math.max(0, selection.current.start - offset)); started = true; }
      if (selection.current.end <= offset + length) { range.setEnd(node, Math.max(0, selection.current.end - offset)); ended = true; break; }
      offset += length;
    }
    if (!started) { range.selectNodeContents(root); range.collapse(false); }
    else if (!ended) { range.setEnd(root, root.childNodes.length); }
    const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range);
  }
  function paint(next: TickerSegment[], focus = false) {
    const root = editor.current; if (!root) return;
    const focused = focus || document.activeElement === root;
    root.replaceChildren(...next.map(segment => {
      const span = document.createElement("span");
      span.textContent = segment.text; span.className = `ticker-font-${segment.font ?? "inherit"}${segment.blink ? " ticker-blink" : ""}`;
      span.style.color = segment.color ?? ""; span.style.fontWeight = segment.font === "mincho" ? "400" : segment.weight ? String(segment.weight) : "inherit";
      if (segment.pauseSeconds) { span.dataset.pause = `${segment.pauseSeconds}秒停止`; span.title = `この文字の後で${segment.pauseSeconds}秒停止`; }
      return span;
    }));
    if (focused) { root.focus({ preventScroll: true }); restoreSelection(); }
  }
  useLayoutEffect(() => { if (!composing.current) paint(segments); }, [segments, revision]);
  useEffect(() => {
    const root = editor.current; if (!root) return;
    const beforeInput = (event: InputEvent) => {
      if (disabled || composing.current || event.isComposing) return;
      captureSelection();
      if (["insertParagraph", "insertLineBreak"].includes(event.inputType)) { event.preventDefault(); insert("\n"); return; }
      if (["historyUndo", "historyRedo"].includes(event.inputType)) { event.preventDefault(); undo(event.inputType === "historyRedo"); return; }
      beforeEdit.current = { ...selection.current, inputType: event.inputType };
    };
    root.addEventListener("beforeinput", beforeInput);
    return () => root.removeEventListener("beforeinput", beforeInput);
  }, [disabled]);

  function commit(next: TickerSegment[], record = true, focus = false) {
    if (disabled) return;
    if (tickerText(next).length > 2000 || next.length > 200) { setNotice("文面は2000文字、装飾は200区間まで設定できます。"); paint(latest.current.segments, focus); return; }
    if (record) { history.current.past.push(latest.current.segments); if (history.current.past.length > 100) history.current.past.shift(); history.current.future = []; }
    const current = latest.current;
    latest.current = { ...current, segments: next };
    current.onChange({ ...current.settings, tickerText: tickerText(next), ticker: { ...current.settings.ticker, speed: current.settings.ticker?.speed ?? 70, segments: next } });
    setRevision(value => value + 1); paint(next, focus);
  }
  function input() {
    if (composing.current || !editor.current) return;
    captureSelection();
    const value = (editor.current.textContent ?? "").replace(/\r\n?/g, "\n");
    if (value !== tickerText(latest.current.segments)) commit(editTickerText(latest.current.segments, value, beforeEdit.current));
    beforeEdit.current = undefined;
  }
  function insert(value: string) {
    captureSelection(); const selected = selection.current;
    const remaining = 2000 - tickerText(latest.current.segments).length + selected.end - selected.start;
    const nextText = value.slice(0, Math.max(0, remaining));
    selection.current = { start: selected.start + nextText.length, end: selected.start + nextText.length }; setSelectedCount(0);
    commit(replaceTickerRange(latest.current.segments, selected, nextText), true, true);
  }
  function undo(redo = false) {
    if (disabled) return;
    const source = redo ? history.current.future : history.current.past, destination = redo ? history.current.past : history.current.future;
    const next = source.pop(); if (!next) return; destination.push(latest.current.segments);
    selection.current = { start: tickerText(next).length, end: tickerText(next).length }; setSelectedCount(0); commit(next, false, true);
  }
  function decorate(clear = false) {
    if (selection.current.end <= selection.current.start) { setNotice("編集エリアで装飾したい文字を選択してください。"); return; }
    commit(styleTickerRange(latest.current.segments, selection.current, clear
      ? { color: undefined, weight: undefined, font: undefined, blink: undefined, pauseSeconds: undefined }
      : { color, weight: font === "mincho" ? 400 : weight, font, blink, pauseSeconds: pause }), true, true);
    setNotice(clear ? "選択した文字の装飾を解除しました。" : "選択した文字に装飾を適用しました。");
  }
  function configure(patch: Partial<NonNullable<DisplaySettings["ticker"]>>) {
    onChange({ ...settings, tickerText: text, ticker: { ...settings.ticker, speed, segments, ...patch } });
  }

  return <section className="studio-section ticker-composer"><h2>スクロール文面</h2><fieldset disabled={disabled}>
    <div className="ticker-display-options"><label>文字の大きさ<select aria-label="文字の大きさ" value={size} onChange={event => configure({ size: event.target.value as typeof size })}><option value="small">小</option><option value="medium">中（標準）</option><option value="large">大</option></select></label>
      <label>スクロール速度<select aria-label="スクロール速度" value={speed <= 50 ? 40 : speed <= 90 ? 70 : 110} onChange={event => configure({ speed: Number(event.target.value) })}><option value={40}>ゆっくり</option><option value={70}>標準</option><option value={110}>速い</option></select></label></div>
    <div className="ticker-document">
      <div className="ticker-toolbar" role="toolbar" aria-label="文面の編集ツール">
        <button type="button" disabled={disabled || !history.current.past.length} aria-label="元に戻す" title="元に戻す（Ctrl+Z / ⌘Z）" onClick={() => undo()}>↶</button>
        <button type="button" disabled={disabled || !history.current.future.length} aria-label="やり直す" title="やり直す（Ctrl+Shift+Z / ⌘⇧Z）" onClick={() => undo(true)}>↷</button>
        <label>文字色<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
        <label>文字の太さ<select value={font === "mincho" ? 400 : weight} disabled={disabled || font === "mincho"} onChange={event => setWeight(Number(event.target.value) as 400 | 700)}><option value={400}>標準</option><option value={700}>太字</option></select></label>
        <label>文字の書体<select value={font} onChange={event => setFont(event.target.value as typeof font)}><option value="gothic">ゴシック体</option><option value="mincho">明朝体</option><option value="custom" disabled={!settings.appearance?.customFont}>追加したフォント</option></select></label>
      </div>
      <div className="ticker-format-options"><label className="studio-check"><input type="checkbox" checked={blink} onChange={event => setBlink(event.target.checked)} />選択した文字を点滅</label>
        <label>区間末尾で停止する秒数<input type="number" min={0} max={60} value={pause} onChange={event => setPause(Math.max(0, Math.min(60, Number(event.target.value))))} /></label>
        <button type="button" disabled={disabled || !selectedCount} onClick={() => decorate()}>選択した文字に適用</button><button type="button" disabled={disabled || !selectedCount} onClick={() => decorate(true)}>選択の装飾を解除</button></div>
      <label className="ticker-document-label" id="ticker-document-label">画面下部のスクロール文面</label>
      <div ref={editor} role="textbox" aria-labelledby="ticker-document-label" aria-describedby="ticker-editor-help" aria-multiline="true" aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
        contentEditable={!disabled} suppressContentEditableWarning spellCheck={false} className="ticker-edit-preview ticker-edit-canvas" data-size={size}
        style={fontStyle as CSSProperties} data-placeholder="ここに案内文を入力してください" onInput={input} onSelect={captureSelection} onKeyUp={captureSelection} onMouseUp={captureSelection} onBlur={captureSelection}
        onCompositionStart={() => { captureSelection(); beforeEdit.current = { ...selection.current, inputType: "insertCompositionText" }; composing.current = true; }} onCompositionEnd={() => { composing.current = false; input(); }}
        onPaste={event => { event.preventDefault(); insert(event.clipboardData.getData("text/plain")); }} onDrop={event => event.preventDefault()}
        onKeyDown={event => {
          if (composing.current || event.nativeEvent.isComposing) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(event.shiftKey); }
          else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); undo(true); }
          else if (event.key === "Enter") { event.preventDefault(); insert("\n"); }
          else if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) { event.preventDefault(); if (event.key.toLowerCase() === "b") { setWeight(weight === 700 ? 400 : 700); if (selection.current.end > selection.current.start) commit(styleTickerRange(latest.current.segments, selection.current, { weight: weight === 700 ? 400 : 700 }), true, true); } }
        }} />
      <div className="ticker-document-status"><span>{selectedCount ? `${selectedCount}文字を選択中` : "文字を選択して装飾できます"}</span><span>{text.length} / 2000文字</span></div>
    </div>
    <p className="muted" id="ticker-editor-help">入力した文字に装飾を表示します。編集しても前後の装飾は保持されます。改行はSignageでは空白として表示します。</p>
    <button type="button" disabled={disabled || !text} onClick={() => { commit([{ id: crypto.randomUUID(), text }]); setNotice("文全体の装飾を解除しました。"); }}>文字の装飾をすべて解除</button>
    {notice && <p className="feedback" role="status">{notice}</p>}
  </fieldset></section>;
}

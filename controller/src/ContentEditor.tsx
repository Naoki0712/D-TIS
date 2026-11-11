import { useEffect, useRef, useState } from "react";
import type { DisplaySettings, TickerSegment, MediaItem, CustomFont } from "../../shared/display-settings";
import { uploadAsset } from "../../shared/media-storage";
import { assetUrl } from "../../shared/content-settings";
import { useDisplayFont } from "../../shared/fonts";

export function ContentEditor({ settings, onChange, disabled }: { settings: DisplaySettings; onChange(settings: DisplaySettings): void; disabled: boolean }) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [mediaUrl, setMediaUrl] = useState(""), [mediaKind, setMediaKind] = useState<"image" | "video">("image");
  const [fontUrl, setFontUrl] = useState(""), [fontName, setFontName] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [color, setColor] = useState("#ffffff"), [weight, setWeight] = useState<400 | 700>(700);
  const [font, setFont] = useState<"gothic" | "mincho" | "custom">("gothic"), [blink, setBlink] = useState(false), [pause, setPause] = useState(0);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const fontStyle = useDisplayFont(settings.appearance);
  const locked = disabled || busy;
  const latest = useRef({ settings, onChange }); latest.current = { settings, onChange };
  const update = (patch: Partial<DisplaySettings>) => latest.current.onChange({ ...latest.current.settings, ...patch });
  const travel = settings.travel ?? { mode: "off" as const, minutes: 0, walkingSpeedKmh: 4.8, bufferMinutes: 0 };
  const segments: TickerSegment[] = settings.ticker?.segments ?? [{ id: "initial", text: settings.tickerText }];
  const tickerText = segments.map(s => s.text).join("");
  function setSegments(next: TickerSegment[]) {
    update({ tickerText: next.map(s => s.text).join(""), ticker: { speed: settings.ticker?.speed ?? 70, segments: next } });
  }
  function decorate() {
    if (selection.end <= selection.start) { setNotice("文面から装飾したい文字を選択してください。"); return; }
    let offset = 0;
    const next = segments.flatMap(segment => {
      const start = Math.max(0, selection.start - offset), end = Math.min(segment.text.length, selection.end - offset);
      offset += segment.text.length;
      if (end <= start) return [segment];
      const rows: TickerSegment[] = [];
      if (start > 0) rows.push({ ...segment, id: crypto.randomUUID(), text: segment.text.slice(0, start), pauseSeconds: 0 });
      rows.push({ ...segment, id: crypto.randomUUID(), text: segment.text.slice(start, end), color, weight: font === "mincho" ? 400 : weight, font, blink, pauseSeconds: pause });
      if (end < segment.text.length) rows.push({ ...segment, id: crypto.randomUUID(), text: segment.text.slice(end) });
      return rows;
    });
    if (next.length > 200) { setNotice("装飾は200区間まで設定できます。不要な装飾を解除してください。"); return; }
    setSegments(next); setNotice("選択した文字に装飾を設定しました。");
  }
  async function addFile(file: File | undefined, kind: "image" | "video" | "font") {
    if (!file || locked) return; setBusy(true); setNotice("アップロードしています…");
    try {
      const url = await uploadAsset(file, kind);
      if (!alive.current) return;
      if (kind === "font") {
        const ext = file.name.split(".").at(-1)?.toLowerCase();
        update({ appearance: { preset: "custom", customFont: { family: file.name.replace(/\.[^.]+$/, "").slice(0, 80), url,
          format: ext === "ttf" ? "truetype" : ext === "otf" ? "opentype" : ext as "woff2" | "woff" } } });
      } else addMedia(url, kind, file.name.slice(0, 200));
      setNotice("追加しました。「Signageに反映して記録」で保存してください。");
    } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : "アップロードに失敗しました。"); }
    finally { if (alive.current) setBusy(false); }
  }
  function addMedia(url: string, kind: "image" | "video", alt = "") {
    if (!assetUrl(url)) { setNotice("HTTPSのファイルURLを入力してください。"); return; }
    if ((latest.current.settings.media?.length ?? 0) >= 20) { setNotice("写真・映像は20件まで追加できます。"); return; }
    update({ media: [...(latest.current.settings.media ?? []), { id: crypto.randomUUID(), url, kind, alt, durationSeconds: 15 }] });
    setMediaUrl("");
  }
  function editMedia(id: string, patch: Partial<MediaItem>) { update({ media: settings.media?.map(item => item.id === id ? { ...item, ...patch } : item) }); }
  function locate() {
    if (!navigator.geolocation) { setNotice("このデバイスでは位置を取得できません。手動の移動時間を指定してください。"); return; }
    setBusy(true); setNotice("このデバイスの現在地を確認しています…");
    navigator.geolocation.getCurrentPosition(position => {
      if (!alive.current) return;
      update({ travel: { ...travel, mode: "gps", latitude: position.coords.latitude, longitude: position.coords.longitude } });
      setBusy(false); setNotice(`設置場所を設定しました（位置精度の目安 ±${Math.round(position.coords.accuracy)}m）。`);
    }, () => { if (alive.current) { setBusy(false); setNotice("位置を取得できませんでした。位置情報の許可を確認するか、手動の移動時間を設定してください。"); } }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  return <div className="content-editor">
    <section className="studio-section"><h2>書体と画面の切り替え</h2><fieldset disabled={locked}>
      <label>書体のプリセット<select value={settings.appearance?.preset ?? "gothic"} onChange={e => update({ appearance: { ...settings.appearance, preset: e.target.value as "gothic" | "mincho" | "custom" } })}>
        <option value="gothic">ゴシック体 — BIZ UDPゴシック / Inter & Helvetica</option><option value="mincho">明朝体 — BIZ UDP明朝 Regular / Inter & Helvetica</option>
        {settings.appearance?.customFont && <option value="custom">追加した書体 — {settings.appearance.customFont.family}</option>}</select></label>
      <p className="font-sample" style={fontStyle} data-font-preset={settings.appearance?.preset}>まちのみんなに、迷わない移動を。 D-TIS 0123456789</p>
      <details><summary>自分のフォントを追加</summary><label>フォントファイル<input type="file" accept=".woff2,.woff,.ttf,.otf" onChange={e => { void addFile(e.target.files?.[0], "font"); e.target.value = ""; }} /></label>
        <p className="muted">10MB以内。ウェブで利用できるライセンスのフォントを選んでください。英数字にはInter / Helveticaを使います。</p>
        <label>フォント名<input value={fontName} maxLength={80} onChange={e => setFontName(e.target.value)} /></label>
        <label>またはフォントファイルのURL<input type="url" value={fontUrl} onChange={e => setFontUrl(e.target.value)} placeholder="https://…/font.woff2" /></label>
        <button type="button" disabled={!fontName.trim() || !assetUrl(fontUrl)} onClick={() => {
          const ext = new URL(fontUrl).pathname.split(".").at(-1)?.toLowerCase();
          const format = ext === "ttf" ? "truetype" : ext === "otf" ? "opentype" : ext === "woff" ? "woff" : "woff2";
          update({ appearance: { preset: "custom", customFont: { family: fontName.trim(), url: fontUrl, format: format as CustomFont["format"] } } });
        }}>URLのフォントを追加</button></details>
      <label>乗り物が入れ替わるときの効果<select value={settings.transition ?? "fade"} onChange={e => update({ transition: e.target.value as DisplaySettings["transition"] })}>
        <option value="none">なし</option><option value="slide">上にスライド</option><option value="fade">フェード</option><option value="flip">立体フリップ</option><option value="split-flap">パタパタ表示</option><option value="zoom">ズーム</option></select></label>
    </fieldset></section>
    <section className="studio-section"><h2>駅・停留所までの移動時間</h2><fieldset disabled={locked}>
      <label>移動時間の設定<select value={travel.mode} onChange={e => update({ travel: { ...travel, mode: e.target.value as typeof travel.mode } })}><option value="off">考慮しない</option><option value="manual">手動で設定</option><option value="gps">GPSから徒歩時間を推定</option></select></label>
      {travel.mode !== "off" && <><label>{travel.mode === "gps" ? "推定に追加する時間（分）" : "駅・停留所までの時間（分）"}<input type="number" min={0} max={180} value={travel.minutes} onChange={e => update({ travel: { ...travel, minutes: Number(e.target.value) } })} /></label>
        <label>乗車までの余裕時間（分）<input type="number" min={0} max={180} value={travel.bufferMinutes ?? 0} onChange={e => update({ travel: { ...travel, bufferMinutes: Number(e.target.value) } })} /></label></>}
      {travel.mode === "gps" && <><button type="button" onClick={locate}>このデバイスのGPSで設置場所を取得</button>
        <p className="muted">Signageの設置場所で取得してください。直線距離に迂回分を加えた徒歩の目安です。道路・階段・信号は考慮しません。</p>
        <div className="studio-grid"><label>設置場所の緯度<input type="number" step="any" min={-90} max={90} value={travel.latitude ?? ""} onChange={e => update({ travel: { ...travel, latitude: e.target.value ? Number(e.target.value) : undefined } })} /></label><label>設置場所の経度<input type="number" step="any" min={-180} max={180} value={travel.longitude ?? ""} onChange={e => update({ travel: { ...travel, longitude: e.target.value ? Number(e.target.value) : undefined } })} /></label></div>
        <label>徒歩速度（km/h）<input type="number" min={1} max={8} step={0.1} value={travel.walkingSpeedKmh ?? 4.8} onChange={e => update({ travel: { ...travel, walkingSpeedKmh: Number(e.target.value) } })} /></label></>}
      <p className="muted">移動時間を含めて間に合う便を表示します。位置が分からない駅では手動の追加時間を使います。</p>
    </fieldset></section>
    <section className="studio-section"><h2>オリジナルコンテンツ</h2><fieldset disabled={locked}>
      <label>写真・映像の表示方法<select value={settings.mediaLayout ?? "alongside"} onChange={e => update({ mediaLayout: e.target.value as "alongside" | "alternating" })}><option value="alongside">交通案内と並べる</option><option value="alternating">交通案内と交互に表示</option></select></label>
      <label>写真を追加<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={(settings.media?.length ?? 0) >= 20} onChange={e => { void addFile(e.target.files?.[0], "image"); e.target.value = ""; }} /></label>
      <label>映像を追加<input type="file" accept="video/mp4,video/webm,video/quicktime,.m4v" disabled={(settings.media?.length ?? 0) >= 20} onChange={e => { void addFile(e.target.files?.[0], "video"); e.target.value = ""; }} /></label>
      <p className="muted">写真20MB・映像50MB以内。映像は音声なしで再生します。iPadではMP4（H.264）を推奨します。</p>
      <details><summary>URLから写真・映像を追加</summary><label>種類<select value={mediaKind} onChange={e => setMediaKind(e.target.value as typeof mediaKind)}><option value="image">写真</option><option value="video">映像</option></select></label><label>ファイルのURL<input type="url" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="https://…/photo.jpg" /></label><button type="button" disabled={!assetUrl(mediaUrl)} onClick={() => addMedia(mediaUrl, mediaKind)}>URLから追加</button><p className="muted">動画共有サイトのページではなく、画像・動画ファイルのURLを指定してください。</p></details>
      <div className="media-items">{settings.media?.map((item, index) => <article key={item.id}><h3>{index + 1}. {item.kind === "image" ? "写真" : "映像"}</h3><label>説明<input value={item.alt} maxLength={200} onChange={e => editMedia(item.id, { alt: e.target.value })} /></label><label>表示する秒数<input type="number" min={3} max={300} value={item.durationSeconds} onChange={e => editMedia(item.id, { durationSeconds: Number(e.target.value) })} /></label><div className="studio-buttons"><button type="button" disabled={index === 0} onClick={() => { const items = [...settings.media!]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; update({ media: items }); }}>前へ</button><button type="button" onClick={() => update({ media: settings.media?.filter(m => m.id !== item.id) })}>表示から削除</button></div></article>)}</div>
    </fieldset></section>
    <section className="studio-section"><h2>スクロール文面</h2><fieldset disabled={locked}>
      <label>画面下部のスクロール文面<textarea rows={4} maxLength={2000} value={tickerText} onSelect={e => setSelection({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })} onChange={e => setSegments([{ id: crypto.randomUUID(), text: e.target.value }])} /></label>
      <p className="muted">文面を書いてから文字を選択し、下の設定を適用します。文全体を書き換えると装飾はリセットされます。</p>
      <label>文全体のスクロール速度（{settings.ticker?.speed ?? 70}px/秒）<input type="range" min={10} max={300} value={settings.ticker?.speed ?? 70} onChange={e => update({ ticker: { speed: Number(e.target.value), segments }, tickerText })} /></label>
      <div className="studio-grid"><label>文字色<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label><label>文字の太さ<select value={font === "mincho" ? 400 : weight} disabled={font === "mincho"} onChange={e => setWeight(Number(e.target.value) as 400 | 700)}><option value={400}>Regular</option><option value={700}>Bold</option></select></label><label>文字の書体<select value={font} onChange={e => setFont(e.target.value as typeof font)}><option value="gothic">ゴシック体</option><option value="mincho">明朝体 Regular</option><option value="custom" disabled={!settings.appearance?.customFont}>追加したフォント</option></select></label><label>区間末尾で停止する秒数<input type="number" min={0} max={60} value={pause} onChange={e => setPause(Number(e.target.value))} /></label></div>
      <label className="studio-check"><input type="checkbox" checked={blink} onChange={e => setBlink(e.target.checked)} />選択した文字を点滅</label>
      <button type="button" onClick={decorate}>選択した文字に適用</button>
      <div className="ticker-edit-preview" style={fontStyle} aria-label="スクロール文面の装飾プレビュー">{segments.map(segment => <span key={segment.id} className={`ticker-font-${segment.font ?? "gothic"}${segment.blink ? " ticker-blink" : ""}`} style={{ color: segment.color, fontWeight: segment.font === "mincho" ? 400 : segment.weight }}>{segment.text}{!!segment.pauseSeconds && <small> ⏸{segment.pauseSeconds}秒 </small>}</span>)}</div>
      <button type="button" onClick={() => setSegments([{ id: crypto.randomUUID(), text: tickerText }])}>文字の装飾をすべて解除</button>
    </fieldset></section>
    {notice && <p className="feedback" role="status">{notice}</p>}
  </div>;
}

import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { AppHeader, appUrl } from "../../shared/AppHeader";
import { CloudGate } from "../../shared/CloudSetup";
import { LivePreview } from "../../shared/live-preview";
import { getDevice, listDevices, listDeviceEvents, newCommand, sendCommand, subscribeDevice, type CommandAction, type DeviceChannel, type DeviceEvent, type DeviceRecord } from "../../shared/cloud";
import { getOdptCatalog, loadOdptData } from "../../shared/browser-odpt";
import { mergeDeviceList, mergeDeviceSnapshot } from "../../shared/cloud-view-state";
import { effectiveDisplaySettings, selectOutput, withOutputSettings, type FacilitySettings, type DeviceType } from "../../shared/display-settings";
import { RouteEditor } from "./RouteEditor";
import type { CatalogLine } from "./catalog";
import "@fontsource/inter/700.css";
import "../../shared/theme.css";
import "./styles.css";
import "./fixes.css";
import "./connections.css";
import "./equipment.css";

document.documentElement.classList.toggle("windows", navigator.userAgent.includes("Windows"));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const time = (value: string) => new Date(value).toLocaleString("ja-JP");
const actionName: Record<string, string> = { settings: "表示設定を適用", display: "表示の停止・再開", refresh: "データを更新" };
const typeName: Record<DeviceType, string> = { lcd: "LCDサイネージ", led: "LED発車標", "bell-switch": "操作デバイス" };

function App() {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [activeId, setActiveId] = useState("");
  const [outputId, setOutputId] = useState("");
  const [draft, setDraft] = useState<FacilitySettings | null>(null);
  const [loadedId, setLoadedId] = useState("");
  const [baseRevision, setBaseRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [channel, setChannel] = useState<DeviceChannel | null>(null);
  const [channelDeviceId, setChannelDeviceId] = useState("");
  const [channelStatus, setChannelStatus] = useState("");
  const [lines, setLines] = useState<CatalogLine[]>([]);
  const [catalogNote, setCatalogNote] = useState("ODPTから路線を取得しています…");
  const [odptNote, setOdptNote] = useState("");
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reload, setReload] = useState(0);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<DeviceType>("lcd");
  const addDialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(false);
  const dirtyRef = useRef(false);
  const activeRef = useRef(activeId);
  activeRef.current = activeId; dirtyRef.current = dirty;
  const active = devices.find(device => device.id === activeId);
  const output = draft?.devices.find(device => device.id === outputId);
  const config = draft ? effectiveDisplaySettings(draft, outputId) : null;
  const online = !!active?.last_seen_at && now - Date.parse(active.last_seen_at) < 25000;
  const connected = channelStatus === "SUBSCRIBED";
  const canEdit = !!active && !!channel && loadedId === activeId && channelDeviceId === activeId && connected && online && !busy;
  const conflict = !!active && dirty && active.revision !== baseRevision;

  useEffect(() => {
    let alive = true, polling = false;
    async function poll() {
      if (polling) return; polling = true;
      try {
        const rows = await listDevices();
        if (alive) { setDevices(previous => mergeDeviceList(previous, rows)); setError(""); setActiveId(id => rows.some(row => row.id === id) ? id : rows[0]?.id ?? ""); }
      } catch (error) { if (alive) setError(message(error)); }
      finally { polling = false; }
    }
    void poll(); const timer = window.setInterval(() => { setNow(Date.now()); void poll(); }, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [reload]);

  useEffect(() => {
    setDraft(null); setLoadedId(""); setDirty(false); dirtyRef.current = false; setOutputId(""); setNote(""); setEvents([]);
  }, [activeId]);
  useEffect(() => {
    if (!active || dirtyRef.current || operation.current) return;
    setDraft(active.settings); setLoadedId(active.id); setBaseRevision(active.revision);
    setOutputId(id => active.settings.devices.some(device => device.id === id) ? id : selectOutput(active.settings)?.id ?? active.settings.devices[0]?.id ?? "");
  }, [activeId, active?.revision, active?.settings, busy]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  useEffect(() => {
    const abort = new AbortController();
    function refreshCatalog() {
      setCatalogNote("ODPT・GTFSから路線を取得しています…");
      void getOdptCatalog(undefined, abort.signal).then(result => {
        if (!abort.signal.aborted) { setLines(result.lines); setCatalogNote(`${result.source === "cache" ? "保存済み" : "取得済み"}の路線: ${result.lines.length}件${result.warnings?.length ? ` · ${result.warnings.join(" / ")}` : ""}`); }
      }).catch(error => { if (!abort.signal.aborted) setCatalogNote(message(error)); });
    }
    refreshCatalog(); window.addEventListener("d-tis:odpt-config", refreshCatalog);
    return () => { abort.abort(); window.removeEventListener("d-tis:odpt-config", refreshCatalog); };
  }, [reload]);

  useEffect(() => {
    let alive = true, wire: DeviceChannel | null = null, retry = 0;
    setChannel(null); setChannelDeviceId(""); setChannelStatus("");
    if (!activeId) return;
    async function connect() {
      try {
        wire = await subscribeDevice(activeId, () => {}, status => { if (alive) setChannelStatus(status); });
        if (!alive) { await wire.close(); return; }
        setChannel(wire); setChannelDeviceId(activeId);
      } catch (error) {
        if (alive) { setNote(message(error)); retry = window.setTimeout(() => void connect(), 7000); }
      }
    }
    void connect();
    return () => { alive = false; window.clearTimeout(retry); void wire?.close(); };
  }, [activeId]);

  useEffect(() => {
    let alive = true;
    if (!activeId) return;
    void listDeviceEvents(activeId).then(rows => { if (alive) setEvents(rows); }).catch(error => { if (alive) setNote(message(error)); });
    return () => { alive = false; };
  }, [activeId, active?.revision, reload]);
  useEffect(() => {
    const abort = new AbortController();
    if (!active) return;
    setOdptNote("Controller側の交通情報を更新しています…");
    void loadOdptData(effectiveDisplaySettings(active.settings, outputId), undefined, abort.signal, true).then(data => {
      if (!abort.signal.aborted) setOdptNote(data.source === "unavailable" ? data.error ?? "交通情報を取得できません。接続設定を確認してください。"
        : `${data.source === "cache" ? "保存済み" : "ODPT・GTFS取得済み"} · ${data.timetables.length}件の時刻表${data.fetchedAt ? ` · ${time(data.fetchedAt)}` : ""}`);
    }).catch(error => { if (!abort.signal.aborted) setOdptNote(message(error)); });
    return () => abort.abort();
  }, [activeId, active?.revision, outputId, reload]);

  function edit(next: FacilitySettings) {
    if (!canEdit) return;
    setDraft(next); setDirty(true); dirtyRef.current = true; setNote("未保存の変更があります。");
  }
  function select(id: string, output?: string) {
    if (operation.current) return;
    if (dirty && !window.confirm("未保存の設定を破棄して操作対象を切り替えますか？")) return;
    dirtyRef.current = false; setDirty(false);
    if (id === activeId && active) { setDraft(active.settings); setBaseRevision(active.revision); }
    setActiveId(id); if (output) setOutputId(output);
  }
  async function refresh() {
    if (!active || operation.current) return;
    if (dirty && !window.confirm("未保存の設定を破棄してSupabaseから再読み込みしますか？")) return;
    operation.current = true; setBusy(true);
    try {
      const record = await getDevice(active.id);
      if (activeRef.current !== record.id) return;
      setDevices(rows => rows.map(row => row.id === record.id ? mergeDeviceSnapshot(row, record) : row));
      setDraft(record.settings); setBaseRevision(record.revision); setDirty(false); dirtyRef.current = false;
      setNote("Supabaseの確定済み設定を読み込みました。"); setReload(value => value + 1);
    } catch (error) { setNote(message(error)); }
    finally { operation.current = false; setBusy(false); }
  }
  async function operate(action: CommandAction, payload: unknown) {
    if (!active || !channel || !canEdit || operation.current) return;
    if (conflict) { setNote("別のControllerで更新されています。最新の設定を読み込んでから変更してください。"); return; }
    operation.current = true; setBusy(true); setNote("Signageに送信しました。描画とSupabaseへの記録を待っています…");
    const id = active.id, command = newCommand(action, payload, baseRevision);
    try {
      await sendCommand(channel, command);
      // Always query persisted state, including after receiving an application acknowledgement.
      const confirmed = await getDevice(id);
      if (activeRef.current !== id) return;
      setDevices(rows => rows.map(row => row.id === id ? mergeDeviceSnapshot(row, confirmed) : row));
      setDraft(confirmed.settings); setBaseRevision(confirmed.revision); setDirty(false); dirtyRef.current = false;
      setNote(`Signageへの反映とSupabaseへの記録を確認しました（リビジョン ${confirmed.revision}）。`);
      setReload(value => value + 1);
    } catch (error) {
      if (activeRef.current === id) setNote(message(error));
      // A lost receipt is ambiguous: query the durable event by command ID before reporting failure.
      try {
        const [record, history] = await Promise.all([getDevice(id), listDeviceEvents(id, 100)]);
        if (activeRef.current !== id) return;
        setDevices(rows => rows.map(row => row.id === id ? mergeDeviceSnapshot(row, record) : row)); setEvents(history);
        if (history.some(event => event.command_id === command.id)) {
          setDraft(record.settings); setBaseRevision(record.revision); setDirty(false); dirtyRef.current = false;
          setNote(`完了通知を受信できませんでしたが、Supabaseの記録から反映済みと確認しました（リビジョン ${record.revision}）。`);
        }
      } catch { /* Keep the draft and display the unresolved receipt error. */ }
    } finally { operation.current = false; setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault(); if (draft) void operate("settings", { ...draft, updatedAt: new Date().toISOString() });
  }
  function addOutput(event: FormEvent) {
    event.preventDefault(); if (!draft || !newName.trim()) return;
    const id = crypto.randomUUID();
    edit({ ...draft, devices: [...draft.devices, { id, name: newName.trim(), type: newType, code: newType === "lcd" ? "LCD" : newType === "led" ? "LED" : "BELL", enabled: true, settings: effectiveDisplaySettings(draft) }] });
    setOutputId(id); setNewName(""); addDialog.current?.close();
  }

  return <main className="controller equipment-controller">
    <AppHeader product="Controller"><div className="equipment-shelf-wrapper"><div className="equipment-shelf" role="tablist" aria-label="出力設備">
      {(draft?.devices ?? []).map(item => <button type="button" role="tab" aria-selected={item.id === outputId} aria-controls="equipment-customization" key={item.id}
        className={`equipment-book ${item.type}${item.id === outputId ? " selected" : ""}${!item.enabled ? " stopped" : ""}`} disabled={busy}
        onClick={() => setOutputId(item.id)}><span className="book-type">{item.type === "bell-switch" ? "BELL" : item.type.toUpperCase()}<i className={online ? "online" : "offline"} /></span><strong>{item.name}</strong></button>)}
      <button className="equipment-add" type="button" aria-label="設備を追加" disabled={!canEdit} onClick={() => addDialog.current?.showModal()}>＋</button>
    </div></div></AppHeader>
    <section className="page equipment-page">
      <div className="cloud-toolbar"><label>操作するSignage <select aria-label="操作するSignage" value={activeId} disabled={busy} onChange={event => select(event.target.value)}>
        {!devices.length && <option value="">登録済みの端末がありません</option>}{devices.map(device => <option key={device.id} value={device.id}>{device.settings.facilityName || device.name} · {device.id.slice(0, 8)}</option>)}
      </select></label><button type="button" disabled={busy} onClick={() => void refresh()}>Supabaseから再読込</button>
        <a className="preview-link" href={appUrl("signage")} target="_blank" rel="noreferrer">Signageを開く ↗</a></div>
      {error && <p className="feedback error" role="alert">{error}</p>}
      {active ? <>
        <div className="cloud-sync"><strong className={online && connected ? "online" : "offline"}>● {online && connected ? active.display_enabled ? "Signage表示中" : "Signage停止中" : "Signageの接続を待っています"}</strong>
          <span>確定リビジョン {active.revision}</span><span>{active.last_seen_at ? `最終応答 ${time(active.last_seen_at)}` : "まだ画面の応答がありません"}</span></div>
        <LivePreview key={activeId} channel={channel} online={online && connected} />
        <div className="cloud-toolbar">
          <button type="button" disabled={!canEdit || dirty} onClick={() => void operate("display", { enabled: !active.display_enabled })}>{active.display_enabled ? "表示を停止" : "表示を再開"}</button>
          <button type="button" disabled={!canEdit || dirty} onClick={() => void operate("refresh", {})}>両画面の交通情報を更新</button>
          {output && <button type="button" disabled={!canEdit || dirty} onClick={() => draft && void operate("settings", { ...draft, devices: draft.devices.map(item => item.id === output.id ? { ...item, enabled: !item.enabled } : item) })}>{output.name}を{output.enabled ? "停止" : "再開"}</button>}
        </div>
        <p className="feedback" role="status">{busy ? "描画・記録の完了を待っています…" : note}</p>
        {conflict && <p className="feedback error" role="alert">他のControllerが更新しました。編集中の設定は保持しています。Supabaseから再読込して変更をやり直してください。</p>}
        {output && draft && config ? <section id="equipment-customization" role="tabpanel" aria-label={`${output.name}の設定`}>
          <div className="customize-heading"><div><p className="eyebrow">{typeName[output.type]} · {active.id.slice(0, 8)}</p><h1 className="page-title"><i />{output.name}</h1></div></div>
          <form onSubmit={save}><fieldset disabled={!canEdit || conflict}>
            <label className="equipment-name-field">設備名<input value={output.name} maxLength={80} required onChange={event => edit({ ...draft, devices: draft.devices.map(item => item.id === output.id ? { ...item, name: event.target.value } : item) })} /></label>
            <p className="control-help">{catalogNote}</p><p className="control-help">{odptNote}</p>
            <RouteEditor key={`${activeId}|${output.id}`} settings={config} lines={lines} disabled={!canEdit || conflict} onChange={settings => edit(withOutputSettings(draft, output.id, settings))} />
            <div className="section-heading"><b>施設・案内文</b><i /></div>
            <label className="facility-only">施設名<input value={config.facilityName} maxLength={200} required onChange={event => edit(withOutputSettings(draft, output.id, { ...config, facilityName: event.target.value }))} /></label>
            <label className="ticker-editor">画面下部のスクロール文面<textarea rows={4} maxLength={2000} value={config.tickerText} onChange={event => edit(withOutputSettings(draft, output.id, { ...config, tickerText: event.target.value }))} placeholder="例：足元にご注意ください。" /><small>{config.tickerText.length} / 2000文字</small></label>
            <div className="actions"><span>{dirty ? "未保存の変更があります" : "Supabaseの確定済み設定"}</span><button type="submit" disabled={!dirty || !canEdit || conflict}>Signageに反映して記録</button></div>
          </fieldset></form>
        </section> : <p>この端末に設備を追加してください。</p>}
        <details className="cloud-history"><summary>Signageで反映・記録した操作履歴</summary><ol>{events.map(event => <li key={event.id}>{time(event.applied_at)} · {actionName[event.action] ?? event.action} · リビジョン {event.revision}</li>)}</ol>{!events.length && <p>操作履歴はまだありません。</p>}</details>
      </> : <div className="equipment-empty"><h1>Signageを開いてください</h1><p>Signageで同じ運用アカウントにログインすると、ここに端末が表示されます。</p></div>}
    </section>
    <dialog ref={addDialog} className="device-dialog equipment-dialog"><div className="dialog-head"><h2>この端末に設備を追加</h2><button type="button" aria-label="閉じる" onClick={() => addDialog.current?.close()}>×</button></div>
      <form className="add-equipment-form" onSubmit={addOutput}><fieldset disabled={!canEdit}><label>設備の種類<select value={newType} onChange={event => setNewType(event.target.value as DeviceType)}><option value="lcd">LCDサイネージ</option><option value="led">LED発車標</option><option value="bell-switch">操作デバイス</option></select></label>
        <label>設備名<input value={newName} maxLength={80} required onChange={event => setNewName(event.target.value)} /></label><p className="control-help">追加後に設定を反映すると記録されます。各出力の表示はSignage URLに ?output=設備ID を付けて選択します。物理機器の駆動には別途機器側の対応が必要です。</p><button type="submit" disabled={!newName.trim()}>追加する</button></fieldset></form>
    </dialog>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><CloudGate product="Controller"><App /></CloudGate></StrictMode>);

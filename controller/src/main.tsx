import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { AppHeader, appUrl } from "../../shared/AppHeader";
import { CloudGate } from "../../shared/CloudSetup";
import { LivePreview } from "../../shared/live-preview";
import { getDevice, listDevices, listDeviceEvents, newCommand, sendCommand, subscribeDevice, registerDevice, type CommandAction, type DeviceChannel, type DeviceRecord } from "../../shared/cloud";
import { getOdptCatalog, loadOdptData } from "../../shared/browser-odpt";
import { mergeDeviceList, mergeDeviceSnapshot } from "../../shared/cloud-view-state";
import { effectiveDisplaySettings, selectOutput, withOutputSettings, type FacilitySettings } from "../../shared/display-settings";
import { RouteEditor } from "./RouteEditor";
import { ContentEditor } from "./ContentEditor";
import type { CatalogLine } from "./catalog";
import "@fontsource/inter/700.css";
import "../../shared/theme.css";
import "./styles.css";
import "./fixes.css";
import "./connections.css";
import "./equipment.css";
import "../../shared/fonts.css";
import "./studio.css";

document.documentElement.classList.toggle("windows", navigator.userAgent.includes("Windows"));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const time = (value: string) => new Date(value).toLocaleString("ja-JP");

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
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reload, setReload] = useState(0);
  const [newName, setNewName] = useState("");
  const [notifications, setNotifications] = useState<string[]>([]);
  const [createdUrl, setCreatedUrl] = useState("");
  const observed = useRef(new Map<string, { stamp: string; online: boolean }>());
  const initialized = useRef(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const addDialog = useRef<HTMLDialogElement>(null);
  const deviceDialog = useRef<HTMLDialogElement>(null);
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
        if (alive) {
          const alerts: string[] = [];
          for (const row of rows) {
            const previous = observed.current.get(row.id), stamp = row.last_connected_at ?? "";
            const present = !!row.last_seen_at && Date.now() - Date.parse(row.last_seen_at) < 25000;
            if (stamp && stamp !== previous?.stamp && (initialized.current || Date.now() - Date.parse(stamp) < 120000)) alerts.push(`${row.settings.devices[0]?.name || row.name}：${row.last_connection_kind === "new" ? "新しいSignageが接続しました" : "既存のSignageが再接続しました"}`);
            else if (initialized.current && !previous) alerts.push(`${row.settings.devices[0]?.name || row.name}：新しいSignageを追加しました`);
            else if (initialized.current && previous && !previous.online && present && !stamp) alerts.push(`${row.settings.devices[0]?.name || row.name}：既存のSignageが再接続しました`);
            observed.current.set(row.id, { stamp, online: present });
          }
          initialized.current = true;
          if (alerts.length) setNotifications(old => [...alerts, ...old].slice(0, 20));
          setDevices(previous => mergeDeviceList(previous, rows)); setError(""); setActiveId(id => rows.some(row => row.id === id) ? id : rows[0]?.id ?? "");
        }
      } catch (error) { if (alive) setError(message(error)); }
      finally { polling = false; }
    }
    void poll(); const timer = window.setInterval(() => { setNow(Date.now()); void poll(); }, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [reload]);

  useEffect(() => {
    setDraft(null); setLoadedId(""); setDirty(false); dirtyRef.current = false; setOutputId(""); setNote("");
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
    const abort = new AbortController();
    if (!active) return;
    setOdptNote("Controller側の交通情報を更新しています…");
    void loadOdptData(effectiveDisplaySettings(active.settings, outputId), undefined, abort.signal, true).then(data => {
      if (!abort.signal.aborted) setOdptNote(data.source === "unavailable" ? data.error ?? "交通情報を取得できません。時間をおいて再度お試しください。"
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
  async function operate(action: CommandAction, payload: unknown, expectedRevision = baseRevision): Promise<DeviceRecord | undefined> {
    if (!active || !channel || !canEdit || operation.current) return;
    if (conflict) { setNote("別のControllerで更新されています。最新の設定を読み込んでから変更してください。"); return; }
    operation.current = true; setBusy(true); setNote("Signageに送信しました。描画とSupabaseへの記録を待っています…");
    const id = active.id, command = newCommand(action, payload, expectedRevision);
    try {
      await sendCommand(channel, command);
      // Always query persisted state, including after receiving an application acknowledgement.
      const confirmed = await getDevice(id);
      if (activeRef.current !== id) return;
      setDevices(rows => rows.map(row => row.id === id ? mergeDeviceSnapshot(row, confirmed) : row));
      setDraft(confirmed.settings); setBaseRevision(confirmed.revision); setDirty(false); dirtyRef.current = false;
      setNote(`Signageへの反映とSupabaseへの記録を確認しました（リビジョン ${confirmed.revision}）。`);
      setReload(value => value + 1);
      return confirmed;
    } catch (error) {
      if (activeRef.current === id) setNote(message(error));
      // A lost receipt is ambiguous: query the durable event by command ID before reporting failure.
      try {
        const [record, history] = await Promise.all([getDevice(id), listDeviceEvents(id, 100)]);
        if (activeRef.current !== id) return;
        setDevices(rows => rows.map(row => row.id === id ? mergeDeviceSnapshot(row, record) : row));
        if (history.some(event => event.command_id === command.id)) {
          setDraft(record.settings); setBaseRevision(record.revision); setDirty(false); dirtyRef.current = false;
          setNote(`完了通知を受信できませんでしたが、Supabaseの記録から反映済みと確認しました（リビジョン ${record.revision}）。`);
          return record;
        }
      } catch { /* Keep the draft and display the unresolved receipt error. */ }
    } finally { operation.current = false; setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (draft.devices.some(device => !device.name.trim())) { setNote("デバイス名を入力してください。"); return; }
    void operate("settings", { ...draft, updatedAt: new Date().toISOString() });
  }
  function openDeviceMenu(id?: string) {
    if (id) setOutputId(id);
    setDeviceMenuOpen(true); deviceDialog.current?.showModal();
  }
  async function addOutput(event: FormEvent) {
    event.preventDefault(); if (!newName.trim() || busy) return;
    if (dirty && !window.confirm("未保存の設定を破棄して新しいSignageを追加しますか？")) return;
    setBusy(true);
    try {
      const record = await registerDevice(crypto.randomUUID(), newName.trim(), newName.trim());
      setDevices(rows => [...rows.filter(row => row.id !== record.id), record]);
      dirtyRef.current = false; setDirty(false); setActiveId(record.id);
      setCreatedUrl(`${appUrl("signage")}?device=${record.id}`); setNewName("");
      setNotifications(old => [`${record.settings.devices[0].name}：新しいSignageを追加しました。専用URLを表示用端末で開いてください。`, ...old].slice(0, 20));
    } catch (error) { setNote(message(error)); } finally { setBusy(false); }
  }
  const signageUrl = active ? `${appUrl("signage")}?device=${active.id}` : appUrl("signage");
  async function toggleDisplay() {
    if (!active || !draft || dirty) return;
    const resuming = !active.display_enabled || output?.enabled === false;
    let revision = baseRevision;
    if (resuming && draft.devices.some(item => !item.enabled)) {
      const saved = await operate("settings", { ...draft, devices: draft.devices.map(item => ({ ...item, enabled: true })) });
      if (!saved) return; revision = saved.revision;
      if (active.display_enabled) return;
    }
    await operate("display", { enabled: resuming }, revision);
  }

  return <main className="controller equipment-controller">
    <AppHeader product="Controller"><button className="studio-settings-button" type="button" aria-haspopup="dialog" aria-expanded={deviceMenuOpen} aria-controls="device-settings" disabled={busy || !active} onClick={() => openDeviceMenu()}>デバイス設定 <span aria-hidden="true">☰</span></button></AppHeader>
    <section className="page equipment-page">
      {error && <p className="feedback error" role="alert">{error}</p>}
      <section className="fleet-section" aria-label="Signage一覧"><div className="section-heading"><h1>Signage</h1><i /><button type="button" disabled={busy} onClick={() => { setCreatedUrl(""); addDialog.current?.showModal(); }}>＋ Signageを追加</button></div>
        <p className="muted">このアカウントのすべてのSignageを、ここから管理できます。</p>
        <div className="fleet-list">{devices.map(device => <button key={device.id} type="button" disabled={busy} className={device.id === activeId ? "selected" : ""} aria-pressed={device.id === activeId} onClick={() => select(device.id)}><strong>{device.settings.devices[0]?.name || device.name}</strong><small>{device.last_seen_at && now - Date.parse(device.last_seen_at) < 25000 ? "● 接続中" : "○ 接続待ち"} · {device.id.slice(0, 8)}</small></button>)}</div>
        {!!notifications.length && <details className="connection-notices" open><summary>Signageの接続通知（{notifications.length}）</summary><ul aria-live="polite">{notifications.map((notice, index) => <li key={`${index}-${notice}`}>{notice}</li>)}</ul><button type="button" onClick={() => setNotifications([])}>通知を閉じる</button></details>}
      </section>
      {active ? <>
        {!online && <p className="feedback">表示用のデバイスで<a href={signageUrl} target="_blank" rel="noreferrer">このSignageの専用URL</a>を開き、同じアカウントでログインしてください。</p>}
        <p className="feedback" role="status">{busy ? "描画・記録の完了を待っています…" : note}</p>
        {conflict && <p className="feedback error" role="alert">他のControllerが更新しました。編集中の設定は保持しています。Supabaseから再読込して変更をやり直してください。</p>}
        {output && draft && config ? <section id="equipment-customization" aria-label={`${output.name}の設定`}>
          <div className="customize-heading"><div><p className="eyebrow">表示内容を管理</p><h2 className="page-title"><i />{output.name}</h2></div></div>
          <form onSubmit={save}><fieldset disabled={!canEdit || conflict}>
            <p className="control-help">{catalogNote}</p><p className="control-help">{odptNote}</p>
            <RouteEditor key={`${activeId}|${output.id}`} settings={config} lines={lines} disabled={!canEdit || conflict} onChange={settings => edit(withOutputSettings(draft, output.id, settings))} />
            <div className="section-heading"><b>表示する施設名</b><i /></div>
            <label className="facility-only">施設名<input value={config.facilityName} maxLength={200} required onChange={event => edit(withOutputSettings(draft, output.id, { ...config, facilityName: event.target.value }))} /></label>
            <ContentEditor key={`${activeId}|${output.id}`} settings={config} disabled={!canEdit || conflict} onChange={settings => edit(withOutputSettings(draft, output.id, { ...settings,
              selectedRoutes: settings.selectedRoutes.map(route => ({ ...route, stationLocation: route.stationLocation ?? lines.find(line => line.id === route.railway)?.stations.find(station => station.id === route.station)?.location })),
            }))} />
            <div className="actions"><span>{dirty ? "未保存の変更があります" : "Supabaseの確定済み設定"}</span><button type="submit" disabled={!dirty || !canEdit || conflict}>Signageに反映して記録</button></div>
          </fieldset></form>
        </section> : <p>この端末にデバイスを追加してください。</p>}
      </> : <div className="equipment-empty"><h1>Signageを開いてください</h1><p>Signageで同じアカウントにログインすると、ここに端末が表示されます。</p><a className="open-signage" href={appUrl("signage")} target="_blank" rel="noreferrer">Signageを開く ↗</a></div>}
    </section>
    <dialog ref={deviceDialog} id="device-settings" className="device-dialog device-settings-dialog" aria-labelledby="device-settings-title" onClose={() => setDeviceMenuOpen(false)}>
      <div className="dialog-head"><h2 id="device-settings-title">デバイス設定</h2><button type="button" aria-label="閉じる" onClick={() => deviceDialog.current?.close()}>×</button></div>
      <h3>{output?.name || active?.name}</h3>
      {active && <div className="cloud-sync"><strong className={online && connected ? "online" : "offline"}>● {online && connected ? active.display_enabled && output?.enabled !== false ? "Signage表示中" : "Signage停止中" : "Signageの接続を待っています"}</strong>
        <span>{active.last_seen_at ? `最終応答 ${time(active.last_seen_at)}` : "最終応答：まだ画面の応答がありません"}</span><span>確定リビジョン {active.revision}</span></div>}
      {deviceMenuOpen && active && <LivePreview key={activeId} channel={channel} online={online && connected} />}
      <div className="studio-buttons"><button type="button" disabled={!canEdit || dirty} onClick={() => void toggleDisplay()}>{active?.display_enabled && output?.enabled !== false ? "表示を停止" : "表示を再開"}</button><button type="button" disabled={!canEdit || dirty} onClick={() => void operate("refresh", {})}>両画面の交通情報を更新</button></div>
      {output && draft && <form onSubmit={save}><fieldset disabled={!canEdit || conflict}>
        <label className="equipment-name-field">デバイス名<input value={output.name} maxLength={80} required onChange={event => edit({ ...draft, devices: draft.devices.map(item => item.id === output.id ? { ...item, name: event.target.value } : item) })} /></label>
        <button type="submit" className="control-button primary" disabled={!dirty || !output.name.trim()}>変更を反映して記録</button>
      </fieldset></form>}
      {note && <p className="feedback">{note}</p>}
      {error && <p className="feedback error">{error}</p>}
      {conflict && <p className="feedback error">他のControllerが更新しました。Supabaseから再読込して変更をやり直してください。</p>}
      <div className="device-settings-footer"><button type="button" className="control-button" disabled={!active || busy} onClick={() => void refresh()}>Supabaseから再読込</button>
        <a className="preview-link" href={signageUrl} target="_blank" rel="noreferrer">このSignageを開く ↗</a><label>このSignageの専用URL<input readOnly value={signageUrl} onFocus={event => event.target.select()} /></label></div>
    </dialog>
    <dialog ref={addDialog} className="device-dialog equipment-dialog" aria-labelledby="add-device-title"><div className="dialog-head"><h2 id="add-device-title">Signageを追加</h2><button type="button" aria-label="閉じる" onClick={() => addDialog.current?.close()}>×</button></div>
      {createdUrl ? <><p>Signageを追加しました。表示用デバイスでこのURLを開いてください。</p><label>専用URL<input readOnly value={createdUrl} onFocus={e => e.target.select()} /></label><a href={createdUrl} target="_blank" rel="noreferrer">新しいSignageを開く ↗</a></> : <form className="add-equipment-form" onSubmit={e => void addOutput(e)}><fieldset disabled={busy}>
        <label>デバイス名<input value={newName} maxLength={80} required onChange={event => setNewName(event.target.value)} /></label><p className="control-help">Signageは何台でも追加できます。別の画面には別の専用URLを使ってください。</p><button type="submit" className="control-button primary" disabled={!newName.trim()}>追加する</button></fieldset></form>}
      {note && <p role="status">{note}</p>}
    </dialog>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><CloudGate product="Controller"><App /></CloudGate></StrictMode>);

import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { AppHeader, appUrl } from "../../shared/AppHeader";
import { CloudGate } from "../../shared/CloudSetup";
import { LivePreview } from "../../shared/live-preview";
import { deleteDevice, getDevice, listDevices, listDeviceEvents, newCommand, sendCommand, subscribeDevice, registerDevice, type CommandAction, type DeviceChannel, type DeviceRecord } from "../../shared/cloud";
import { getOdptCatalog, loadOdptData } from "../../shared/browser-odpt";
import { mergeDeviceList, mergeDeviceSnapshot } from "../../shared/cloud-view-state";
import { effectiveDisplaySettings, selectOutput, withOutputSettings, type FacilitySettings } from "../../shared/display-settings";
import { RouteEditor } from "./RouteEditor";
import { ContentEditor } from "./ContentEditor";
import { LayoutEditor } from "./LayoutEditor";
import { ServiceEditor } from "./ServiceEditor";
import type { OdptData } from "../../signage/src/types";
import type { CatalogLine } from "./catalog";
import "@fontsource/inter/700.css";
import "../../shared/theme.css";
import "./styles.css";
import "./fixes.css";
import "./connections.css";
import "./equipment.css";
import "../../shared/fonts.css";
import "./studio.css";
import "../../shared/menu.css";
import "./workspace.css";

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
  const [view, setView] = useState<"home" | "quick" | "editor" | "live">("home");
  const [previewData, setPreviewData] = useState<OdptData | null>(null);
  const addDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [removalNotice, setRemovalNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deletedIds = useRef(new Set<string>());
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
  const previewSelection = JSON.stringify(config?.selectedRoutes ?? []);
  useEffect(() => { window.scrollTo(0, 0); }, [view, activeId]);

  useEffect(() => {
    if (view !== "editor" || !config) return;
    const abort = new AbortController();
    setPreviewData(null);
    void loadOdptData(config, undefined, abort.signal).then(data => { if (!abort.signal.aborted) setPreviewData(data); }).catch(() => {});
    return () => abort.abort();
  }, [view, activeId, previewSelection]);

  useEffect(() => {
    let alive = true, polling = false;
    async function poll() {
      if (polling) return; polling = true;
      try {
        const rows = (await listDevices()).filter(row => !deletedIds.current.has(row.id));
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
      if (!abort.signal.aborted) setPreviewData(data);
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
    if (operation.current) return false;
    if (id === activeId && (!output || output === outputId)) return true;
    if (dirty && !window.confirm("未保存の設定を破棄して操作対象を切り替えますか？")) return false;
    dirtyRef.current = false; setDirty(false);
    const target = devices.find(device => device.id === id);
    setDraft(target?.settings ?? null); setLoadedId(target?.id ?? "");
    setBaseRevision(target?.revision ?? 0);
    setOutputId(output ?? (target ? selectOutput(target.settings)?.id ?? target.settings.devices[0]?.id ?? "" : ""));
    setActiveId(id); setNote("");
    return true;
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
  function requestDeletion() {
    if (!active || busy || operation.current) return;
    setDeleteTarget({ id: active.id, name: active.settings.devices[0]?.name || active.name });
    setDeleteError(""); deleteDialog.current?.showModal();
  }
  async function removeSignage() {
    if (!deleteTarget || operation.current || busy) return;
    const target = deleteTarget;
    operation.current = true; setBusy(true); setDeleting(true); setDeleteError("");
    try {
      await deleteDevice(target.id);
      deletedIds.current.add(target.id); observed.current.delete(target.id);
      const nextId = devices.find(row => row.id !== target.id && !deletedIds.current.has(row.id))?.id ?? "";
      dirtyRef.current = false; setDirty(false); setDraft(null); setLoadedId(""); setOutputId("");
      activeRef.current = nextId; setActiveId(nextId);
      setDevices(rows => rows.filter(row => row.id !== target.id));
      setView("home"); setError(""); setNote(""); setRemovalNotice(`「${target.name}」を削除しました。`);
      deleteDialog.current?.close(); setDeleteTarget(null);
      setReload(value => value + 1);
    } catch (error) { setDeleteError(message(error)); }
    finally { operation.current = false; setBusy(false); setDeleting(false); }
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
    <AppHeader product="Controller"><div className="equipment-shelf-wrapper"><nav className="equipment-shelf" aria-label="Signage一覧">
      {devices.map(device => {
        const present = !!device.last_seen_at && now - Date.parse(device.last_seen_at) < 25000;
        const name = device.settings.devices[0]?.name || device.name;
        const selected = device.id === activeId;
        return <div key={device.id} className={`equipment-book${selected ? " selected" : ""}${device.display_enabled ? "" : " stopped"}`}>
          <button className="book-select" type="button" disabled={busy} aria-pressed={selected}
            aria-label={`${name} ${present ? "接続中" : "接続待ち"}`}
            title={`${name}（${present ? "接続中" : "接続待ち"}）`} onClick={() => select(device.id)}>
            <svg className="equipment-screen-icon" viewBox="0 0 32 28" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M2 20V2h21M16 23v3m-6 0h12" /><rect x="7" y="8" width="23" height="15" rx="1" />
            </svg>
            <strong title={name}>{name}</strong>
          </button>
        </div>;
      })}
      <button className="equipment-add" type="button" disabled={busy} aria-label="＋ Signageを追加" title="Signageを追加" onClick={() => { setCreatedUrl(""); addDialog.current?.showModal(); }}>＋</button>
    </nav></div></AppHeader>
    <nav className="controller-breadcrumb" aria-label="現在のページ"><button type="button" onClick={() => setView("home")} aria-current={view === "home" ? "page" : undefined}>トップ</button>{view !== "home" && <><span>/</span><span aria-current="page">{view === "quick" ? "クイック設定" : view === "editor" ? "エディターで細かく編集" : "今の様子（画面共有）"}</span></>}</nav>
    <section className="page equipment-page">
      {removalNotice && <p className="feedback" role="status">{removalNotice}</p>}
      {error && <p className="feedback error" role="alert">{error}</p>}
      {!!notifications.length && <details className="connection-notices"><summary>Signageの接続通知（{notifications.length}）</summary><ul aria-live="polite">{notifications.map((notice, index) => <li key={`${index}-${notice}`}>{notice}</li>)}</ul><button type="button" onClick={() => setNotifications([])}>通知を閉じる</button></details>}
      {active ? <>
        {!online && <p className="feedback">表示用のデバイスで<a href={signageUrl} target="_blank" rel="noreferrer">このSignageの専用URL</a>を開き、同じアカウントでログインしてください。</p>}
        <p className="feedback" role="status">{busy ? deleting ? "Signageを削除しています…" : "描画・記録の完了を待っています…" : note}</p>
        {conflict && <p className="feedback error" role="alert">他のControllerが更新しました。編集中の設定は保持しています。Supabaseから再読込して変更をやり直してください。</p>}
        {output && draft && config ? <section id="equipment-customization" aria-label={`${output.name}の設定`}>
          <div className="workspace-heading"><h1>{output.name}</h1><span className={online && connected ? "online" : "offline"}>● {online && connected ? active.display_enabled && output.enabled ? "表示中" : "表示停止中" : "接続待ち"}</span></div>
          {(view === "home" || view === "live") && <div className={`controller-overview${view === "live" ? " live-expanded" : ""}`}>
            {view === "home" && <div className="workspace-shortcuts"><button type="button" className="workspace-card quick-card" onClick={() => setView("quick")}><span className="card-symbol" aria-hidden="true">≡</span><strong>クイック設定</strong><span>路線・乗り物・スクロール文<br />写真・動画・デバイス設定など</span><span className="card-arrow" aria-hidden="true">↗</span></button>
              <button type="button" className="workspace-card editor-card" onClick={() => setView("editor")}><span className="card-symbol" aria-hidden="true">⊞</span><strong>エディターで<br />細かく編集する</strong><span>パーツを置いて、画面をデザイン</span><span className="card-arrow" aria-hidden="true">↗</span></button></div>}
            <section className="current-screen"><header><h2>今の様子<span>（画面共有）</span></h2><button type="button" onClick={() => setView(view === "live" ? "home" : "live")}>{view === "live" ? "一覧に戻る" : "大きく表示"}</button></header><LivePreview key={activeId} channel={channel} online={online && connected} />
              <p className="screen-response">{active.last_seen_at ? `最終応答 ${time(active.last_seen_at)}` : "Signageの接続を待っています"}</p></section>
          </div>}
          {(view === "quick" || view === "editor") && <form onSubmit={save}>
            {view === "editor" ? <LayoutEditor key={`layout|${activeId}|${output.id}`} settings={config} data={previewData} disabled={!canEdit || conflict} onChange={settings => edit(withOutputSettings(draft, output.id, settings))} /> : <div className="quick-settings"><section className="quick-panel"><h2>駅・バス停と路線</h2>
            <p className="control-help">{catalogNote}</p><p className="control-help">{odptNote}</p><fieldset disabled={!canEdit || conflict}>
            <RouteEditor key={`routes|${activeId}|${output.id}`} settings={config} lines={lines} disabled={!canEdit || conflict} onChange={settings => edit(withOutputSettings(draft, output.id, settings))} />
            <ServiceEditor settings={config} lines={lines} disabled={!canEdit || conflict} onChange={settings => edit(withOutputSettings(draft, output.id, settings))} />
            </fieldset></section><section className="quick-panel"><h2>スクロール文・写真・動画と表示設定</h2><fieldset disabled={!canEdit || conflict}>
            <ContentEditor key={`content|${activeId}|${output.id}`} settings={config} disabled={!canEdit || conflict} onChange={settings => edit(withOutputSettings(draft, output.id, { ...settings,
              selectedRoutes: settings.selectedRoutes.map(route => ({ ...route, stationLocation: route.stationLocation ?? lines.find(line => line.id === route.railway)?.stations.find(station => station.id === route.station)?.location })),
            }))} />
            </fieldset></section><section className="quick-panel device-settings-panel" aria-label="デバイス設定"><h2>デバイス設定</h2>
              <label className="equipment-name-field">デバイス名<input value={output.name} maxLength={80} required disabled={!canEdit || conflict} onChange={event => edit({ ...draft, devices: draft.devices.map(item => item.id === output.id ? { ...item, name: event.target.value } : item) })} /></label>
              <div className="studio-buttons"><button type="button" disabled={!canEdit || dirty} onClick={() => void toggleDisplay()}>{active.display_enabled && output.enabled ? "表示を停止" : "表示を再開"}</button><button type="button" disabled={!canEdit || dirty} onClick={() => void operate("refresh", {})}>交通情報を更新</button><button type="button" disabled={busy} onClick={() => void refresh()}>保存済みの設定を再読込</button><button type="button" onClick={() => setView("live")}>今の様子を見る</button></div>
              <p className="control-help cloud-sync">{active.last_seen_at ? `最終応答 ${time(active.last_seen_at)}` : "まだ画面の応答がありません"} · 確定リビジョン {active.revision}</p>
              <a className="preview-link" href={signageUrl} target="_blank" rel="noreferrer">このSignageを開く ↗</a><label>このSignageの専用URL<input readOnly value={signageUrl} onFocus={event => event.target.select()} /></label>
              <div className="device-delete-control"><p>使わなくなったSignageを一覧から削除します。接続待ちの端末も削除できます。</p><button type="button" className="delete-signage-button" disabled={busy} onClick={requestDeletion}>このSignageを削除</button></div>
            </section></div>}
            <div className="workspace-save"><span>{dirty ? "未保存の変更があります" : "保存済み"}</span><button type="submit" disabled={!dirty || !canEdit || conflict}>保存</button></div>
          </form>}
        </section> : <p>この端末にデバイスを追加してください。</p>}
      </> : <div className="equipment-empty"><h1>Signageを開いてください</h1><p>Signageで同じアカウントにログインすると、ここに端末が表示されます。</p><a className="open-signage" href={appUrl("signage")} target="_blank" rel="noreferrer">Signageを開く ↗</a></div>}
    </section>
    <dialog ref={addDialog} className="device-dialog equipment-dialog" aria-labelledby="add-device-title"><div className="dialog-head"><h2 id="add-device-title">Signageを追加</h2><button type="button" aria-label="閉じる" onClick={() => addDialog.current?.close()}>×</button></div>
      {createdUrl ? <><p>Signageを追加しました。表示用デバイスでこのURLを開いてください。</p><label>専用URL<input readOnly value={createdUrl} onFocus={e => e.target.select()} /></label><a href={createdUrl} target="_blank" rel="noreferrer">新しいSignageを開く ↗</a></> : <form className="add-equipment-form" onSubmit={e => void addOutput(e)}><fieldset disabled={busy}>
        <label>デバイス名<input value={newName} maxLength={80} required onChange={event => setNewName(event.target.value)} /></label><p className="control-help">Signageは何台でも追加できます。別の画面には別の専用URLを使ってください。</p><button type="submit" className="control-button primary" disabled={!newName.trim()}>追加する</button></fieldset></form>}
      {note && <p role="status">{note}</p>}
    </dialog>
    <dialog ref={deleteDialog} className="device-dialog delete-signage-dialog" aria-labelledby="delete-signage-title" aria-describedby="delete-signage-description" onCancel={event => { if (deleting) event.preventDefault(); }}>
      <div className="dialog-head"><h2 id="delete-signage-title">Signageを削除</h2><button type="button" aria-label="閉じる" disabled={deleting} onClick={() => deleteDialog.current?.close()}>×</button></div>
      <p className="delete-signage-name">{deleteTarget?.name}</p>
      <p id="delete-signage-description">このSignageの設定と操作履歴を削除します。この操作は取り消せません。表示用の端末は削除を確認すると案内画面に切り替わり、専用URLは使えなくなります。</p>
      {dirty && <p>未保存の変更も破棄されます。</p>}
      {deleteError && <p className="delete-signage-error" role="alert">{deleteError}</p>}
      <div className="dialog-actions"><button type="button" autoFocus disabled={deleting} onClick={() => deleteDialog.current?.close()}>キャンセル</button><button type="button" className="delete-signage-button" disabled={deleting} onClick={() => void removeSignage()}>{deleting ? "削除中…" : "削除する"}</button></div>
    </dialog>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><CloudGate product="Controller"><App /></CloudGate></StrictMode>);

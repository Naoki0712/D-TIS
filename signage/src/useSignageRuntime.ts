import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import type { OdptData, SignageState } from "./types";
import { effectiveDisplaySettings, selectOutput } from "../../shared/display-settings";
import { CloudCommitError, commitApplied, getCloudClient, getDevice, heartbeatDevice, announceDeviceConnection, parseCommand, parseDeviceRecord,
  readCloudConfig, reconcileApplied, registerDevice, subscribeDevice, type Command, type DeviceChannel, type DeviceRecord } from "../../shared/cloud";
import { loadOdptData } from "../../shared/browser-odpt";
import { prepareContent } from "./prepare-content";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Hidden tabs throttle animation frames; never leave an operation waiting forever. */
async function painted(signal: AbortSignal) {
  if (signal.aborted) throw new Error("操作を中断しました。");
  if (document.visibilityState !== "visible") throw new Error("Signageタブを前面に表示してから操作してください。");
  await new Promise<void>((resolve, reject) => {
    let first = 0, second = 0, finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true; clearTimeout(timer); cancelAnimationFrame(first); cancelAnimationFrame(second);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve();
    };
    const aborted = () => finish(new Error("操作を中断しました。"));
    const timer = setTimeout(() => finish(new Error("Signageの描画確認がタイムアウトしました。画面を前面に表示してください。")), 2500);
    signal.addEventListener("abort", aborted, { once: true });
    first = requestAnimationFrame(() => { second = requestAnimationFrame(() => finish()); });
  });
}

export function useSignageRuntime() {
  const outputId = new URLSearchParams(window.location.search).get("output") || undefined;
  const requestedDeviceId = new URLSearchParams(window.location.search).get("device") || undefined;
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [data, setData] = useState<OdptData | null>(null);
  const [channel, setChannel] = useState<DeviceChannel | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    const lifetime = new AbortController();
    let current: DeviceRecord | null = null, currentData: OdptData | null = null;
    let wire: DeviceChannel | null = null, busy = false, dataBusy = false, polling = false;
    let heartbeat = 0, update = 0, retry = 0;
    let pending: { command: Command; staged: DeviceRecord; data: OdptData | null } | null = null;
    const stopped = new Promise<void>(resolve => lifetime.signal.addEventListener("abort", () => resolve(), { once: true }));
    const completed = new Map<string, DeviceRecord>();
    let cacheKey = "";
    function remember(record: DeviceRecord) {
      try { localStorage.setItem(cacheKey, JSON.stringify(record)); } catch { /* Cloud remains authoritative when local storage is full. */ }
    }
    async function readData(record: DeviceRecord, force = false) {
      return loadOdptData(effectiveDisplaySettings(record.settings, outputId), undefined, lifetime.signal, force);
    }
    function render(record: DeviceRecord, nextData: OdptData | null) {
      if (lifetime.signal.aborted) return;
      flushSync(() => { setDevice(record); setData(nextData); });
    }
    async function receipt(command: Command, saved: DeviceRecord, nextData: OdptData | null) {
      if (lifetime.signal.aborted) return;
      current = saved; currentData = nextData; remember(saved); render(saved, nextData);
      completed.set(command.id, saved);
      if (completed.size > 80) completed.delete(completed.keys().next().value!);
      setConnectionError(null);
      const confirmed = await getDevice(saved.id).catch(() => saved);
      if (lifetime.signal.aborted) return;
      if (confirmed.revision > saved.revision) {
        try {
          const refreshed = await readData(confirmed);
          if (lifetime.signal.aborted) return;
          current = confirmed; currentData = refreshed; remember(confirmed); render(confirmed, refreshed);
        } catch { /* The committed display stays valid if a later refresh fails. */ }
      }
      await wire?.send({ type: "ack", commandId: command.id, device: current }).catch(() => {
        if (!lifetime.signal.aborted) setConnectionError("Supabaseには記録済みです。Controllerで最新状態を再照会してください。");
      });
    }
    async function reject(command: Command, reason: string) {
      if (!lifetime.signal.aborted) await wire?.send({ type: "reject", commandId: command.id, error: reason }).catch(() => {});
    }
    async function resolvePending() {
      const attempt = pending;
      if (!attempt || lifetime.signal.aborted) return;
      const resolution = await reconcileApplied(attempt.staged.id, attempt.command);
      if (lifetime.signal.aborted || pending !== attempt) return;
      if (resolution.status === "pending") {
        setConnectionError("表示結果をSupabaseへ照会しています。確認が完了するまで次の操作をお待ちください。");
        return;
      }
      const restoredData = JSON.stringify(resolution.device.settings) === JSON.stringify(attempt.staged.settings)
        ? attempt.data : await readData(resolution.device);
      if (lifetime.signal.aborted) return;
      if (resolution.status === "committed") {
        await receipt(attempt.command, resolution.device, restoredData);
        pending = null;
      } else {
        current = resolution.device; currentData = restoredData; remember(current); render(current, restoredData);
        pending = null;
        setConnectionError("操作は記録されていません。Supabaseの確定済み表示に戻しました。");
        await reject(attempt.command, "操作が確定しなかったため、Supabaseの最新状態に戻しました。もう一度操作してください。");
      }
    }
    async function apply(command: Command) {
      if (!wire || !current || lifetime.signal.aborted) return;
      if (completed.has(command.id)) { await wire.send({ type: "ack", commandId: command.id, device: current }); return; }
      if (busy || pending) { await reject(command, "別の操作の反映結果を確認中です。完了してから再試行してください。"); return; }
      busy = true;
      const previous = current, previousData = currentData;
      let attemptedCommit = false, committed = false;
      let staged = previous, nextData = previousData;
      try {
        if (command.baseRevision !== previous.revision) throw new Error("設定が他のControllerで更新されました。Supabaseから再読み込みしてください。");
        staged = { ...previous,
          settings: command.action === "settings" ? command.payload as DeviceRecord["settings"] : previous.settings,
          display_enabled: command.action === "display" ? (command.payload as { enabled: boolean }).enabled : previous.display_enabled,
          refresh_version: previous.refresh_version + (command.action === "refresh" ? 1 : 0),
        };
        const display = effectiveDisplaySettings(staged.settings, outputId);
        const results = await Promise.all([
          command.action === "display" ? Promise.resolve(previousData) : readData(staged, command.action === "refresh"),
          staged.display_enabled && command.action === "settings" ? prepareContent(display, lifetime.signal) : Promise.resolve(),
        ]);
        nextData = results[0];
        if (lifetime.signal.aborted) return;
        const routes = effectiveDisplaySettings(staged.settings, outputId).selectedRoutes;
        if (command.action !== "display" && routes.length && (!nextData || nextData.source === "unavailable")) {
          throw new Error(nextData?.error ?? "表示する時刻表を取得できないため、設定を確定できませんでした。");
        }
        render(staged, nextData);
        await painted(lifetime.signal);
        if (lifetime.signal.aborted || document.visibilityState !== "visible") throw new Error("Signageタブを前面に表示して再試行してください。");
        if (!document.querySelector(".signage")) throw new Error("Signageの描画を確認できませんでした。");
        attemptedCommit = true;
        const saved = await commitApplied(previous.id, command, staged.settings, staged.display_enabled, staged.refresh_version);
        committed = true;
        await receipt(command, saved, nextData);
      } catch (error) {
        if (lifetime.signal.aborted) return;
        if (committed) {
          setConnectionError("Supabaseには記録済みです。Controllerで最新状態を再照会してください。");
          return;
        }
        if (attemptedCommit) {
          // A lost HTTP response does not establish whether COMMIT succeeded.
          pending = { command, staged, data: nextData };
          try { await resolvePending(); if (!pending) return; }
          catch { /* Resolve again after the connection recovers. */ }
          if (!(error instanceof CloudCommitError && error.outcome === "rejected")) {
            setConnectionError("Supabaseへの記録結果を確認しています。通信復旧後に自動で照会します。");
            await wire.send({ type: "pending", commandId: command.id, error: "記録結果を照会中です。次の操作をお待ちください。" }).catch(() => {});
            return;
          }
          pending = null;
        }
        current = previous; currentData = previousData; render(previous, previousData);
        setConnectionError(`操作を確定できませんでした。${message(error)}`);
        await reject(command, message(error));
      } finally { busy = false; }
    }
    async function refreshData() {
      if (!current || busy || pending || dataBusy || lifetime.signal.aborted) return;
      dataBusy = true; const requested = current;
      try {
        const next = await readData(requested, true);
        if (current === requested && !busy && !pending && !lifetime.signal.aborted) {
          if (next.source !== "unavailable" || !currentData) { currentData = next; setData(next); }
        }
      } catch { /* Retain the last display during an ODPT outage. */ }
      finally { dataBusy = false; }
    }
    async function poll() {
      if (polling || busy || lifetime.signal.aborted || !current) return;
      polling = true;
      try {
        if (pending) { await resolvePending(); if (pending || lifetime.signal.aborted) return; }
        const requested = current;
        const record = await getDevice(requested.id);
        if (lifetime.signal.aborted || busy || pending || current !== requested) return;
        if (record.revision > requested.revision) {
          const next = await readData(record);
          if (lifetime.signal.aborted || busy || pending || current !== requested) return;
          current = record; currentData = next; remember(record); render(record, next);
        }
        await heartbeatDevice(record.id);
      } catch (error) { if (!lifetime.signal.aborted) setConnectionError(`Supabaseに再接続しています。現在の表示を継続します。${message(error)}`); }
      finally { polling = false; }
    }
    async function start() {
      const { data: auth, error } = await getCloudClient().auth.getSession();
      if (error || !auth.session) throw error ?? new Error("ログインしてください。");
      if (lifetime.signal.aborted) return;
      const identityKey = `d-tis.signage.id.${readCloudConfig().url}.${auth.session.user.id}`;
      if (requestedDeviceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedDeviceId)) {
        throw new Error("SignageのURLが正しくありません。Controllerから専用URLを開き直してください。");
      }
      let id = requestedDeviceId ?? localStorage.getItem(identityKey);
      if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        id = crypto.randomUUID(); localStorage.setItem(identityKey, id);
      }
      cacheKey = `d-tis.signage.applied.${id}`;
      const run = async () => {
        if (lifetime.signal.aborted) return;
        try {
          const cached = parseDeviceRecord(JSON.parse(localStorage.getItem(cacheKey) ?? "null"));
          if (cached.id === id && cached.owner_id === auth.session!.user.id) {
            const cachedData = await readData(cached);
            if (lifetime.signal.aborted) return;
            current = cached; currentData = cachedData; render(cached, cachedData);
          }
        } catch { /* Invalid snapshots never prevent a cloud restore. */ }
        const connect = async () => {
          if (lifetime.signal.aborted) return;
          let connectingWire: DeviceChannel | null = null;
          try {
            // Explicit links identify an already registered Signage. Never create
            // an unknown UUID here, or another account's link could be mistaken
            // for a new screen when its row is hidden by RLS.
            const record = requestedDeviceId ? await getDevice(id!) : await registerDevice(id!, `Signage ${id!.slice(0, 8)}`);
            const nextData = await readData(record);
            if (lifetime.signal.aborted) return;
            current = record; currentData = nextData; remember(record); render(record, nextData);
            connectingWire = await subscribeDevice(id!, packet => {
              if (packet.type !== "command") return;
              const command = parseCommand(packet);
              if (command) void apply(command).catch(error => { if (!lifetime.signal.aborted) setConnectionError(message(error)); });
              else if (typeof packet.id === "string") void wire?.send({ type: "reject", commandId: packet.id, error: "操作が期限切れ、または設定内容が不正です。画面を更新して再試行してください。" }).catch(() => {});
            }, status => { if (!lifetime.signal.aborted) setConnectionError(status === "SUBSCRIBED" ? null : "操作用の接続を復旧しています。表示は継続します。"); });
            if (lifetime.signal.aborted) { await connectingWire.close(); return; }
            wire = connectingWire; setChannel(wire);
            const connectedRecord = await announceDeviceConnection(id!);
            if (lifetime.signal.aborted) return;
            if (connectedRecord && current === record && !busy && !pending) {
              current = connectedRecord; remember(connectedRecord); render(connectedRecord, nextData);
            }
            await heartbeatDevice(id!).catch(error => { if (!lifetime.signal.aborted) setConnectionError(message(error)); });
            if (lifetime.signal.aborted) return;
            heartbeat = window.setInterval(() => void poll(), 7000);
            update = window.setInterval(() => void refreshData(), 60000);
          } catch (error) {
            await connectingWire?.close();
            if (!lifetime.signal.aborted) { setConnectionError(`接続を再試行しています。${message(error)}`); retry = window.setTimeout(() => void connect(), 7000); }
          }
        };
        void connect();
        window.addEventListener("d-tis:odpt-config", refreshData); window.addEventListener("d-tis-config", refreshData);
        await stopped;
      };
      if (navigator.locks) {
        const waiting = window.setTimeout(() => { if (!lifetime.signal.aborted) setConnectionError("同じSignageを開いている別タブの終了を待っています。"); }, 300);
        try {
          await navigator.locks.request(`d-tis-signage:${id}`, { signal: lifetime.signal }, async () => {
            clearTimeout(waiting); if (!lifetime.signal.aborted) { setConnectionError(null); await run(); }
          });
        } finally { clearTimeout(waiting); }
      } else await run();
    }
    void start().catch(error => { if (!lifetime.signal.aborted) setConnectionError(message(error)); });
    return () => {
      lifetime.abort(); window.clearInterval(heartbeat); window.clearInterval(update); window.clearTimeout(retry);
      window.removeEventListener("d-tis:odpt-config", refreshData); window.removeEventListener("d-tis-config", refreshData);
      void wire?.close();
    };
  }, [outputId, requestedDeviceId]);
  const facility = device?.settings ?? null;
  const selectedOutput = facility ? selectOutput(facility, outputId) : undefined;
  const state: SignageState | null = device ? { deviceId: device.id, hostname: device.name, paired: true, pairing: null,
    controllerUrls: [], displayEnabled: device.display_enabled, refreshVersion: device.refresh_version,
    settingsVersion: String(device.revision), pendingPower: null, powerError: null } : null;
  return { facility: facility ? { ...facility, ...effectiveDisplaySettings(facility, outputId) } : null,
    selectedOutput, outputMissing: !!facility && !!outputId && !selectedOutput, data, state, channel,
    localDisplay: false, connectionError, pairingBusy: false, pairController: () => {} };
}

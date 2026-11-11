import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FacilitySettings } from "./display-settings";
import { normalizeCloudFacility, parseCommand, type CloudMessage, type Command } from "./cloud-protocol";
import { boundedCloudFetch } from "./cloud-fetch";
import { DEFAULT_CLOUD_CONFIG } from "./public-config";
export { COMMAND_LIFETIME_MS, newCommand, normalizeCloudFacility, parseCommand } from "./cloud-protocol";
export type { CloudMessage, Command, CommandAction } from "./cloud-protocol";

export type CloudConfig = { url: string; key: string };
export type DeviceRecord = {
  id: string; owner_id: string; name: string; settings: FacilitySettings;
  display_enabled: boolean; revision: number; refresh_version: number;
  last_seen_at: string | null; updated_at: string;
  last_connected_at?: string | null;
  last_connection_kind?: "new" | "existing" | null;
};
export type DeviceEvent = {
  id: string; device_id: string; command_id: string; action: string;
  revision: number; applied_at: string; created_at: string;
};
export type DeviceChannel = {
  send(message: CloudMessage): Promise<void>;
  on(listener: (message: CloudMessage) => void): () => void;
  close(): Promise<void>;
};

const CONFIG_KEY = "d-tis.cloud.config.v1";
let client: SupabaseClient | undefined;
let clientConfig = "";

export function readCloudConfig(): CloudConfig {
  let stored: Partial<CloudConfig> = {};
  try { stored = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}"); } catch { /* Fall back to build configuration. */ }
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env ?? {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (url && key) return { url, key };
  if (DEFAULT_CLOUD_CONFIG.url && DEFAULT_CLOUD_CONFIG.key) return { ...DEFAULT_CLOUD_CONFIG };
  return { url: typeof stored?.url === "string" ? stored.url : "",
    key: typeof stored?.key === "string" ? stored.key : "" };
}

export function validateCloudConfig(config: CloudConfig): CloudConfig {
  let url: URL;
  try { url = new URL(config.url.trim()); } catch { throw new Error("SupabaseのProject URLを確認してください。"); }
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("SupabaseのProject URLにはHTTPSのルートURLを指定してください。");
  }
  const key = config.key.trim();
  if (!key || key.startsWith("sb_secret_")) throw new Error("フロントエンド用のPublishable keyを入力してください。");
  if (key.startsWith("eyJ")) {
    try {
      const claims = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (claims.role !== "anon") throw new Error("privileged");
    } catch { throw new Error("Publishable key、または従来のanon keyを指定してください。service_roleは使用できません。"); }
  } else if (!key.startsWith("sb_publishable_")) throw new Error("SupabaseのPublishable keyを確認してください。");
  return { url: url.origin, key };
}

export function saveCloudConfig(config: CloudConfig): void {
  const normalized = validateCloudConfig(config);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
}

export function getCloudClient(): SupabaseClient {
  const config = validateCloudConfig(readCloudConfig());
  const signature = JSON.stringify(config);
  if (!client || signature !== clientConfig) {
    if (client) { void client.removeAllChannels(); client.auth.stopAutoRefresh(); }
    clientConfig = signature;
    client = createClient(config.url, config.key, { global: { fetch: (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const uploading = url.pathname.startsWith("/storage/v1/object/") && init?.method?.toUpperCase() === "POST";
      return boundedCloudFetch(input, init, uploading ? 180_000 : 12_000);
    } },
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  return client;
}

function failure(error: { message: string; code?: string }): Error {
  if (error.message.includes("revision_conflict")) return new Error("別の操作が先に反映されました。最新の設定を読み直してください。");
  if (error.message.includes("command_expired")) return new Error("操作の有効期限が切れました。もう一度操作してください。");
  if (["42P01", "PGRST202", "PGRST205"].includes(error.code ?? "")) return new Error("Supabaseの初期設定SQLを実行してください。");
  return new Error(error.message);
}

export function parseDeviceRecord(value: unknown): DeviceRecord {
  if (!value || typeof value !== "object") throw new Error("Signage情報が見つかりません。");
  const row = value as DeviceRecord;
  if (typeof row.id !== "string" || typeof row.owner_id !== "string" || typeof row.name !== "string"
    || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.display_enabled !== "boolean"
    || !Number.isSafeInteger(row.refresh_version) || row.refresh_version < 0
    || typeof row.updated_at !== "string"
    || !(row.last_seen_at === null || typeof row.last_seen_at === "string")) throw new Error("Signage情報の形式を確認してください。");
  return { ...row, settings: normalizeCloudFacility(row.settings) };
}

export async function listDevices(): Promise<DeviceRecord[]> {
  // PostgREST limits each response. Keep a stable order and page through every
  // record instead of silently losing Signages after the first server page.
  const rows = new Map<string, DeviceRecord>();
  const pageSize = 500;
  for (let offset = 0; ;) {
    const { data, error, count } = await getCloudClient().from("dtis_devices")
      .select("*", { count: "exact" }).order("id").range(offset, offset + pageSize - 1);
    if (error) throw failure(error);
    for (const raw of data ?? []) { const record = parseDeviceRecord(raw); rows.set(record.id, record); }
    if (!data?.length || count !== null && offset + data.length >= count || count === null && data.length < pageSize) break;
    offset += data.length;
  }
  return [...rows.values()];
}

export async function getDevice(id: string): Promise<DeviceRecord> {
  const { data, error } = await getCloudClient().from("dtis_devices").select("*").eq("id", id).single();
  if (error) throw failure(error);
  return parseDeviceRecord(data);
}

export async function registerDevice(id: string, name: string, outputName = "メイン画面"): Promise<DeviceRecord> {
  const supabase = getCloudClient();
  const { data: existing, error: lookupError } = await supabase.from("dtis_devices").select("*").eq("id", id).maybeSingle();
  if (lookupError) throw failure(lookupError);
  if (existing) return parseDeviceRecord(existing);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw failure(authError);
  if (!user) throw new Error("運用アカウントでログインしてください。");
  const settings: FacilitySettings = { facilityName: name.trim() || "D-TIS", directionDisplayMode: "separate",
    selectedRoutes: [], tickerText: "", updatedAt: new Date().toISOString(),
    devices: [{ id: "primary", code: "LCD-01", name: outputName.trim().slice(0, 200) || "メイン画面", type: "lcd", enabled: true }] };
  const { data, error } = await supabase.from("dtis_devices").insert({ id, owner_id: user.id, name: name.trim().slice(0, 200) || "D-TIS Signage", settings }).select("*").single();
  if (error?.code === "23505") return getDevice(id);
  if (error) throw failure(error);
  return parseDeviceRecord(data);
}

export async function heartbeatDevice(id: string): Promise<void> {
  const { error } = await getCloudClient().rpc("dtis_heartbeat", { p_device_id: id });
  if (error) throw failure(error);
}

/** Record a real Signage login separately from regular presence heartbeats. */
export async function announceDeviceConnection(id: string): Promise<DeviceRecord | null> {
  const { data, error } = await getCloudClient().rpc("dtis_connect", { p_device_id: id });
  // Existing installations keep working while the additive SQL upgrade is applied.
  if (error && ["PGRST202", "42883", "42703"].includes(error.code ?? "")) return null;
  if (error) throw failure(error);
  return parseDeviceRecord(data);
}

export async function listDeviceEvents(id: string, limit = 20): Promise<DeviceEvent[]> {
  const { data, error } = await getCloudClient().from("dtis_events")
    .select("id,device_id,command_id,action,revision,applied_at,created_at")
    .eq("device_id", id).order("revision", { ascending: false }).limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw failure(error);
  return data ?? [];
}

export async function commitApplied(id: string, command: Command, settings: FacilitySettings,
  displayEnabled: boolean, refreshVersion: number): Promise<DeviceRecord> {
  if (!parseCommand(command)) throw new Error("操作が無効、または有効期限切れです。");
  const { data, error } = await getCloudClient().rpc("dtis_commit_applied", {
    p_device_id: id, p_command_id: command.id, p_action: command.action,
    p_expected_revision: command.baseRevision, p_issued_at: command.issuedAt,
    p_settings: normalizeCloudFacility(settings), p_display_enabled: displayEnabled,
    p_refresh_version: refreshVersion, p_applied_at: new Date().toISOString(),
  });
  if (error) throw new CloudCommitError(failure(error).message, error.code ? "rejected" : "unknown");
  return parseDeviceRecord(data);
}

export class CloudCommitError extends Error {
  constructor(message: string, readonly outcome: "rejected" | "unknown") { super(message); }
}
export type CommitResolution = { status: "committed" | "rejected" | "pending"; device: DeviceRecord };

/** Serialize behind any in-flight commit before deciding that its event is absent. */
export async function reconcileApplied(id: string, command: Command): Promise<CommitResolution> {
  const { data, error } = await getCloudClient().rpc("dtis_reconcile_applied", {
    p_device_id: id, p_command_id: command.id,
    p_expected_revision: command.baseRevision, p_issued_at: command.issuedAt,
  });
  if (error) throw failure(error);
  if (!data || !["committed", "rejected", "pending"].includes(data.status)) throw new Error("操作結果を照会できませんでした。");
  return { status: data.status, device: parseDeviceRecord(data.device) };
}

/** The transport's acknowledgement only means delivery to Realtime, never successful display. */
export async function subscribeDevice(id: string, onMessage: (message: CloudMessage) => void,
  onStatus?: (status: string) => void): Promise<DeviceChannel> {
  const supabase = getCloudClient();
  await supabase.realtime.setAuth();
  const listeners = new Set([onMessage]);
  let closed = false;
  let connected = false;
  const channel = supabase.channel(`device:${id}`, { config: { private: true, broadcast: { ack: true, self: false } } });
  channel.on("broadcast", { event: "dtis" }, event => {
    const value: unknown = event.payload;
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as CloudMessage).type !== "string") return;
    for (const listener of listeners) listener(value as CloudMessage);
  });
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) { finished = true; void supabase.removeChannel(channel); reject(new Error("Supabase Realtimeへの接続がタイムアウトしました。")); }
    }, 15_000);
    channel.subscribe(status => {
      connected = status === "SUBSCRIBED";
      onStatus?.(status);
      if (status === "SUBSCRIBED" && !finished) { finished = true; clearTimeout(timer); resolve(); }
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && !finished) {
        finished = true; clearTimeout(timer); void supabase.removeChannel(channel);
        reject(new Error("Realtimeへ接続できません。初期設定SQLとログイン状態を確認してください。"));
      }
    });
  });
  return {
    async send(message) {
      if (closed || !connected) throw new Error("Signageとのリアルタイム接続が切れています。");
      const result = await channel.send({ type: "broadcast", event: "dtis", payload: message });
      if (result !== "ok") throw new Error("操作を送信できませんでした。通信状態を確認してください。");
    },
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async close() { closed = true; connected = false; listeners.clear(); await supabase.removeChannel(channel); },
  };
}

/** Wait for the Signage's post-render, post-commit receipt; no automatic retries. */
export function sendCommand(channel: DeviceChannel, command: Command, timeoutMs = 20_000): Promise<DeviceRecord> {
  return new Promise<DeviceRecord>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error, device?: DeviceRecord) => {
      if (done) return;
      done = true; clearTimeout(timer); unsubscribe();
      if (error) reject(error); else resolve(device!);
    };
    const unsubscribe = channel.on(message => {
      if (message.commandId !== command.id) return;
      if (message.type === "reject") finish(new Error(typeof message.error === "string" ? message.error : "Signageが操作を完了できませんでした。"));
      if (message.type === "ack") {
        try { finish(undefined, parseDeviceRecord(message.device)); } catch (error) { finish(error instanceof Error ? error : new Error("不正な操作結果です。")); }
      }
    });
    const timer = setTimeout(() => finish(new Error("Signageから完了通知がありません。Supabaseの最新状態を再照会して、反映結果を確認してください。")), timeoutMs);
    void channel.send(command).catch(error => finish(error instanceof Error ? error : new Error("操作の送信に失敗しました。")));
  });
}

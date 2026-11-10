export type Connection = {
  origin: string;
  token: string;
  deviceId: string;
  name: string;
};

export type DeviceStatus = {
  deviceId: string;
  hostname: string;
  displayEnabled: boolean;
  refreshVersion: number;
  settingsVersion: string;
  signageOnline: boolean;
  lastSeenAt: string | null;
  power: { supported: boolean; reason: string | null };
  pendingPower: { action: "reboot" | "shutdown"; requestedAt: string } | null;
  powerError: string | null;
};

export const STORAGE_KEY = "d-tis.controller.connections.v1";
export const connectionKey = (connection: Connection) =>
  `${connection.origin}|${connection.deviceId}`;

export function normalizeOrigin(input: string, fallback: string): string {
  const raw = input.trim() || fallback;
  if (/\s|\\/.test(raw)) throw new Error("接続先のアドレスを確認してください。");
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    throw new Error("接続先にはホスト名または IP アドレスを入力してください。");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname || url.username || url.password || url.search || url.hash ||
    !/^\/(?:signage\/?|controller\/?)?$/.test(url.pathname)
  ) throw new Error("http(s) の接続先のみ指定できます。認証情報・クエリ・追加のパスは含めないでください。");
  return url.origin;
}

export function parseConnections(raw: string | null): Connection[] {
  try {
    const entries: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(entries)) return [];
    const result: Connection[] = [];
    for (const value of entries.slice(0, 50)) {
      if (!value || typeof value !== "object") continue;
      const candidate = value as Record<string, unknown>;
      if (![candidate.origin, candidate.token, candidate.deviceId, candidate.name]
        .every((field) => typeof field === "string" && field.length > 0 && field.length <= 2048)) continue;
      const connection = candidate as Connection;
      try {
        if (normalizeOrigin(connection.origin, "") !== connection.origin ||
          result.some((item) => item.deviceId === connection.deviceId || item.origin === connection.origin)) continue;
      } catch { continue; }
      result.push({ origin: connection.origin, token: connection.token, deviceId: connection.deviceId, name: connection.name });
    }
    return result;
  } catch { return []; }
}

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

export async function request<T>(
  connection: Pick<Connection, "origin"> & Partial<Pick<Connection, "token">>,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (options.signal?.aborted) abort.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = window.setTimeout(() => abort.abort(), 8000);
  try {
    const response = await fetch(`${connection.origin}${path}`, {
      method: options.method ?? "GET",
      signal: abort.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const message = response.status === 401
        ? "連携が解除されたか、認証の有効期限が切れました。PIN で再連携してください。"
        : typeof data?.message === "string" ? data.message : typeof data?.error === "string" ? data.error : `通信に失敗しました（HTTP ${response.status}）。`;
      throw new ApiError(message, response.status);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(abort.signal.aborted
      ? "応答がありません。接続先とネットワークを確認してください。"
      : "Signage に接続できません。アドレス・ネットワーク・ブラウザーの接続許可を確認してください。");
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

export function checkDevice(value: DeviceStatus, expectedId?: string): DeviceStatus {
  if (!value || typeof value.deviceId !== "string" || !value.deviceId ||
      typeof value.hostname !== "string" || typeof value.displayEnabled !== "boolean" ||
      typeof value.signageOnline !== "boolean" || typeof value.settingsVersion !== "string" ||
      typeof value.power?.supported !== "boolean") {
    throw new ApiError("接続先から正しい Signage 情報を取得できませんでした。");
  }
  if (expectedId && expectedId !== value.deviceId) {
    throw new ApiError("接続先の Signage が変更されています。PIN で再連携してください。", 401);
  }
  return value;
}

import type { DisplaySettings, FacilitySettings, SelectedRoute } from "./display-settings";

export type CommandAction = "settings" | "display" | "refresh";
export type Command = {
  type: "command";
  id: string;
  action: CommandAction;
  payload: unknown;
  baseRevision: number;
  issuedAt: string;
};
export type CloudMessage = { type: string; [key: string]: unknown };
export const COMMAND_LIFETIME_MS = 30_000;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit: number, allowEmpty = false): value is string =>
  typeof value === "string" && value.length <= limit && (allowEmpty || value.trim().length > 0);

function displaySettings(value: unknown): DisplaySettings {
  if (!object(value) || !text(value.facilityName, 200, true)
    || !["separate", "combined"].includes(String(value.directionDisplayMode))
    || !text(value.tickerText, 2000, true) || !Array.isArray(value.selectedRoutes)
    || value.selectedRoutes.length > 100) throw new Error("表示設定の形式を確認してください。");
  const routes: SelectedRoute[] = value.selectedRoutes.map(raw => {
    if (!object(raw) || ![raw.railway, raw.station, raw.direction].every(field => text(field, 500))) {
      throw new Error("路線・駅・方面の指定を確認してください。");
    }
    const route: SelectedRoute = { railway: raw.railway as string, station: raw.station as string, direction: raw.direction as string };
    if (raw.display !== undefined) {
      if (!object(raw.display)) throw new Error("路線の表示設定を確認してください。");
      route.display = {};
      if (raw.display.directionDisplayMode !== undefined) {
        if (!["combined", "separate"].includes(String(raw.display.directionDisplayMode))) throw new Error("方面の表示方法を確認してください。");
        route.display.directionDisplayMode = raw.display.directionDisplayMode as "combined" | "separate";
      }
      for (const key of ["showLineName", "showDirection", "showTrainType", "showCarCount"] as const) {
        if (raw.display[key] !== undefined) {
          if (typeof raw.display[key] !== "boolean") throw new Error("表示項目を確認してください。");
          route.display[key] = raw.display[key];
        }
      }
    }
    return route;
  });
  return { facilityName: value.facilityName, directionDisplayMode: value.directionDisplayMode as "separate" | "combined",
    selectedRoutes: routes, tickerText: value.tickerText };
}

/** Validate broadcast content before it reaches the visible display or database. */
export function normalizeCloudFacility(value: unknown): FacilitySettings {
  const settings = displaySettings(value);
  if (!object(value) || !Array.isArray(value.devices) || value.devices.length > 50) throw new Error("設備の設定を確認してください。");
  const devices = value.devices.map(raw => {
    if (!object(raw) || ![raw.id, raw.code, raw.name].every(field => text(field, 200))
      || !["lcd", "led", "bell-switch"].includes(String(raw.type)) || typeof raw.enabled !== "boolean") {
      throw new Error("設備名・種類を確認してください。");
    }
    return { id: raw.id as string, code: raw.code as string, name: raw.name as string,
      type: raw.type as "lcd" | "led" | "bell-switch", enabled: raw.enabled,
      ...(raw.settings === undefined ? {} : { settings: displaySettings(raw.settings) }) };
  });
  if (new Set(devices.map(device => device.id)).size !== devices.length) throw new Error("設備IDが重複しています。");
  return { ...settings, devices, updatedAt: text(value.updatedAt, 100, true) ? value.updatedAt : "" };
}

export function newCommand(action: CommandAction, payload: unknown, baseRevision: number): Command {
  return { type: "command", id: crypto.randomUUID(), action, payload, baseRevision, issuedAt: new Date().toISOString() };
}

/** Old broadcasts never turn into delayed operations after reconnecting. */
export function parseCommand(value: unknown, now = Date.now()): Command | null {
  if (!object(value) || value.type !== "command" || !text(value.id, 100)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
    || !["settings", "display", "refresh"].includes(String(value.action))
    || !Number.isSafeInteger(value.baseRevision) || Number(value.baseRevision) < 0
    || typeof value.issuedAt !== "string") return null;
  const age = now - Date.parse(value.issuedAt);
  if (!Number.isFinite(age) || age < -5_000 || age > COMMAND_LIFETIME_MS) return null;
  try {
    const payload = value.action === "settings" ? normalizeCloudFacility(value.payload)
      : value.action === "display" ? (() => {
        if (!object(value.payload) || typeof value.payload.enabled !== "boolean") throw new Error("Invalid display command");
        return { enabled: value.payload.enabled };
      })() : {};
    return { type: "command", id: value.id, action: value.action as CommandAction, payload,
      baseRevision: Number(value.baseRevision), issuedAt: value.issuedAt };
  } catch { return null; }
}

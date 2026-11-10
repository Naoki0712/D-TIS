export type Mode = "separate" | "combined";
export type DeviceType = "lcd" | "led" | "bell-switch";
export type Route = { railway: string; station: string; direction: string; display?: {
  directionDisplayMode?: Mode; showLineName?: boolean; showDirection?: boolean; showTrainType?: boolean; showCarCount?: boolean;
} };
export type DisplaySettings = { facilityName: string; directionDisplayMode: Mode; selectedRoutes: Route[]; tickerText: string };
export type Device = { id: string; code: string; name: string; type: DeviceType; enabled: boolean; settings?: DisplaySettings };
export type Facility = DisplaySettings & { devices: Device[]; updatedAt: string };
export class SettingsError extends Error {}

const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const defaults: DisplaySettings = { facilityName: "D-TIS", directionDisplayMode: "separate", selectedRoutes: [], tickerText: "" };

function config(raw: any, previous: DisplaySettings = defaults, strict = false): DisplaySettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SettingsError("表示設定を確認してください。");
  const facilityName = owns(raw, "facilityName") ? String(raw.facilityName ?? "").trim() : previous.facilityName;
  if (!facilityName && strict) throw new SettingsError("施設名を入力してください。");
  const mode = raw.directionDisplayMode ?? previous.directionDisplayMode;
  if (mode !== "combined" && mode !== "separate") throw new SettingsError("方面の表示方法を確認してください。");
  const tickerText = raw.tickerText ?? previous.tickerText ?? "";
  if (typeof tickerText !== "string" || tickerText.length > 2000) throw new SettingsError("スクロール文面は2000文字以内で入力してください。");
  const input = raw.selectedRoutes ?? previous.selectedRoutes;
  if (!Array.isArray(input)) throw new SettingsError("路線の設定を確認してください。");
  const routes: Route[] = input.map((route: any) => {
    if (![route?.railway, route?.station, route?.direction].every(field => typeof field === "string")) throw new SettingsError("路線・駅・方面を確認してください。");
    const old = previous.selectedRoutes.find(item => item.railway === route.railway && item.station === route.station && item.direction === route.direction);
    const value: Route = { railway: route.railway, station: route.station, direction: route.direction };
    const options = route.display ?? old?.display;
    if (options !== undefined) {
      if (!options || typeof options !== "object" || Array.isArray(options)) throw new SettingsError("路線の表示項目を確認してください。");
      const display: NonNullable<Route["display"]> = { ...old?.display };
      if (options.directionDisplayMode !== undefined) {
        if (!["separate", "combined"].includes(options.directionDisplayMode)) throw new SettingsError("方面の表示方法を確認してください。");
        display.directionDisplayMode = options.directionDisplayMode;
      }
      for (const key of ["showLineName", "showDirection", "showTrainType", "showCarCount"] as const) {
        if (options[key] !== undefined) {
          if (typeof options[key] !== "boolean") throw new SettingsError("路線の表示・非表示は真偽値で指定してください。");
          display[key] = options[key];
        }
      }
      value.display = display;
    }
    return value;
  });
  return { facilityName: facilityName || "D-TIS", directionDisplayMode: mode,
    tickerText, selectedRoutes: [...new Map(routes.map(route => [`${route.railway}|${route.station}|${route.direction}`, route])).values()] };
}

export function normalizeFacility(raw: any, defaultDevices: Device[] = [], previous?: Facility): Facility {
  const settings = config(raw, previous, !!previous);
  const input = raw.devices ?? previous?.devices ?? defaultDevices;
  if (!Array.isArray(input)) throw new SettingsError("設備の設定を確認してください。");
  const devices: Device[] = input.map((device: any) => {
    if (!device || ![device.id, device.code, device.name].every(field => typeof field === "string" && field.trim())
      || !["lcd", "led", "bell-switch"].includes(device.type)) throw new SettingsError("設備名・種類を確認してください。");
    if (device.enabled !== undefined && typeof device.enabled !== "boolean") throw new SettingsError("設備の稼働状態を確認してください。");
    const old = previous?.devices.find(item => item.id === device.id);
    return { id: device.id, code: device.code, name: device.name, type: device.type,
      enabled: device.enabled ?? old?.enabled ?? true,
      ...(device.settings !== undefined ? { settings: config(device.settings, old?.settings ?? settings, true) }
        : old?.settings ? { settings: old.settings } : {}) };
  });
  if (new Set(devices.map(device => device.id)).size !== devices.length) throw new SettingsError("設備IDが重複しています。");
  if (previous && !settings.facilityName.trim()) throw new SettingsError("施設名を入力してください。");
  return { ...settings, devices, updatedAt: raw.updatedAt ?? previous?.updatedAt ?? "" };
}

export function effectiveSettings(facility: Facility, outputId?: string): DisplaySettings {
  const output = outputId ? facility.devices.find(device => device.id === outputId)
    : facility.devices.find(device => device.type === "lcd") ?? facility.devices.find(device => device.type === "led");
  return output?.settings ?? facility;
}

export function allSelectedRoutes(facility: Facility): Route[] {
  return [...facility.selectedRoutes, ...facility.devices.flatMap(device => device.settings?.selectedRoutes ?? [])];
}

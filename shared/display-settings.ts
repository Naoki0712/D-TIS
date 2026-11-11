export type DirectionDisplayMode = "separate" | "combined";
export type DeviceType = "lcd" | "led" | "bell-switch";
export type TransitionStyle = "none" | "slide" | "fade" | "flip" | "split-flap" | "zoom";
export type FontPreset = "gothic" | "mincho" | "custom";
export interface CustomFont { family: string; url: string; format: "woff2" | "woff" | "truetype" | "opentype" }
export interface AppearanceSettings { preset: FontPreset; customFont?: CustomFont }
export interface GeoPoint { latitude: number; longitude: number }
export interface TravelSettings {
  mode: "off" | "manual" | "gps"; minutes: number;
  latitude?: number; longitude?: number; walkingSpeedKmh?: number; bufferMinutes?: number;
}
export interface MediaItem { id: string; kind: "image" | "video"; url: string; alt: string; durationSeconds: number }
export interface TickerSegment { id: string; text: string; color?: string; weight?: 400 | 700; font?: FontPreset; blink?: boolean; pauseSeconds?: number }
export interface TickerSettings { speed: number; segments: TickerSegment[] }

export interface RouteDisplaySettings {
  directionDisplayMode?: DirectionDisplayMode;
  showLineName?: boolean;
  showDirection?: boolean;
  showTrainType?: boolean;
  showCarCount?: boolean;
}

export interface SelectedRoute {
  railway: string;
  station: string;
  direction: string;
  display?: RouteDisplaySettings;
  stationLocation?: GeoPoint;
}

export interface DisplaySettings {
  facilityName: string;
  directionDisplayMode: DirectionDisplayMode;
  selectedRoutes: SelectedRoute[];
  tickerText: string;
  appearance?: AppearanceSettings;
  transition?: TransitionStyle;
  travel?: TravelSettings;
  media?: MediaItem[];
  mediaLayout?: "alongside" | "alternating";
  ticker?: TickerSettings;
}

export interface OutputDevice {
  id: string;
  code: string;
  name: string;
  type: DeviceType;
  enabled: boolean;
  settings?: DisplaySettings;
}

export interface FacilitySettings extends DisplaySettings {
  devices: OutputDevice[];
  updatedAt: string;
}

type FacilityInput = Partial<DisplaySettings> & { devices?: OutputDevice[] };

/** The physical kiosk defaults to its LCD; explicit output URLs select that device. */
export function selectOutput(facility: FacilityInput, outputId?: string): OutputDevice | undefined {
  const devices = facility.devices ?? [];
  if (outputId) return devices.find(device => device.id === outputId);
  return devices.find(device => device.type === "lcd") ?? devices.find(device => device.type === "led");
}

export function effectiveDisplaySettings(facility: FacilityInput, outputId?: string): DisplaySettings {
  const settings = selectOutput(facility, outputId)?.settings;
  return {
    facilityName: settings?.facilityName ?? facility.facilityName ?? "D-TIS",
    directionDisplayMode: settings?.directionDisplayMode ?? facility.directionDisplayMode ?? "separate",
    selectedRoutes: settings?.selectedRoutes ?? facility.selectedRoutes ?? [],
    tickerText: settings?.tickerText ?? facility.tickerText ?? "",
    appearance: settings ? settings.appearance : facility.appearance,
    transition: settings ? settings.transition : facility.transition,
    travel: settings ? settings.travel : facility.travel,
    media: settings ? settings.media : facility.media,
    mediaLayout: settings ? settings.mediaLayout : facility.mediaLayout,
    ticker: settings ? settings.ticker : facility.ticker,
  };
}

export function routeDisplaySettings(route: SelectedRoute, fallback: DirectionDisplayMode = "separate"): Required<RouteDisplaySettings> {
  return {
    directionDisplayMode: route.display?.directionDisplayMode ?? fallback,
    showLineName: route.display?.showLineName !== false,
    showDirection: route.display?.showDirection !== false,
    showTrainType: route.display?.showTrainType !== false,
    showCarCount: route.display?.showCarCount === true,
  };
}

/** Save an output independently while retaining the legacy primary LCD settings. */
export function withOutputSettings(facility: FacilitySettings, outputId: string, settings: DisplaySettings): FacilitySettings {
  if (!facility.devices.some(device => device.id === outputId)) return facility;
  const primary = selectOutput(facility);
  const devices = facility.devices.map(device => {
    if (device.id === outputId) return { ...device, settings };
    // Snapshot inherited settings before changing the primary's legacy defaults.
    if (primary?.id === outputId && !device.settings) {
      return { ...device, settings: effectiveDisplaySettings(facility, device.id) };
    }
    return device;
  });
  return { ...facility, ...(primary?.id === outputId ? settings : {}), devices };
}

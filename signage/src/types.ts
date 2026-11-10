import type { OutputDevice, SelectedRoute } from "../../shared/display-settings";
export interface Facility {
  facilityName: string;
  directionDisplayMode?: "separate" | "combined";
  selectedRoutes: SelectedRoute[];
  tickerText?: string;
  devices?: OutputDevice[];
  updatedAt?: string;
}
export interface SignageState {
  deviceId: string;
  hostname: string;
  paired: boolean;
  pairing: { pin: string; expiresAt: string } | null;
  controllerUrls: string[];
  displayEnabled: boolean;
  refreshVersion: number;
  settingsVersion: string;
  pendingPower: { action: "reboot" | "shutdown"; requestedAt: string } | null;
  powerError: string | null;
}
export interface Departure {
  time: string;
  type: string;
  typeEnglish: string;
  destination: string;
  destinationEnglish: string;
  destinationCodes: string[];
  trainNumber: string | null;
  note: string | null;
  carCount?: number;
}
export interface Timetable {
  mode?: "rail" | "bus";
  lineCode?: string;
  station: string;
  railway: string;
  direction: string;
  calendar: string;
  calendarDates?: string[];
  calendarDuration?: string;
  railwayName: string;
  railwayEnglish: string;
  stationName: string;
  stationEnglish: string;
  stationCode: string;
  directionName: string;
  directionEnglish: string;
  generatedAt: string | null;
  validUntil: string | null;
  departures: Departure[];
}
export interface TrainInformation {
  railway: string;
  railwayName: string;
  text: string;
  generatedAt: string | null;
  validUntil: string | null;
}
export interface OdptData {
  source: "live" | "cache" | "unavailable";
  fetchedAt: string | null;
  frequencySeconds: number;
  timetables: Timetable[];
  trainInformation: TrainInformation[];
  selectionCount: number;
  stale?: boolean;
  error?: string;
}

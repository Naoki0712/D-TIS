import type { ServiceStatus } from "./display-settings";

export function parseServiceStatus(value: unknown): ServiceStatus {
  const v = value as ServiceStatus;
  if (!v || typeof v !== "object" || !["normal", "delayed", "suspended"].includes(v.status)
    || !Number.isInteger(v.delayMinutes) || v.delayMinutes < 0 || v.delayMinutes > 360 || typeof v.message !== "string" || v.message.length > 500
    || (v.status === "delayed" && v.delayMinutes < 1)) throw new Error("運行状況・遅れ時分を確認してください。");
  return { status: v.status, delayMinutes: v.delayMinutes, message: v.message };
}
export function delayedTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

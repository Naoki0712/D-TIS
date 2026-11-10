export const trainTypeColors = {
  local: "#0c58a4",
  semiExpress: "#00a650",
  rapid: "#00bfff",
  commuterExpress: "#ffd400",
  express: "#ed2024",
} as const;

/** More specific types must be checked before the 急行 / 快速 they contain. */
export function trainTypeColor(type: string, railway: string): string {
  const name = type.split(":").at(-1)?.split(".").at(-1)?.replace(/[\s-]/g, "") ?? "";
  if (name === "通勤急行" || /^CommuterExpress$/i.test(name)) return trainTypeColors.commuterExpress;
  if (/準急/.test(name) || /SemiExpress$/i.test(name)) return trainTypeColors.semiExpress;
  if (/急行|特急|快特/.test(name) || /Express$|LimitedExpress$|AirportRapid$/i.test(name)) return trainTypeColors.express;
  if (/快速/.test(name) || /Rapid$/i.test(name)) {
    return railway === "odpt.Railway:TokyoMetro.Tozai" ? trainTypeColors.express : trainTypeColors.rapid;
  }
  return trainTypeColors.local;
}

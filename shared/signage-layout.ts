import type { DisplaySettings, PartTextStyle, SignageLayout, SignagePart } from "./display-settings";
import type { BoardTextField } from "./display-settings";

export const defaultTextStyle: PartTextStyle = { font: "gothic", fontSize: 48, color: "#ffffff", weight: 700, italic: false, underline: false, align: "left", blink: false };
export const partNames: Record<SignagePart["kind"], string> = { departures: "発車案内", ticker: "スクロール文", text: "テキスト", media: "写真・動画", clock: "時計" };
export const boardTextNames: Record<BoardTextField, string> = { lineName: "路線名", lineSecondary: "路線名の補助表記", directionName: "方面", directionSecondary: "方面の補助表記", departureTime: "発車時刻", trainType: "種別", destinationName: "行き先", destinationSecondary: "行き先の補助表記" };
export const snap = (value: number) => Math.round(value / 2) * 2;
export function fitPart(part: SignagePart): SignagePart {
  const width = Math.min(100, Math.max(8, part.width)), height = Math.min(100, Math.max(6, part.height));
  return { ...part, width, height, x: Math.max(0, Math.min(100 - width, part.x)), y: Math.max(0, Math.min(100 - height, part.y)) };
}
export function initialLayout(settings: DisplaySettings): SignageLayout {
  return { parts: [
    { id: "departures", kind: "departures", x: 0, y: 0, width: settings.media?.length ? 66 : 100, height: 86 },
    ...(settings.media?.length ? [{ id: "media", kind: "media" as const, x: 68, y: 0, width: 32, height: 86 }] : []),
    { id: "ticker", kind: "ticker", x: 0, y: 88, width: 100, height: 12 },
  ] };
}
function invalidLayout(): never { throw new Error("パーツの位置・大きさ・文字設定を確認してください。"); }
function parseTextStyle(value: unknown): PartTextStyle {
  const s = value as PartTextStyle;
  if (!s || typeof s !== "object" || !["gothic", "mincho", "custom"].includes(s.font) || !Number.isFinite(s.fontSize) || s.fontSize < 12 || s.fontSize > 240
    || typeof s.color !== "string" || !/^#[0-9a-f]{6}$/i.test(s.color) || ![400, 700].includes(s.weight) || !["left", "center", "right"].includes(s.align)
    || ![s.italic, s.underline, s.blink].every(b => typeof b === "boolean")) return invalidLayout();
  return { font: s.font, fontSize: s.fontSize, color: s.color, weight: s.font === "mincho" ? 400 : s.weight, italic: s.italic, underline: s.underline, align: s.align, blink: s.blink };
}
/** Validate persisted layouts as well as commands; all coordinates are percentages. */
export function parseLayout(value: unknown): SignageLayout {
  const invalid = invalidLayout;
  if (!value || typeof value !== "object" || !Array.isArray((value as SignageLayout).parts) || (value as SignageLayout).parts.length > 50) return invalid();
  const parts = (value as SignageLayout).parts.map((p): SignagePart => {
    if (!p || typeof p !== "object" || typeof p.id !== "string" || !p.id || p.id.length > 100 || !Object.hasOwn(partNames, p.kind)
      || ![p.x, p.y, p.width, p.height].every(n => typeof n === "number" && Number.isFinite(n))
      || p.x < 0 || p.y < 0 || p.width < 8 || p.height < 6 || p.x + p.width > 100.001 || p.y + p.height > 100.001) return invalid();
    const part: SignagePart = { id: p.id, kind: p.kind, x: p.x, y: p.y, width: p.width, height: p.height };
    if (p.routeIndex !== undefined) { if (!Number.isInteger(p.routeIndex) || p.routeIndex < 0 || p.routeIndex > 99) return invalid(); part.routeIndex = p.routeIndex; }
    if (p.mediaId !== undefined) { if (typeof p.mediaId !== "string" || p.mediaId.length > 100) return invalid(); part.mediaId = p.mediaId; }
    if (p.text !== undefined) { if (typeof p.text !== "string" || p.text.length > 2000) return invalid(); part.text = p.text; }
    if (p.style !== undefined) part.style = parseTextStyle(p.style);
    if (p.fieldText !== undefined || p.fieldStyles !== undefined) {
      for (const prop of ["fieldText", "fieldStyles"] as const) {
        const fields = p[prop]; if (fields === undefined) continue;
        if (!fields || typeof fields !== "object" || Array.isArray(fields)) return invalid();
        for (const key of Object.keys(fields)) if (!Object.hasOwn(boardTextNames, key)) return invalid();
      }
      if (p.fieldText) {
        part.fieldText = {};
        for (const [key, text] of Object.entries(p.fieldText)) { if (typeof text !== "string" || text.length > 200) return invalid(); part.fieldText[key as BoardTextField] = text; }
      }
      if (p.fieldStyles) {
        part.fieldStyles = {};
        for (const [key, style] of Object.entries(p.fieldStyles)) {
          part.fieldStyles[key as BoardTextField] = parseTextStyle(style);
        }
      }
    }
    return part;
  });
  if (new Set(parts.map(p => p.id)).size !== parts.length) return invalid();
  return { parts };
}

import type { AppearanceSettings, DisplaySettings, GeoPoint, MediaItem, TickerSegment, TravelSettings, TransitionStyle } from "./display-settings";
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const presets = ["gothic", "mincho", "custom"];
export function assetUrl(value: unknown): value is string {
  if (!str(value, 2048) || !value.trim()) return false;
  if (/^storage:\/\/dtis-media\/[0-9a-f-]{36}\/(?:image|video|font)\/[a-zA-Z0-9._-]+$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}
export function geoPoint(value: unknown): GeoPoint | undefined {
  if (record(value) && finite(value.latitude, -90, 90) && finite(value.longitude, -180, 180)) return { latitude: value.latitude, longitude: value.longitude };
}
/** Bound and sanitize display content before it is broadcast, rendered, or stored. */
export function contentSettings(value: Record<string, unknown>): Partial<DisplaySettings> {
  const out: Partial<DisplaySettings> = {};
  if (value.appearance !== undefined) {
    const a = value.appearance;
    if (!record(a) || !presets.includes(String(a.preset))) throw new Error("書体を確認してください。");
    const result: AppearanceSettings = { preset: a.preset as AppearanceSettings["preset"] };
    if (a.customFont !== undefined) {
      const f = a.customFont;
      if (!record(f) || !str(f.family, 80) || !f.family.trim() || !assetUrl(f.url) || !["woff2", "woff", "truetype", "opentype"].includes(String(f.format))) throw new Error("追加フォントの形式を確認してください。");
      result.customFont = { family: f.family, url: f.url, format: f.format as "woff2" | "woff" | "truetype" | "opentype" };
    }
    if (result.preset === "custom" && !result.customFont) throw new Error("使用するフォントを追加してください。");
    out.appearance = result;
  }
  if (value.transition !== undefined) {
    if (!["none", "slide", "fade", "flip", "split-flap", "zoom"].includes(String(value.transition))) throw new Error("切り替え効果を確認してください。");
    out.transition = value.transition as TransitionStyle;
  }
  if (value.travel !== undefined) {
    const t = value.travel;
    if (!record(t) || !["off", "manual", "gps"].includes(String(t.mode)) || !finite(t.minutes, 0, 180)) throw new Error("移動時間を確認してください。");
    const travel: TravelSettings = { mode: t.mode as TravelSettings["mode"], minutes: t.minutes };
    if (t.latitude !== undefined || t.longitude !== undefined) {
      const point = geoPoint(t); if (!point) throw new Error("設置場所の緯度・経度を確認してください。"); Object.assign(travel, point);
    }
    for (const [key, min, max] of [["walkingSpeedKmh", 1, 8], ["bufferMinutes", 0, 180]] as const) {
      if (t[key] !== undefined) { if (!finite(t[key], min, max)) throw new Error("徒歩速度・余裕時間を確認してください。"); travel[key] = t[key]; }
    }
    out.travel = travel;
  }
  if (value.media !== undefined) {
    if (!Array.isArray(value.media) || value.media.length > 20) throw new Error("写真・映像は1画面につき20件まで追加できます。");
    out.media = value.media.map((item): MediaItem => {
      if (!record(item) || !str(item.id, 100) || !item.id || !["image", "video"].includes(String(item.kind)) || !assetUrl(item.url) || !str(item.alt, 200) || !finite(item.durationSeconds, 3, 300)) throw new Error("写真・映像の設定を確認してください。");
      return { id: item.id, kind: item.kind as MediaItem["kind"], url: item.url, alt: item.alt, durationSeconds: item.durationSeconds };
    });
    if (new Set(out.media.map(i => i.id)).size !== out.media.length) throw new Error("コンテンツIDが重複しています。");
  }
  if (value.mediaLayout !== undefined) {
    if (!["alongside", "alternating"].includes(String(value.mediaLayout))) throw new Error("写真・映像の配置を確認してください。");
    out.mediaLayout = value.mediaLayout as "alongside" | "alternating";
  }
  if (value.ticker !== undefined) {
    const t = value.ticker;
    if (!record(t) || !finite(t.speed, 10, 300) || !Array.isArray(t.segments) || t.segments.length > 200) throw new Error("スクロール文面の速度・装飾を確認してください。");
    const segments = t.segments.map((s): TickerSegment => {
      if (!record(s) || !str(s.id, 100) || !s.id || !str(s.text, 2000)) throw new Error("スクロール文面の形式を確認してください。");
      const seg: TickerSegment = { id: s.id, text: s.text };
      if (s.color !== undefined) { if (!str(s.color, 7) || !/^#[0-9a-f]{6}$/i.test(s.color)) throw new Error("文字色を確認してください。"); seg.color = s.color; }
      if (s.weight !== undefined) { if (s.weight !== 400 && s.weight !== 700) throw new Error("文字の太さを確認してください。"); seg.weight = s.weight; }
      if (s.font !== undefined) { if (!presets.includes(String(s.font))) throw new Error("文字の書体を確認してください。"); seg.font = s.font as TickerSegment["font"]; }
      if (s.blink !== undefined) { if (typeof s.blink !== "boolean") throw new Error("点滅設定を確認してください。"); seg.blink = s.blink; }
      if (s.pauseSeconds !== undefined) { if (!finite(s.pauseSeconds, 0, 60)) throw new Error("停止時間を確認してください。"); seg.pauseSeconds = s.pauseSeconds; }
      if (seg.font === "mincho") seg.weight = 400;
      return seg;
    });
    if (segments.reduce((n, s) => n + s.text.length, 0) > 2000 || new Set(segments.map(s => s.id)).size !== segments.length) throw new Error("スクロール文面は2000文字以内で指定してください。");
    out.ticker = { speed: t.speed, segments };
    out.tickerText = segments.map(segment => segment.text).join("");
  }
  return out;
}

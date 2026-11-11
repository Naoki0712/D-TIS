import { useEffect, useState, type CSSProperties } from "react";
import type { AppearanceSettings } from "./display-settings";
import { useAssetUrl } from "./media-storage";
import "./fonts.css";
export function useDisplayFont(appearance?: AppearanceSettings): CSSProperties {
  const custom = appearance?.customFont;
  const resolved = useAssetUrl(custom?.url);
  const [family, setFamily] = useState("");
  useEffect(() => {
    setFamily("");
    if (!resolved.url || !custom) return;
    let alive = true;
    const name = `DTISCustom${Array.from(custom.url).reduce((h, c) => ((h * 31) ^ c.charCodeAt(0)) >>> 0, 0)}`;
    const face = new FontFace(name, `url(${JSON.stringify(resolved.url)}) format(${JSON.stringify(custom.format)})`);
    const style = document.createElement("style");
    void face.load().then(font => { if (alive) {
      document.fonts.add(font);
      style.textContent = `@font-face{font-family:${name};src:url(${JSON.stringify(resolved.url)}) format(${JSON.stringify(custom.format)});font-weight:400;font-style:normal;}`;
      document.head.append(style); setFamily(name);
    } }).catch(() => {});
    return () => { alive = false; document.fonts.delete(face); style.remove(); };
  }, [resolved.url, custom?.url, custom?.format]);
  const customStack = family ? `Inter, Helvetica, ${family}, "BIZ UDPGothic", sans-serif` : 'Inter, Helvetica, "BIZ UDPGothic", sans-serif';
  const stack = appearance?.preset === "mincho" ? 'Inter, Helvetica, "BIZ UDPMincho", serif'
    : appearance?.preset === "custom" ? customStack : 'Inter, Helvetica, "BIZ UDPGothic", sans-serif';
  return { fontFamily: stack, fontSynthesis: "none", "--latin-font": stack, "--dtis-custom-font": customStack } as CSSProperties;
}

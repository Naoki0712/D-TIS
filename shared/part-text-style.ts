import type { CSSProperties } from "react";
import type { PartTextStyle } from "./display-settings";
export function partTextStyle(style: PartTextStyle): CSSProperties {
  return { color: style.color, fontSize: `${style.fontSize / 16}cqw`, fontWeight: style.font === "mincho" ? 400 : style.weight,
    fontStyle: style.italic ? "italic" : "normal", textDecoration: style.underline ? "underline" : "none", textAlign: style.align,
    fontFamily: style.font === "mincho" ? '"BIZ UDPMincho", serif' : style.font === "custom" ? "var(--dtis-custom-font)" : 'Inter, "BIZ UDPGothic", sans-serif' };
}

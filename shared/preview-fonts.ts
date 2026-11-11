const encoded = new Map<string, Promise<string>>();
const familyName = (name: string) => name.replace(/["']/g, "").trim().toLowerCase();

function includesText(range: string, points: number[]) {
  if (!range) return true;
  return range.split(",").some(part => {
    const match = part.trim().match(/^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
    if (!match) return true;
    const from = parseInt(match[1].replace(/\?/g, "0"), 16);
    const to = parseInt(match[2] ?? match[1].replace(/\?/g, "f"), 16);
    return points.some(point => point >= from && point <= to);
  });
}
async function dataUrl(url: string) {
  let pending = encoded.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("プレビュー用の書体を読み込めません。");
      const blob = await response.blob();
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
      });
    })();
    encoded.set(url, pending);
    void pending.catch(() => encoded.delete(url));
  }
  return pending;
}

/** Embed only Japanese subsets actually used by this frame, including custom fonts. */
export async function previewFontCss(element: HTMLElement): Promise<string> {
  const families = new Set<string>();
  for (const node of [element, ...element.querySelectorAll("*")]) {
    getComputedStyle(node).fontFamily.split(",").forEach(name => families.add(familyName(name)));
  }
  const points = [...new Set(Array.from(element.textContent ?? "").map(char => char.codePointAt(0)!))];
  const faces: CSSFontFaceRule[] = [];
  function visit(rules: CSSRuleList) {
    for (const rule of Array.from(rules)) {
      if (rule.type === CSSRule.FONT_FACE_RULE) faces.push(rule as CSSFontFaceRule);
      else if ("cssRules" in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  }
  for (const sheet of Array.from(document.styleSheets)) { try { visit(sheet.cssRules); } catch { /* Cross-origin stylesheets cannot be inspected. */ } }
  const css = await Promise.all(faces.filter(rule => families.has(familyName(rule.style.fontFamily))
    && includesText(rule.style.getPropertyValue("unicode-range"), points)).map(async rule => {
    const sources = [...rule.style.getPropertyValue("src").matchAll(/url\(["']?([^"'\)]+)["']?\)\s*(?:format\(["']?([^"'\)]+)["']?\))?/g)];
    const source = sources.find(match => match[2] === "woff2") ?? sources[0];
    if (!source) return "";
    const url = new URL(source[1], rule.parentStyleSheet?.href ?? document.baseURI).href;
    const embedded = await dataUrl(url);
    return `@font-face{font-family:${rule.style.fontFamily};font-style:${rule.style.fontStyle || "normal"};font-weight:${rule.style.fontWeight || "400"};src:url("${embedded}");unicode-range:${rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF"};}`;
  }));
  return css.join("\n");
}

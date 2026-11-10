/** A site may be hosted at /, /D-TIS/, or a custom nested directory. */
export function normalizeBasePath(value = "/"): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  const segments = trimmed.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.some(segment => !segment || segment === "." || segment === "..")
      || /[\\?#\s]/.test(trimmed) || trimmed.includes(":")) {
    throw new Error("PAGES_BASE must be a URL path such as /D-TIS/.");
  }
  return `/${segments.join("/")}/`;
}

export function siteBaseFromAppBase(appBase: string): string {
  return normalizeBasePath(normalizeBasePath(appBase).replace(/(?:signage|controller)\/$/, ""));
}
